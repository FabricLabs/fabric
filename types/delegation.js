'use strict';

/**
 * @fileoverview One participant's side of delegation (`functions/delegation.js`).
 *
 * Each participant (Passport, a Hub, GoonCitizen) builds its own `Delegation`
 * with its own key and its own store; nothing is shared between them. It keeps
 * every delegation frame it sends or receives (replayable as a
 * `FabricMessageCollection`), its pairings, the grants it made and received,
 * revocations, and the requests it was asked and asked of others.
 *
 * Incoming frames go to {@link Delegation#receive}. An authorized request is
 * stored as pending and emitted as `request` with the notification to show;
 * the app answers with {@link Delegation#sign} or {@link Delegation#decline},
 * and sends the returned frames where they need to go (a rendezvous, a
 * mailbox, a loopback reply). This class never talks to the network itself.
 *
 * Events: `request` `{ hash, read, notification }`, `result` `{ hash, request, read }`,
 * `grant` `{ hash, read, direction }`, `revoke` `{ grant, hash }`,
 * `link` `{ linkId, sas, peer, role }`.
 *
 * @module types/delegation
 */

const EventEmitter = require('events');
const delegation = require('../functions/delegation');
const { encodeFabricUri, decodeFabricUri } = require('../functions/fabricUri');

/** @private */
const STATE_VERSION = 1;
/** @private */
const DEFAULT_MAX_FRAMES = 2000;
/** @private */
const DEFAULT_MAX_PENDING = 200;

/**
 * Key-value store kept in memory; the default when none is given.
 * @private
 */
function memoryStore () {
  const map = new Map();
  return {
    async get (key) { return map.has(key) ? map.get(key) : null; },
    async set (key, value) { map.set(key, value); }
  };
}

/** @private */
function emptyState () {
  return {
    v: STATE_VERSION,
    links: {},
    given: {},
    received: {},
    revoked: {},
    inbox: {},
    outbox: {},
    frames: []
  };
}

/**
 * @classdesc A participant's delegation state on its own key and store.
 * @class Delegation
 * @extends EventEmitter
 */
class Delegation extends EventEmitter {
  /**
   * @param {Object} settings
   * @param {Key} settings.key This participant's identity key (private).
   * @param {Object} [settings.store] `{ get(key), set(key, value) }` (async); in memory when omitted.
   * @param {string} [settings.collection='delegations'] Store key for this participant's record.
   * @param {Function} [settings.now] Clock (ms).
   * @param {number} [settings.maxFrames=2000] Frames kept in the message store.
   * @param {number} [settings.maxPending=200] Pending requests kept.
   * @param {Function} [settings.networkOf] `(read) => network` for requests whose frame names none (federation withdrawals).
   */
  constructor (settings = {}) {
    super();
    if (!settings.key || !settings.key.private) throw new TypeError('Delegation: a private key is required');
    this.key = settings.key;
    this.store = settings.store || memoryStore();
    this.collection = settings.collection || 'delegations';
    this.settings = Object.assign({ maxFrames: DEFAULT_MAX_FRAMES, maxPending: DEFAULT_MAX_PENDING }, settings);
    this._now = typeof settings.now === 'function' ? settings.now : () => Date.now();
    this._state = null;
    this._queue = Promise.resolve();
  }

  /** Compressed pubkey of this participant. */
  get pubkey () {
    return String(this.key.pubkey).toLowerCase();
  }

  /** @private */
  _x () {
    return this.pubkey.slice(2);
  }

  /**
   * Load the stored record (called by every method; safe to call again).
   * @returns {Promise<Delegation>}
   */
  async load () {
    if (this._state) return this;
    let raw = null;
    try {
      raw = await this.store.get(this.collection);
    } catch (_) {
      raw = null;
    }
    let state = raw;
    if (typeof raw === 'string') {
      try {
        state = JSON.parse(raw);
      } catch (_) {
        state = null;
      }
    }
    this._state = state && state.v === STATE_VERSION ? Object.assign(emptyState(), state) : emptyState();
    return this;
  }

  /** @private Run `fn` alone, then persist. */
  _serial (fn) {
    const run = this._queue.then(async () => {
      await this.load();
      const out = await fn(this._state);
      await this.store.set(this.collection, JSON.stringify(this._state));
      return out;
    });
    this._queue = run.catch(() => {});
    return run;
  }

  /** @private */
  _record (state, buffer, direction) {
    const hash = delegation.frameHash(buffer);
    if (state.frames.some((f) => f.hash === hash)) return hash;
    state.frames.push({ hash, hex: Buffer.from(buffer).toString('hex'), type: delegation.delegationType(buffer), direction, at: this._now() });
    const max = this.settings.maxFrames;
    if (state.frames.length > max) state.frames.splice(0, state.frames.length - max);
    return hash;
  }

  /** @private */
  _opts () {
    return { now: this._now() };
  }

  /** @private */
  _grants (state, which) {
    return Object.values(state[which]).map((g) => delegation.readGrant(Buffer.from(g.hex, 'hex'), { now: this._now() }));
  }

  /** @private */
  _revokedSet (state) {
    return new Set(Object.keys(state.revoked));
  }

  // Pairing

  /**
   * Start pairing through a rendezvous.
   * @param {{ origin: string, label: (string|undefined), network: (string|undefined) }} params
   * @returns {Promise<{ uri: string, linkId: string, expiresAt: number }>}
   */
  async offer (params = {}) {
    return this._serial((state) => {
      const made = delegation.createLinkOffer(Object.assign({}, params, { now: this._now() }), this.key);
      state.links[made.linkId] = {
        role: 'initiator',
        status: 'offered',
        nonce: made.nonce,
        offer: made.message.toBuffer().toString('hex'),
        origin: params.origin,
        label: params.label || '',
        createdAt: this._now()
      };
      this._record(state, made.message.toBuffer(), 'out');
      return { uri: made.uri, linkId: made.linkId, expiresAt: made.expiresAt };
    });
  }

  /**
   * Answer another participant's offer.
   * @param {string|Buffer} offer
   * @param {{ label: (string|undefined) }} [params]
   * @returns {Promise<{ uri: string, linkId: string, peer: string, peerPubkey: string }>}
   */
  async answer (offer, params = {}) {
    return this._serial((state) => {
      const read = delegation.readLinkOffer(offer, this._opts());
      if (!read.ok) throw new Error(read.error);
      const made = delegation.createLinkAnswer({ offer, label: params.label, now: this._now() }, this.key);
      state.links[made.linkId] = {
        role: 'responder',
        status: 'answered',
        offer: read.buffer.toString('hex'),
        answer: made.message.toBuffer().toString('hex'),
        peer: read.author,
        peerPubkey: read.pubkey,
        origin: read.offer.origin,
        peerLabel: read.offer.label,
        label: params.label || '',
        createdAt: this._now()
      };
      this._record(state, read.buffer, 'in');
      this._record(state, made.message.toBuffer(), 'out');
      return { uri: made.uri, linkId: made.linkId, peer: read.author, peerPubkey: read.pubkey };
    });
  }

  /**
   * Code to show for a pairing once both nonces are known, or null.
   * @param {string} linkId
   * @returns {Promise<string|null>}
   */
  async sasFor (linkId) {
    await this.load();
    const link = this._state.links[linkId];
    return link && link.sas ? link.sas : null;
  }

  /**
   * The user confirmed both screens show the same code.
   * @param {string} linkId
   * @returns {Promise<{ linkId: string, peer: string, peerPubkey: (string|null), revealHash: string }>}
   */
  async confirmLink (linkId) {
    return this._serial((state) => {
      const link = state.links[linkId];
      if (!link || !link.sas) throw new Error('nothing to confirm for this pairing');
      link.status = 'confirmed';
      link.confirmedAt = this._now();
      delete link.nonce;
      return { linkId, peer: link.peer, peerPubkey: link.peerPubkey || null, revealHash: link.revealHash };
    });
  }

  /**
   * Pairings, newest first (no secrets).
   * @returns {Promise<object[]>}
   */
  async links () {
    await this.load();
    return Object.entries(this._state.links)
      .map(([linkId, l]) => ({ linkId, role: l.role, status: l.status, peer: l.peer || null, peerPubkey: l.peerPubkey || null, peerLabel: l.peerLabel || '', origin: l.origin, sas: l.sas || null, revealHash: l.revealHash || null, createdAt: l.createdAt }))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  // Grants

  /**
   * Let `grantee` ask this participant to sign.
   * @param {Object} params See `createGrant` in `functions/delegation.js`.
   * @returns {Promise<{ uri: string, hash: string }>}
   */
  async grant (params = {}) {
    return this._serial((state) => {
      const made = delegation.createGrant(Object.assign({}, params, { now: this._now() }), this.key);
      const read = delegation.readGrant(made.message, this._opts());
      if (!read.ok) throw new Error(read.error);
      state.given[read.hash] = { hex: read.buffer.toString('hex'), at: this._now() };
      this._record(state, read.buffer, 'out');
      this.emit('grant', { hash: read.hash, read, direction: 'given' });
      return { uri: made.uri, hash: read.hash };
    });
  }

  /**
   * Withdraw a grant this participant made.
   * @param {string} grantHash
   * @returns {Promise<{ uri: string, hash: string }>}
   */
  async revoke (grantHash) {
    return this._serial((state) => {
      const hash = String(grantHash || '').toLowerCase();
      if (!state.given[hash]) throw new Error('no such grant from this participant');
      const made = delegation.createRevoke({ grant: hash, now: this._now() }, this.key);
      state.revoked[hash] = { at: this._now(), frame: made.message.toBuffer().toString('hex') };
      this._record(state, made.message.toBuffer(), 'out');
      this.emit('revoke', { grant: hash, hash: made.hash });
      return { uri: made.uri, hash: made.hash };
    });
  }

  /**
   * Grants this participant made (`given`) or holds from others (`received`), unrevoked unless asked.
   * @param {'given'|'received'} which
   * @param {{ revoked: (boolean|undefined) }} [options]
   * @returns {Promise<object[]>} `{ hash, uri, grant, revoked }`
   */
  async grants (which = 'given', options = {}) {
    await this.load();
    if (which !== 'given' && which !== 'received') throw new TypeError('grants: given or received');
    const revoked = this._revokedSet(this._state);
    return this._grants(this._state, which)
      .filter((g) => g.ok)
      .map((g) => ({ hash: g.hash, uri: encodeFabricUri(g.buffer), grant: g.grant, revoked: revoked.has(g.hash) }))
      .filter((g) => options.revoked || !g.revoked);
  }

  /**
   * Participants linked as the same person (mutual `identity` grants).
   * @returns {Promise<string[]>}
   */
  async identityPeers () {
    await this.load();
    const all = this._grants(this._state, 'given').concat(this._grants(this._state, 'received'));
    return delegation.identityPeers(this.pubkey, all, this._revokedSet(this._state));
  }

  /**
   * The unrevoked grant `grantor` made to this participant covering `scope`, if any.
   * @param {string} grantor Pubkey.
   * @param {string} scope
   * @returns {Promise<object|null>}
   */
  async grantFrom (grantor, scope) {
    const x = delegation.xOnly(grantor);
    const held = await this.grants('received');
    const matches = held.filter((g) => g.grant.grantor.slice(2) === x && g.grant.scopes.includes(scope));
    matches.sort((a, b) => b.grant.issuedAt - a.grant.issuedAt);
    return matches[0] || null;
  }

  // Requests

  /**
   * Ask `target` to sign a frame, under its newest grant covering the frame's scope.
   * @param {Object} params See `createRequest`; `grant` is found when omitted.
   * @returns {Promise<{ uri: string, hash: string, scope: string, expiresAt: number }>}
   */
  async request (params = {}) {
    let grant = params.grant;
    if (!grant) {
      const inner = delegation.readInnerFrame(Buffer.isBuffer(params.request) ? params.request : bufferOf(params.request), this._opts());
      if (!inner.ok) throw new Error(inner.error);
      const held = await this.grantFrom(params.target, inner.scope);
      if (!held) throw new Error(`no ${inner.scope} grant from that participant`);
      grant = held.hash;
    }
    return this._serial((state) => {
      const made = delegation.createRequest(Object.assign({}, params, { grant, now: this._now() }), this.key);
      state.outbox[made.hash] = { hex: made.message.toBuffer().toString('hex'), status: 'sent', at: this._now(), target: params.target, grant };
      this._record(state, made.message.toBuffer(), 'out');
      return { uri: made.uri, hash: made.hash, scope: made.scope, expiresAt: made.expiresAt };
    });
  }

  /**
   * Requests waiting for this participant's answer, oldest first.
   * @returns {Promise<Array<{ hash: string, read: object, notification: object, receivedAt: number }>>}
   */
  async pending () {
    await this.load();
    const out = [];
    for (const [hash, item] of Object.entries(this._state.inbox)) {
      if (item.status !== 'pending') continue;
      const read = delegation.readRequest(Buffer.from(item.hex, 'hex'), this._opts());
      if (!read.ok) continue;
      out.push({ hash, read, notification: delegation.notificationFor(read, { label: this._labelFor(this._state, read.request.requester) }), receivedAt: item.at });
    }
    return out.sort((a, b) => a.receivedAt - b.receivedAt);
  }

  /**
   * A request this participant received (any status).
   * @param {string} hash
   * @returns {Promise<{ hash: string, status: string, read: object, result: (string|null) }|null>}
   */
  async inboxItem (hash) {
    await this.load();
    const item = this._state.inbox[String(hash || '').toLowerCase()];
    if (!item) return null;
    return { hash, status: item.status, read: delegation.readRequest(Buffer.from(item.hex, 'hex'), { now: item.at }), result: item.result || null, rule: item.rule || null };
  }

  /**
   * A request this participant sent, with its result once it arrived.
   * @param {string} hash
   * @returns {Promise<{ hash: string, status: string, result: (object|null) }|null>}
   */
  async outboxItem (hash) {
    await this.load();
    const item = this._state.outbox[String(hash || '').toLowerCase()];
    if (!item) return null;
    const result = item.result ? delegation.readResult(Buffer.from(item.result, 'hex'), { now: item.resultAt }) : null;
    return { hash, status: item.status, result: result && result.ok ? result.result : null };
  }

  /**
   * Answer a pending request with a signed frame.
   * @param {string} requestHash
   * @param {string|Buffer|Message} answer
   * @param {{ rule: (string|undefined) }} [options]
   * @returns {Promise<{ uri: string, hash: string }>}
   */
  async sign (requestHash, answer, options = {}) {
    return this._answer(requestHash, { answer, rule: options.rule }, 'signed');
  }

  /**
   * Refuse a pending request.
   * @param {string} requestHash
   * @param {string} [reason]
   * @param {{ rule: (string|undefined) }} [options]
   * @returns {Promise<{ uri: string, hash: string }>}
   */
  async decline (requestHash, reason = 'declined', options = {}) {
    return this._answer(requestHash, { refusal: reason || 'declined', rule: options.rule }, 'declined');
  }

  /** @private */
  _answer (requestHash, fields, status) {
    return this._serial((state) => {
      const hash = String(requestHash || '').toLowerCase();
      const item = state.inbox[hash];
      if (!item) throw new Error('unknown request');
      if (item.status !== 'pending') throw new Error(`request is already ${item.status}`);
      const made = delegation.createResult(Object.assign({ request: hash, now: this._now() }, fields), this.key);
      if (fields.answer) {
        const read = delegation.readResult(made.message, this._opts());
        if (!read.ok) throw new Error(read.error);
        if (!this._signers(state, 'given', item.grant).has(read.result.answer.author)) {
          throw new Error('the answer must be signed by this participant\'s identity or granted cosigner key');
        }
      }
      item.status = status;
      item.result = made.message.toBuffer().toString('hex');
      item.rule = fields.rule || null;
      item.answeredAt = this._now();
      this._record(state, made.message.toBuffer(), 'out');
      return { uri: made.uri, hash: made.hash };
    });
  }

  // Incoming

  /**
   * Take in any delegation frame addressed to this participant.
   * @param {string|Buffer|Message} input
   * @param {{ label: (string|undefined) }} [context]
   * @returns {Promise<object>} `{ ok, type, ... }`; `ok: false` with `error` when refused.
   */
  async receive (input, context = {}) {
    const type = delegation.delegationType(input);
    if (!type) return { ok: false, error: 'not a delegation frame' };
    switch (type) {
      case 'DELEGATION_LINK_ANSWER': return this._receiveAnswer(input);
      case 'DELEGATION_LINK_REVEAL': return this._receiveReveal(input);
      case 'DELEGATION_GRANT': return this._receiveGrant(input);
      case 'DELEGATION_REVOKE': return this._receiveRevoke(input);
      case 'DELEGATION_REQUEST': return this._receiveRequest(input, context);
      case 'DELEGATION_RESULT': return this._receiveResult(input);
      default: return { ok: false, error: `${type} is not received here` };
    }
  }

  /** @private */
  _receiveAnswer (input) {
    return this._serial((state) => {
      const read = delegation.readLinkAnswer(input, this._opts());
      if (!read.ok) return read;
      const link = state.links[read.answer.offer];
      if (!link || link.role !== 'initiator') return { ok: false, error: 'not an answer to this participant\'s offer' };
      if (link.status !== 'offered') return { ok: false, error: `pairing is already ${link.status}` };
      const made = delegation.createLinkReveal({ offer: Buffer.from(link.offer, 'hex'), answer: read.buffer, nonce: link.nonce, now: this._now() }, this.key);
      link.status = 'revealed';
      link.peer = read.author;
      link.peerPubkey = read.pubkey;
      link.peerLabel = read.answer.label;
      link.answer = read.buffer.toString('hex');
      link.reveal = made.message.toBuffer().toString('hex');
      link.revealHash = made.hash;
      link.sas = made.sas;
      this._record(state, read.buffer, 'in');
      this._record(state, made.message.toBuffer(), 'out');
      this.emit('link', { linkId: made.linkId, sas: made.sas, peer: read.author, role: 'initiator' });
      return { ok: true, type: 'DELEGATION_LINK_ANSWER', linkId: made.linkId, reveal: made.uri, sas: made.sas, peer: read.author, peerPubkey: read.pubkey, peerLabel: read.answer.label };
    });
  }

  /** @private */
  _receiveReveal (input) {
    return this._serial((state) => {
      const read = delegation.readLinkReveal(input, this._opts());
      if (!read.ok) return read;
      const entry = Object.entries(state.links).find(([, l]) => l.role === 'responder' && l.answer && delegation.frameHash(Buffer.from(l.answer, 'hex')) === read.reveal.answer);
      if (!entry) return { ok: false, error: 'not a reveal for this participant\'s answer' };
      const [linkId, link] = entry;
      if (link.status !== 'answered') return { ok: false, error: `pairing is already ${link.status}` };
      const checked = delegation.verifyLink({ offer: Buffer.from(link.offer, 'hex'), answer: Buffer.from(link.answer, 'hex'), reveal: read.buffer }, this._opts());
      if (!checked.ok) return checked;
      link.status = 'revealed';
      link.reveal = read.buffer.toString('hex');
      link.revealHash = checked.revealHash;
      link.sas = checked.sas;
      this._record(state, read.buffer, 'in');
      this.emit('link', { linkId, sas: checked.sas, peer: checked.initiator, role: 'responder' });
      return { ok: true, type: 'DELEGATION_LINK_REVEAL', linkId, sas: checked.sas, peer: checked.initiator, peerPubkey: checked.pubkeys.initiator, peerLabel: checked.labels.initiator };
    });
  }

  /** @private */
  _receiveGrant (input) {
    return this._serial((state) => {
      const read = delegation.readGrant(input, this._opts());
      if (!read.ok) return read;
      if (read.grant.grantee.slice(2) !== this._x()) return { ok: false, error: 'the grant is for another participant' };
      if (state.revoked[read.hash]) return { ok: false, error: 'the grant was revoked' };
      const fresh = !state.received[read.hash];
      state.received[read.hash] = { hex: read.buffer.toString('hex'), at: this._now() };
      this._record(state, read.buffer, 'in');
      if (fresh) this.emit('grant', { hash: read.hash, read, direction: 'received' });
      return { ok: true, type: 'DELEGATION_GRANT', hash: read.hash, grant: read.grant, fresh };
    });
  }

  /** @private */
  _receiveRevoke (input) {
    return this._serial((state) => {
      const read = delegation.readRevoke(input, this._opts());
      if (!read.ok) return read;
      const held = state.received[read.revoke.grant];
      if (!held) return { ok: false, error: 'unknown grant' };
      const grant = delegation.readGrant(Buffer.from(held.hex, 'hex'), { now: held.at });
      if (!grant.ok || grant.author !== read.author) return { ok: false, error: 'only the grantor revokes a grant' };
      if (!state.revoked[read.revoke.grant]) {
        state.revoked[read.revoke.grant] = { at: this._now(), frame: read.buffer.toString('hex') };
        this._record(state, read.buffer, 'in');
        this.emit('revoke', { grant: read.revoke.grant, hash: read.hash });
      }
      return { ok: true, type: 'DELEGATION_REVOKE', grant: read.revoke.grant };
    });
  }

  /** @private */
  _receiveRequest (input, context) {
    return this._serial((state) => {
      const read = delegation.readRequest(input, this._opts());
      if (!read.ok) return read;
      if (read.request.target.slice(2) !== this._x()) return { ok: false, error: 'the request is for another participant' };
      if (state.inbox[read.hash]) return { ok: true, type: 'DELEGATION_REQUEST', hash: read.hash, duplicate: true, status: state.inbox[read.hash].status };
      const auth = delegation.authorize(read, this._grants(state, 'given'), { revoked: this._revokedSet(state), networkOf: this.settings.networkOf });
      if (!auth.ok) return auth;
      const pendingCount = Object.values(state.inbox).filter((i) => i.status === 'pending').length;
      if (pendingCount >= this.settings.maxPending) return { ok: false, error: 'too many pending requests' };
      state.inbox[read.hash] = { hex: read.buffer.toString('hex'), status: 'pending', at: this._now(), grant: auth.grant.hash };
      this._record(state, read.buffer, 'in');
      const notification = delegation.notificationFor(read, { label: (context && context.label) || this._labelFor(state, read.request.requester) });
      this.emit('request', { hash: read.hash, read, grant: auth.grant, notification });
      return { ok: true, type: 'DELEGATION_REQUEST', hash: read.hash, scope: read.scope, notification };
    });
  }

  /** @private */
  _receiveResult (input) {
    return this._serial((state) => {
      const read = delegation.readResult(input, this._opts());
      if (!read.ok) return read;
      const out = state.outbox[read.result.request];
      if (!out) return { ok: false, error: 'not a result for this participant\'s request' };
      const target = out.target ? delegation.xOnly(out.target) : null;
      if (target && read.author !== target) return { ok: false, error: 'the result is not from the participant asked' };
      if (read.result.answer && !this._signers(state, 'received', out.grant, read.author).has(read.result.answer.author)) {
        return { ok: false, error: 'the answer is not signed by the participant asked' };
      }
      if (out.status !== 'sent') return { ok: true, type: 'DELEGATION_RESULT', request: read.result.request, duplicate: true };
      out.status = read.result.answer ? 'signed' : 'declined';
      out.result = read.buffer.toString('hex');
      out.resultAt = this._now();
      this._record(state, read.buffer, 'in');
      this.emit('result', { hash: read.hash, request: read.result.request, read });
      return { ok: true, type: 'DELEGATION_RESULT', request: read.result.request, result: read.result };
    });
  }

  /**
   * x-only keys that may sign an answer under a grant: the grantor's identity
   * and the cosigner key the grant disclosed.
   * @private
   */
  _signers (state, which, grantHash, fallback) {
    const keys = new Set();
    const held = grantHash && state[which][grantHash];
    const read = held ? delegation.readGrant(Buffer.from(held.hex, 'hex'), { now: held.at }) : null;
    if (read && read.ok) {
      keys.add(read.grant.grantor.slice(2));
      if (read.grant.cosigner) keys.add(read.grant.cosigner.slice(2));
    } else if (which === 'given') {
      keys.add(this._x());
    } else if (fallback) {
      keys.add(delegation.xOnly(fallback));
    }
    return keys;
  }

  /** @private */
  _labelFor (state, pubkey) {
    const x = delegation.xOnly(pubkey);
    const link = Object.values(state.links).find((l) => l.peer === x && l.peerLabel);
    if (link) return link.peerLabel;
    const grant = this._grants(state, 'received').find((g) => g.ok && g.grant.grantor.slice(2) === x && g.grant.label);
    return grant ? grant.grant.label : '';
  }

  /**
   * Every frame this participant sent or received, oldest first, as
   * `FabricMessageCollection`-style records (`hash`, `hex`, `type`, `direction`, `at`).
   * @returns {Promise<object[]>}
   */
  async frames () {
    await this.load();
    return this._state.frames.slice();
  }
}

/** @private */
function bufferOf (input) {
  if (input && typeof input.toBuffer === 'function') return input.toBuffer();
  if (Buffer.isBuffer(input)) return input;
  const decoded = decodeFabricUri(String(input || ''), { allowUnsigned: true, allowUnknownTypes: true });
  if (!decoded.ok) throw new Error(decoded.error);
  return decoded.buffer;
}

Delegation.memoryStore = memoryStore;

module.exports = Delegation;
