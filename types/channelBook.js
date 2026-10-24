'use strict';

/**
 * @fileoverview The host's registry of payment channel sessions: a
 * {@link Book} whose rows are `Channel.Session`s keyed by channel id.
 * Unlike the market books it never evicts — a full book refuses new channels.
 */

const crypto = require('crypto');
const Book = require('./book');
const Channel = require('./channel');
const Htlc = require('./htlc');
const { assertTestNetwork, normalizeNetworkName } = require('../functions/bitcoinNetworkAllowlist');

const ChannelSession = Channel.Session;
const CHANNEL_DEFAULTS = Channel.DEFAULTS;
const CHANNEL_BODY_TYPES = Channel.BODY_TYPES;
const expireHeight = Channel.expireHeight;

/** @private */
const HEX64 = /^[0-9a-f]{64}$/;

/** Settled credit rows kept (open rows are bounded by the credit limit). */
const MAX_SETTLED_CREDITS = 4096;

/** @private a credit / transfer ref: non-empty, ≤ 256 printable characters */
function creditRef (ref) {
  const s = ref == null ? '' : String(ref);
  return s && s.length <= 256 && !/[\u0000-\u001f\u007f]/.test(s) ? s : null;
}

/** @private */
function sha256Hex (buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * @classdesc Local registry of {@link ChannelSession}s for a host (Hub,
 * GoonCitizen, Passport): looks a channel up by counterparty, routes inbound
 * `Channel*` `CONTRACT_MESSAGE` bodies to the right session, forwards
 * multi-hop HTLCs, ticks sessions on new chain tips, and returns the bodies
 * and on-chain actions the host must handle. Shape expected by the market
 * agent's `attach({ channels })`.
 *
 * **Seller-fulfills (Lightning shape):** when the host supplies
 * `preimageFor(paymentHashHex, htlc)` the book fulfills every received HTLC
 * the host releases a preimage for as soon as the round that committed it
 * completes; the payer learns the preimage from the resulting
 * `ChannelHtlcFulfill`. The host sees the HTLC (amount, expiry, blob hash) and
 * must refuse underpaid ones.
 *
 * **Pay-after-verify credit:** a seller may serve a chunk before payment,
 * up to `creditLimitSats` outstanding per channel ({@link ChannelBook#extendCredit});
 * the buyer pays with a balance transfer ({@link ChannelBook#transfer}) whose
 * `ref` names the credit. No HTLC, so no HTLC minimum.
 *
 * Events: `htlcCommitted` (a received HTLC is irrevocably committed),
 * `htlcFulfilled` (a counterparty revealed a preimage to us), `htlcSettled`
 * (any HTLC left the channel; `outcome` is `fulfilled` or `failed`),
 * `transferReceived` (a balance transfer to us is final: the payer revoked
 * the state before it), `creditExtended` / `creditSettled`, and
 * `channelAction` (a new watchdog action, see {@link ChannelSession#tick}).
 * HTLC payloads are `{ channelId, session, htlcId, paymentHashHex,
 * blobHashHex, amountSats, direction, preimageHex?, outcome?, reason? }`.
 * @class ChannelBook
 */
class ChannelBook extends Book {
  /**
   * @param {object} opts `{ localPrivateKey, network, tipHeight?: function, confirmations?: function(txid)|true, publish?: function(body, session), persist?: function(session, body), preimageFor?: function(paymentHashHex, htlc), policy?, feerate?, staleTipMs?, forwardPolicy?: { feeSats, cltvDelta }, creditLimitSats?, maxEntries?, now? }`
   *   `persist(session, body)` runs before every publish (a returned promise
   *   delays the publish; a throw cancels it). Inbound `ChannelOpen` needs
   *   `confirmations`. `maxEntries` caps the channels held (default no cap).
   *   `creditLimitSats` (default 0: no credit) caps what one channel may owe.
   */
  constructor (opts = {}) {
    const settings = { maxEntries: opts.maxEntries != null ? opts.maxEntries : Infinity };
    if (typeof opts.now === 'function') settings.now = opts.now;
    super(settings);
    const priv = opts.localPrivateKey;
    this.localPrivateKey = Buffer.isBuffer(priv) ? priv : Buffer.from(String(priv || ''), 'hex');
    if (this.localPrivateKey.length !== 32) throw new Error('ChannelBook: localPrivateKey (32 bytes) required');
    this.localPubkey = Buffer.from(Htlc.signerFromPriv32(this.localPrivateKey).publicKey).toString('hex');
    this.network = assertTestNetwork(opts.network || 'regtest', 'Channel');
    this._tipFn = typeof opts.tipHeight === 'function' ? opts.tipHeight : null;
    // `confirmations: fn(txid)` (sync) or `true` to gate funding on the
    // host-fed cache (`setConfirmations`); omitted = funder-side trust only.
    this._confirmationCache = new Map();
    this._confirmations = typeof opts.confirmations === 'function'
      ? opts.confirmations
      : (opts.confirmations === true ? (txid) => this._confirmationCache.get(String(txid)) || 0 : null);
    this._publish = typeof opts.publish === 'function' ? opts.publish : null;
    this._persist = typeof opts.persist === 'function' ? opts.persist : null;
    this._preimageFor = typeof opts.preimageFor === 'function' ? opts.preimageFor : null;
    this.policy = Object.assign({}, opts.policy || {});
    this.feerate = Math.max(1, Math.floor(Number(opts.feerate) || 1));
    this.forwardPolicy = Object.assign({ feeSats: 1, cltvDelta: CHANNEL_DEFAULTS.minCltvDelta }, opts.forwardPolicy || {});
    this.staleTipMs = Math.floor(Number(opts.staleTipMs != null ? opts.staleTipMs : CHANNEL_DEFAULTS.staleTipMs));
    this._tip = { height: 0, at: 0 };
    this.peers = new Map(); // sellerId / address alias → channelId
    this.forwards = new Map(); // `${downstreamChannelId}:${htlcId}` → { channelId, htlcId }
    this.pendingPropagation = []; // upstream settlements to retry: { link, body }
    this.timeouts = []; // expired offered HTLCs as of the last tick
    this._announced = new Set(); // `${channelId}:${htlcId}` already emitted as htlcCommitted; `transfer:${channelId}:${number}` as transferReceived
    this._actionKeys = new Set();
    this.creditLimitSats = Math.max(0, Math.floor(Number(opts.creditLimitSats) || 0));
    this.credits = new Map(); // `${channelId}|${ref}` → { channelId, ref, amountSats, paidSats, extendedAt, settledAt }
  }

  /**
   * Record a fresh chain tip (hosts call on every block) and tick sessions.
   * @param {number} height
   * @returns {{ published: object[], actions: object[], timeouts: object[] }}
   */
  setTip (height) {
    const h = Math.floor(Number(height) || 0);
    if (h > 0) this._tip = { height: h, at: this.now() };
    return this.tick();
  }

  /**
   * Host-fed confirmation count for a funding txid (see `confirmations: true`).
   * @param {string} txid
   * @param {number} confirmations
   */
  setConfirmations (txid, confirmations) {
    this._confirmationCache.set(String(txid), Math.floor(Number(confirmations) || 0));
  }

  /** @returns {string[]} funding txids of sessions still waiting on confirmations */
  pendingFundingTxids () {
    const out = [];
    for (const s of this._rows()) {
      if (s.state.fundingConfirmed) continue;
      if (s.funding.fundingTxid) out.push(s.funding.fundingTxid);
    }
    return [...new Set(out)];
  }

  /**
   * New-block hook for hosts: record the tip, tick sessions, and classify any
   * transactions the host hands over (mempool / block bodies).
   * @param {object} opts `{ height, txHexes?, blockHeaderHex?, txids?, destinationAddress?, feeSats? }` — `blockHeaderHex` + `txids` (block order) let stale-commitment proofs carry an inclusion branch
   * @returns {{ published: object[], actions: object[], observations: object[] }}
   */
  onBlock (opts = {}) {
    const ticked = this.setTip(opts.height);
    const observations = [];
    const inclusion = opts.blockHeaderHex && Array.isArray(opts.txids) ? { blockHeaderHex: opts.blockHeaderHex, txids: opts.txids } : undefined;
    for (const hex of opts.txHexes || []) observations.push(...this.observe(hex, { destinationAddress: opts.destinationAddress, feeSats: opts.feeSats, inclusion }));
    return { published: ticked.published, actions: ticked.actions, observations };
  }

  /** @returns {number|null} tip height, or `null` when unknown / stale (refuses new HTLCs) */
  tipHeight () {
    if (this._tipFn) {
      const h = Number(this._tipFn());
      if (Number.isFinite(h) && h > 0) { this._tip = { height: h, at: this.now() }; return h; }
    }
    if (!this._tip.height) return null;
    if (this.staleTipMs > 0 && this.now() - this._tip.at > this.staleTipMs) return null;
    return this._tip.height;
  }

  /** @returns {boolean} chain view is usable for expiry decisions */
  get tipFresh () { return this.tipHeight() != null; }

  /**
   * @private deps handed to every session. `tipHeight` is **always** wired so
   * a session never mistakes "no chain view" for "no expiry rule": with an
   * unknown tip sessions refuse new HTLCs and refuse sender-side fails.
   */
  _sessionDeps () {
    return {
      tipHeight: () => this.tipHeight(),
      confirmations: this._confirmations || undefined
    };
  }

  /**
   * Host-side preimage lookup (seller-fulfills). The host function receives
   * `(paymentHashHex, htlc)` and may return the preimage hex or an object with
   * `keyHex` / `preimageHex`. With an `htlc` the host is authoritative (it
   * decides whether that HTLC pays enough); without one, preimages any session
   * on this book has learned are a fallback.
   * @param {string} paymentHashHex
   * @param {object} [htlc] the received HTLC row asking for it
   * @returns {string|null}
   */
  preimageFor (paymentHashHex, htlc = null) {
    const hash = String(paymentHashHex || '').toLowerCase();
    const norm = (v) => {
      const raw = v && typeof v === 'object' ? (v.keyHex || v.preimageHex) : v;
      const pre = String(raw || '').toLowerCase();
      return HEX64.test(pre) && sha256Hex(Buffer.from(pre, 'hex')) === hash ? pre : null;
    };
    if (this._preimageFor) {
      let pre = null;
      try { pre = norm(this._preimageFor(hash, htlc ? Object.assign({}, htlc) : undefined)); } catch (_) { pre = null; }
      if (pre || htlc) return pre;
    }
    for (const s of this._rows()) {
      const pre = s.preimageFor(hash);
      if (pre) return pre;
    }
    return null;
  }

  /** @private event payload for an HTLC row */
  _htlcEvent (session, row, extra = {}) {
    return Object.assign({
      channelId: session.channelId,
      session,
      htlcId: row.id,
      paymentHashHex: row.paymentHashHex,
      blobHashHex: row.blobHashHex || null,
      amountSats: row.amountSats,
      direction: row.direction,
      forwardOf: row.forwardOf || null
    }, extra);
  }

  /**
   * @private fulfill the first committed received HTLC whose preimage we may
   * release (one per call — each fulfill opens a new round). Too close to
   * expiry the preimage is only handed to the session, whose watchdog then
   * asks for an on-chain claim.
   */
  _autoFulfil (session) {
    const ready = !session.busy && session.status === 'open';
    for (const h of session.state.htlcs) {
      if (h.direction !== 'received') continue;
      const pre = session.preimageFor(h.paymentHashHex) || this.preimageFor(h.paymentHashHex, h);
      if (!pre) continue;
      if (!session.canFulfil(h)) { session.learnPreimage(h.paymentHashHex, pre); continue; }
      if (!ready) continue;
      try {
        const body = session.fulfillHtlc(h.id, pre);
        this.publish(body, session);
        return body;
      } catch (_) { /* try the next */ }
    }
    return null;
  }

  /** @private replay an intent rolled back in a proposal collision */
  _repropose (session) {
    const body = session.repropose();
    if (body) this.publish(body, session);
    return body;
  }

  /**
   * Register a session under a channel id plus any peer aliases (Fabric id,
   * `pubkey@host:port`, connection name) used by offers. Refuses to replace
   * a different session already registered under that channel id, and a new
   * channel when the book is full (a session holds funds: never evicted).
   * @param {ChannelSession} session
   * @param {string[]} [aliases]
   * @returns {ChannelSession}
   */
  add (session, aliases = []) {
    const existing = this._row(session.channelId);
    if (existing && existing !== session) throw new Error(`ChannelBook: channel ${session.channelId} already registered`);
    if (!existing) {
      if (this.size >= this.capacity) throw new Error(`ChannelBook: full (${this.capacity} channels)`);
      this._insert(session.channelId, session);
    }
    this.peers.set(session.funding.remotePubkey, session.channelId);
    for (const a of aliases) if (a) this.peers.set(String(a), session.channelId);
    return session;
  }

  /**
   * @param {string} channelId
   * @returns {ChannelSession|null}
   */
  get (channelId) {
    return this._row(String(channelId)) || null;
  }

  /**
   * @param {string} sellerId offer `sellerId` / `sellerAddress`
   * @param {string|null} [pubkeyHex] compressed counterparty key when known
   * @returns {ChannelSession|null}
   */
  sessionFor (sellerId, pubkeyHex = null) {
    const id = (pubkeyHex && this.peers.get(String(pubkeyHex).toLowerCase())) || this.peers.get(String(sellerId || ''));
    return id ? this._row(id) || null : null;
  }

  /**
   * Publish hook used by the market agent (`channels.publish(body, session)`).
   * Runs `persist(session, body)` first: a sync throw cancels the publish and
   * propagates; a returned promise delays it (rejection → `error` event).
   * @param {object|object[]} body
   * @param {ChannelSession} [session]
   */
  publish (body, session = null) {
    if (!body) return;
    if (Array.isArray(body)) { for (const b of body) this.publish(b, session); return; }
    const send = () => { if (this._publish) this._publish(body, session); };
    if (this._persist && session) {
      const persisted = this._persist(session, body);
      if (persisted && typeof persisted.then === 'function') {
        persisted.then(send, (e) => { if (this.listenerCount('error')) this.emit('error', e); });
        return;
      }
    }
    send();
  }

  /**
   * Open a channel toward a counterparty as the funder. The funder's opening
   * balance is `capacity − fee − anchors`. Without `feeSats` the commitment
   * fee follows `feerate` (default the book's, 1 sat/vB) and the HTLC count.
   * @param {object} opts `{ remotePubkey, fundedTxHex, capacitySats, expireAfter, localAddress, remoteAddress, feeSats?, feerate?, toSelfDelay?, fundingVout?, policy?, aliases? }`
   * @returns {{ session: ChannelSession, body: object }} `ChannelOpen` body to publish
   */
  open (opts = {}) {
    const policy = Object.assign({}, this.policy, opts.policy || {});
    const capacity = Math.floor(Number(opts.capacitySats));
    const feerate = opts.feeSats != null ? null : Math.max(1, Math.floor(Number(opts.feerate) || this.feerate));
    const fee = opts.feeSats != null
      ? Math.floor(Number(opts.feeSats))
      : Math.max(Channel.negotiatePolicy(policy, {}, capacity).minCommitFeeSats, Channel.commitmentFeeSats(feerate, 0));
    const funding = Channel.buildFunding({ network: this.network, localPubkey: this.localPubkey, remotePubkey: opts.remotePubkey, expireAfter: opts.expireAfter, capacitySats: capacity, toSelfDelay: opts.toSelfDelay });
    if (opts.fundingVout != null) funding.fundingVout = Math.floor(Number(opts.fundingVout));
    const session = new ChannelSession(Object.assign({
      funding,
      fundedTxHex: opts.fundedTxHex,
      localPrivateKey: this.localPrivateKey,
      localSats: capacity - fee - 2 * CHANNEL_DEFAULTS.anchorSats,
      remoteSats: 0,
      localAddress: opts.localAddress,
      remoteAddress: opts.remoteAddress,
      feeSats: fee,
      feerate,
      policy
    }, this._sessionDeps()));
    this.add(session, opts.aliases || []);
    const body = session.open();
    this.publish(body, session);
    return { session, body };
  }

  /**
   * Route an inbound `Channel*` body. Unknown channels are accepted only on
   * `ChannelOpen` addressed to our key (we become the non-funding side), and
   * only when the book has a `confirmations` source. Settlements on a
   * forwarded downstream HTLC propagate upstream.
   * @param {object} body signed artifact
   * @param {object} [meta] `{ sellerId? }` alias for the counterparty
   * @returns {object|object[]|null} reply body (already published through the hook)
   */
  ingest (body = {}, meta = {}) {
    if (!body || typeof body.type !== 'string' || !body.type.startsWith('Channel')) return null;
    let session = this._row(String(body.channelId));
    let fresh = false;
    if (!session) {
      if (body.type !== CHANNEL_BODY_TYPES.Open || !body.funding) return null;
      const f = body.funding;
      if (String(f.remotePubkey).toLowerCase() !== this.localPubkey) return null;
      if (normalizeNetworkName(f.network) !== this.network) return null;
      if (!this._confirmations) throw new Error('ChannelBook: inbound ChannelOpen needs a confirmations source (confirmations option)');
      if (!f.fundingTxid) throw new Error('ChannelBook: inbound ChannelOpen without a funding outpoint');
      const funding = Channel.buildFunding({ network: f.network, localPubkey: this.localPubkey, remotePubkey: f.localPubkey, expireAfter: f.expireAfter, capacitySats: f.capacitySats, toSelfDelay: f.toSelfDelay, funder: f.funder === f.localPubkey ? 'remote' : 'local', fundingTxid: f.fundingTxid, fundingVout: f.fundingVout });
      session = new ChannelSession(Object.assign({
        funding,
        fundedTxHex: body.fundedTxHex,
        localPrivateKey: this.localPrivateKey,
        localSats: Number(body.remoteSats) || 0,
        remoteSats: Number(body.localSats) || 0,
        localAddress: body.remoteAddress,
        remoteAddress: body.localAddress,
        feeSats: body.feeSats,
        feerate: body.feerate,
        policy: this.policy
      }, this._sessionDeps()));
      if (session.channelId !== String(body.channelId)) return null;
      fresh = true;
    }
    const wasBusy = session.busy;
    const settledBefore = session.state.settled.length;
    // Validate first: a fresh session is registered only once its opening
    // body verified, so a malformed `ChannelOpen` cannot park a dead entry
    // under our counterparty's key.
    const reply = session.ingest(body);
    if (fresh) this.add(session, meta.sellerId ? [meta.sellerId] : []);
    this.publish(reply, session);
    if ((body.type === CHANNEL_BODY_TYPES.HtlcFulfill || body.type === CHANNEL_BODY_TYPES.HtlcFail) && session.state.settled.length > settledBefore) {
      const row = session.state.settled[session.state.settled.length - 1];
      const ev = this._htlcEvent(session, Object.assign({ direction: 'offered' }, row), { outcome: row.outcome, reason: row.reason || null, preimageHex: row.outcome === 'fulfilled' ? session.preimageFor(row.paymentHashHex) : null });
      if (row.outcome === 'fulfilled') this.emit('htlcFulfilled', ev);
      this.emit('htlcSettled', ev);
      this._propagate(session, body);
    }
    // A received HTLC becomes irrevocably committed once the round that
    // added it has completed on both sides (`busy` cleared).
    if (!session.busy) {
      if (wasBusy) {
        for (const h of session.state.htlcs) {
          const key = `${session.channelId}:${h.id}`;
          if (h.direction !== 'received' || this._announced.has(key)) continue;
          this._announced.add(key);
          this.emit('htlcCommitted', this._htlcEvent(session, h));
        }
        this._retryPropagation();
      }
      if (!session.busy && !this._autoFulfil(session)) this._repropose(session);
    }
    this._announceTransfers(session);
    return reply;
  }

  /**
   * @private emit received transfers once final (the payer revoked the state
   * before the transfer, so it can no longer close without it) and apply
   * them to the credit their `ref` names
   */
  _announceTransfers (session) {
    const s = session.state;
    for (const t of s.transfers || []) {
      if (t.direction !== 'received' || s.remoteRevokedThrough < t.number - 1) continue;
      const key = `transfer:${session.channelId}:${t.number}`;
      if (this._announced.has(key)) continue;
      this._announced.add(key);
      const credit = t.ref ? this.credits.get(`${session.channelId}|${t.ref}`) : null;
      if (credit && !credit.settledAt) {
        credit.paidSats += t.amountSats;
        if (credit.paidSats >= credit.amountSats) {
          credit.settledAt = this.now();
          this.emit('creditSettled', Object.assign({ session }, credit));
          this._trimCredits();
        }
      }
      this.emit('transferReceived', { channelId: session.channelId, session, amountSats: t.amountSats, ref: t.ref || null, number: t.number, credit: credit ? Object.assign({}, credit) : null });
    }
  }

  /** @private resolve a channel id or a counterparty alias / key to a session */
  _sessionOf (counterparty, pubkeyHex = null) {
    return this._row(String(counterparty || '')) || this.sessionFor(counterparty, pubkeyHex);
  }

  /**
   * Sats a channel still owes on credit we extended.
   * @param {string} counterparty channel id, or a counterparty alias / key
   * @param {string|null} [pubkeyHex]
   * @returns {number}
   */
  outstanding (counterparty, pubkeyHex = null) {
    const session = this._sessionOf(counterparty, pubkeyHex);
    if (!session) return 0;
    let owed = 0;
    for (const c of this.credits.values()) {
      if (c.channelId === session.channelId && !c.settledAt) owed += c.amountSats - c.paidSats;
    }
    return owed;
  }

  /**
   * Seller side of pay-after-verify: serve first, record that the buyer owes
   * `amountSats` for `ref` over its channel with us. Refused without an open
   * channel, for a `ref` already used, past the credit limit, or when the
   * buyer's channel balance (above its reserve) could not pay everything it
   * would then owe. Paid by a transfer carrying the same `ref`. Also takes
   * the request `Peer` passes to `settings.sealedBlobCredit` (`buyer`,
   * `buyerPubkey`, `priceSats`), so hosts wire
   * `sealedBlobCredit: (r) => book.extendCredit(r)`.
   * @param {object} opts `{ counterparty, pubkeyHex?, ref, amountSats, limitSats? }`
   * @returns {{ ok: boolean, channelId: (string|undefined), outstandingSats: (number|undefined), error: (string|undefined) }}
   */
  extendCredit (opts = {}) {
    const session = this._sessionOf(opts.counterparty || opts.buyer, opts.pubkeyHex || opts.buyerPubkey || null);
    if (!session || session.status !== 'open') return { ok: false, error: 'no open channel with that buyer' };
    const ref = creditRef(opts.ref);
    if (!ref) return { ok: false, error: 'credit ref required (≤ 256 printable characters)' };
    const amount = Number(opts.amountSats != null ? opts.amountSats : opts.priceSats);
    if (!Number.isSafeInteger(amount) || amount < 1) return { ok: false, error: 'amountSats must be a positive integer' };
    const key = `${session.channelId}|${ref}`;
    if (this.credits.has(key)) return { ok: false, error: 'credit ref already used' };
    const limit = opts.limitSats != null ? Math.max(0, Math.floor(Number(opts.limitSats) || 0)) : this.creditLimitSats;
    const owed = this.outstanding(session.channelId);
    if (owed + amount > limit) return { ok: false, error: `credit limit ${limit} sats reached (${owed} outstanding)` };
    const payable = session.balances.remoteSats - session.state.policy.channelReserveSats;
    if (owed + amount > payable) return { ok: false, error: 'buyer channel balance cannot cover the credit' };
    const row = { channelId: session.channelId, ref, amountSats: amount, paidSats: 0, extendedAt: this.now(), settledAt: null };
    this.credits.set(key, row);
    this.emit('creditExtended', Object.assign({ session }, row));
    return { ok: true, channelId: session.channelId, outstandingSats: owed + amount };
  }

  /**
   * @param {string} [channelId] only this channel
   * @returns {object[]} credit rows (`settledAt` null while owed)
   */
  listCredits (channelId = null) {
    return [...this.credits.values()].filter((c) => !channelId || c.channelId === String(channelId)).map((c) => Object.assign({}, c));
  }

  /** @private drop the oldest settled rows past `MAX_SETTLED_CREDITS` */
  _trimCredits () {
    let settled = 0;
    for (const c of this.credits.values()) if (c.settledAt) settled++;
    for (const [k, c] of this.credits) {
      if (settled <= MAX_SETTLED_CREDITS) break;
      if (!c.settledAt) continue;
      this.credits.delete(k);
      settled--;
    }
  }

  /**
   * Buyer side: pay a counterparty `amountSats` from our channel balance
   * (no HTLC; see {@link ChannelSession#transfer}) and publish it.
   * @param {string} counterparty seller id / alias, key, or channel id
   * @param {number} amountSats
   * @param {string} [ref] the credit being paid
   * @param {string|null} [pubkeyHex]
   * @returns {object} `ChannelCommitment` body (published)
   */
  transfer (counterparty, amountSats, ref = null, pubkeyHex = null) {
    const session = this._sessionOf(counterparty, pubkeyHex);
    if (!session) throw new Error('ChannelBook.transfer: no channel with that counterparty');
    const body = session.transfer({ amountSats, ref });
    this.publish(body, session);
    return body;
  }

  /** @private settle the upstream leg of a forwarded HTLC */
  _propagate (downstream, body) {
    const key = `${downstream.channelId}:${body.htlcId}`;
    const link = this.forwards.get(key);
    if (!link) return;
    this.forwards.delete(key);
    this._settleUpstream(link, { type: body.type, htlcId: body.htlcId, preimageHex: body.preimageHex || null, reason: body.reason || null });
  }

  /** @private @returns {object|null} body published upstream */
  _settleUpstream (link, body) {
    const upstream = this._row(link.channelId);
    if (!upstream) return null;
    const fulfil = body.type === CHANNEL_BODY_TYPES.HtlcFulfill;
    if (fulfil) upstream.learnPreimage(null, body.preimageHex);
    if (!upstream.state.htlcs.some((h) => h.id === link.htlcId)) return null;
    try {
      const out = fulfil
        ? upstream.fulfillHtlc(link.htlcId, body.preimageHex)
        : upstream.failHtlc(link.htlcId, body.reason || 'downstream-failed');
      this.publish(out, upstream);
      return out;
    } catch (e) {
      this.pendingPropagation.push({ link, body, error: e.message });
      return null;
    }
  }

  /** @private retry upstream settlements that failed (busy / tip unknown) */
  _retryPropagation () {
    const pending = this.pendingPropagation;
    this.pendingPropagation = [];
    const out = [];
    for (const p of pending) {
      const body = this._settleUpstream(p.link, p.body);
      if (body) out.push(body);
    }
    return out;
  }

  /**
   * Forward a received HTLC onto another channel (multi-hop): the upstream
   * HTLC must be irrevocably committed (in the last countersigned state, no
   * round in flight); enforces {@link Channel.checkForward} with this node's
   * policy, with a CLTV delta of at least {@link Channel.minForwardCltvDelta}
   * for the downstream channel; offers the downstream HTLC with `forwardOf`,
   * and links the two for settlement.
   * @param {ChannelSession} upstream
   * @param {string} upstreamHtlcId
   * @param {ChannelSession} downstream
   * @param {object} [policy] `{ feeSats, cltvDelta }` (defaults to `forwardPolicy`)
   * @returns {object} downstream `ChannelCommitment` body (published)
   */
  forward (upstream, upstreamHtlcId, downstream, policy = null) {
    if (upstream === downstream) throw new Error('forward: cannot forward onto the same channel');
    const p = Object.assign({}, this.forwardPolicy, policy || {});
    const up = upstream.state.htlcs.find((h) => h.id === String(upstreamHtlcId) && h.direction === 'received');
    if (!up) throw new Error('forward: upstream HTLC not received on that channel');
    const ls = upstream.state.lastSigned;
    if (upstream.busy || !ls || !ls.htlcs.some((h) => h.id === up.id)) throw new Error('forward: upstream HTLC not irrevocably committed yet');
    const cltvDelta = Math.max(Math.floor(Number(p.cltvDelta) || 0), Channel.minForwardCltvDelta(downstream));
    const fwd = Object.assign({}, p, { cltvDelta });
    const down = { amountSats: up.amountSats - Math.floor(Number(p.feeSats) || 0), expireAfter: { type: 'cltv', height: expireHeight(up) - cltvDelta }, paymentHashHex: up.paymentHashHex };
    if (down.amountSats < 1) throw new Error('forward: fee-short');
    const check = Channel.checkForward(up, down, fwd);
    if (!check.ok) throw new Error(`forward: ${check.reason}`);
    const body = downstream.offerHtlc({ amountSats: down.amountSats, paymentHashHex: up.paymentHashHex, blobHashHex: up.blobHashHex, expireAfter: down.expireAfter, forwardOf: { channelId: upstream.channelId, htlcId: up.id } });
    this.forwards.set(`${downstream.channelId}:${body.htlc.id}`, { channelId: upstream.channelId, htlcId: up.id });
    this.publish(body, downstream);
    return body;
  }

  /**
   * Tick every session with the current tip: publishes auto-fail / fulfil
   * bodies, retries pending upstream settlements and rolled-back proposals,
   * and collects the watchdog actions ({@link ChannelSession#tick}). New
   * actions are also emitted as `channelAction`.
   * @returns {{ published: object[], actions: object[], timeouts: object[] }}
   */
  tick () {
    const tip = this.tipHeight();
    const published = this._retryPropagation();
    const actions = [];
    const timeouts = [];
    for (const session of this._rows()) {
      const settledBefore = session.state.settled.length;
      // Released preimages reach the session before its watchdog runs, so a
      // fulfill without margin becomes a claim action this tick.
      const early = this._autoFulfil(session);
      if (early) published.push(early);
      const r = session.tick(tip || 0);
      for (const b of r.bodies) { this.publish(b, session); published.push(b); }
      for (const t of r.timeouts) timeouts.push(Object.assign({ channelId: session.channelId }, t));
      actions.push(...r.actions);
      if (!session.busy) {
        const b = this._autoFulfil(session) || this._repropose(session);
        if (b) published.push(b);
      }
      for (const row of session.state.settled.slice(settledBefore)) {
        const ev = this._htlcEvent(session, Object.assign({ direction: 'offered' }, row), { outcome: row.outcome, reason: row.reason || null, preimageHex: row.outcome === 'fulfilled' ? session.preimageFor(row.paymentHashHex) : null });
        if (row.outcome === 'fulfilled') this.emit('htlcFulfilled', ev);
        this.emit('htlcSettled', ev);
      }
      this._announceTransfers(session);
    }
    const keys = new Set();
    for (const a of actions) {
      const key = `${a.type}:${a.channelId}:${a.htlcId || a.reason}`;
      keys.add(key);
      if (!this._actionKeys.has(key)) this.emit('channelAction', a);
    }
    this._actionKeys = keys;
    this.timeouts = timeouts;
    return { published, actions, timeouts };
  }

  /**
   * Resend state after a reconnect: a `ChannelReestablish` per session (the
   * peer answers with what we missed), or the `ChannelOpen` itself while the
   * peer never answered it.
   * @param {string} [channelId] one channel, default all
   * @returns {object[]} bodies published
   */
  reestablish (channelId = null) {
    const sessions = channelId ? [this._row(String(channelId))].filter(Boolean) : [...this._rows()];
    const out = [];
    for (const s of sessions) {
      const update = s.state.outbox && s.state.outbox.update;
      const body = s.isFunder && !s.state.lastSigned && update && update.type === CHANNEL_BODY_TYPES.Open ? update : s.reestablish();
      this.publish(body, s);
      out.push(body);
    }
    return out;
  }

  /**
   * Hand an observed transaction to every session (mempool / block hook).
   * @param {string} txHex
   * @param {object} [opts] `{ destinationAddress?, feeSats?, excludeVouts?, perOutput? }`
   * @returns {object[]} non-`unknown` observations
   */
  observe (txHex, opts = {}) {
    const out = [];
    for (const session of this._rows()) {
      try {
        const r = session.observe(txHex, opts);
        if (r.kind !== 'unknown') out.push(Object.assign({ channelId: session.channelId }, r));
      } catch (_) { /* not ours */ }
    }
    return out;
  }

  /** @returns {object} persistence snapshot (no private key) */
  export () {
    return {
      type: 'ChannelBookState',
      version: 2,
      network: this.network,
      sessions: [...this._rows()].map((s) => s.export()),
      peers: Object.fromEntries(this.peers),
      forwards: Object.fromEntries(this.forwards),
      announced: [...this._announced],
      pendingPropagation: this.pendingPropagation.map((p) => ({ link: p.link, body: p.body })),
      credits: this.listCredits()
    };
  }

  /** @param {object} snapshot @returns {ChannelBook} */
  import (snapshot = {}) {
    for (const snap of snapshot.sessions || []) {
      try { this.add(ChannelSession.import(snap, this.localPrivateKey, this._sessionDeps())); } catch (_) { /* skip foreign / duplicate */ }
    }
    for (const [alias, id] of Object.entries(snapshot.peers || {})) if (this.has(id)) this.peers.set(alias, id);
    for (const [k, v] of Object.entries(snapshot.forwards || {})) this.forwards.set(k, v);
    for (const k of snapshot.announced || []) this._announced.add(String(k));
    for (const p of snapshot.pendingPropagation || []) if (p && p.link && p.body) this.pendingPropagation.push({ link: p.link, body: p.body });
    for (const c of snapshot.credits || []) {
      const ref = c && creditRef(c.ref);
      const amountSats = Number(c && c.amountSats);
      if (!ref || !this.has(c.channelId) || !Number.isSafeInteger(amountSats) || amountSats < 1) continue;
      this.credits.set(`${c.channelId}|${ref}`, {
        channelId: String(c.channelId),
        ref,
        amountSats,
        paidSats: Math.max(0, Math.floor(Number(c.paidSats) || 0)),
        extendedAt: Number(c.extendedAt) || 0,
        settledAt: c.settledAt ? Number(c.settledAt) : null
      });
    }
    return this;
  }

  /** @returns {object[]} public summaries */
  list () {
    return [...this._rows()].map((s) => ({
      channelId: s.channelId,
      remotePubkey: s.funding.remotePubkey,
      status: s.status,
      number: s.number,
      lastSignedNumber: s.state.lastSigned ? s.state.lastSigned.number : null,
      balances: s.balances,
      pendingHtlcs: s.state.htlcs.length,
      settled: s.state.settled.length,
      fullySigned: s.fullySigned,
      busy: s.busy,
      revokedStates: Object.keys(s.state.revoked).length
    }));
  }
}

module.exports = ChannelBook;
module.exports.ChannelBook = ChannelBook;
