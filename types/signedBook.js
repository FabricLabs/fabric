'use strict';

/**
 * @fileoverview Locally held book of signed, expiring maker entries
 * (coinjoin offers, liquidity orders). Makers gossip signed bodies; each node
 * verifies and keeps its own book. This class holds what every such market
 * shares: signed ingest, signed cancels (remembered so a replayed entry stays
 * dead), expiry pruning, and dropping a maker. Subclasses supply the codec
 * and body types; {@link OrderBook} adds the maker market views.
 *
 * {@link SignedBook.codec} builds a market's body codec: normalize, canonical
 * signing bytes, body id, BIP340 sign and verify. `types/coinjoin` and
 * `types/swap` carry their own as `Coinjoin` / `Swap` statics.
 */

const crypto = require('crypto');
const ecc = require('./ecc');
const { stableStringify, jsonSafe } = require('../functions/fabricCanonicalJson');
const Book = require('./book');

/**
 * Cancels remembered so a replayed entry stays dead.
 * @private
 */
const MAX_CANCELLED = 10000;
/**
 * Cancels one key may hold for entries this book has not seen. Anyone can
 * sign those, so they are capped per signer and evicted first.
 * @private
 */
const MAX_PENDING_CANCELS_PER_MAKER = 100;

/** @private */
function cancelKey (entryId, makerPubkey) {
  return `${entryId}:${makerPubkey}`;
}

/** @private */
function makerOf (key) {
  return key.slice(key.indexOf(':') + 1);
}

/** @private a non-negative count setting, else `fallback` */
function limitOf (value, fallback) {
  const n = Number(value);
  return value == null || Number.isNaN(n) || n < 0 ? fallback : n;
}

/**
 * Canonical signing bytes: the body without `signature`.
 * @param {Object} body
 * @returns {string}
 */
function signingString (body) {
  const copy = Object.assign({}, body);
  delete copy.signature;
  return stableStringify(jsonSafe(copy));
}

/**
 * Stable id of a body: SHA-256 hex of {@link signingString}. Entries, takes,
 * and accepts are referenced by it.
 * @param {Object} body
 * @returns {string}
 */
function bodyId (body) {
  return crypto.createHash('sha256').update(signingString(body)).digest('hex');
}

/** @returns {string} 16 random bytes as hex */
function randomNonce () {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Body codec for one signed market: every body is a JSON object with a
 * `type`, normalized by that type's normalizer and BIP340-signed by the key
 * named by `signerField` over {@link signingString}.
 * @param {Object} spec
 * @param {string} spec.name prefix of thrown messages (`coinjoin`)
 * @param {number} spec.version accepted `version` of incoming bodies
 * @param {Map<string, Function>} spec.normalizers body type → `(fields) → body` (throws on bad input)
 * @param {Object} spec.signerField body type → field holding the author's compressed key
 * @returns {Object} `{ toBody, fromBody, signingString, bodyId, pubkeyFromPrivate, signBody, verifyBody, randomNonce }`
 */
function codec (spec) {
  const { name, version, normalizers, signerField } = spec;
  const fail = (message) => {
    throw new Error(`${name}: ${message}`);
  };

  const privOf = (signer) => {
    let priv;
    if (Buffer.isBuffer(signer) || signer instanceof Uint8Array) {
      priv = Buffer.from(signer);
    } else {
      const s = String(signer == null ? '' : signer).trim().toLowerCase().replace(/^0x/, '');
      if (!/^[0-9a-f]{64}$/.test(s)) fail('private key must be 64 hex characters');
      priv = Buffer.from(s, 'hex');
    }
    if (priv.length !== 32 || !ecc.isPrivate(priv)) fail('invalid private key');
    return priv;
  };

  /**
   * Build a normalized body of the given type (unsigned unless `fields.signature`).
   * @param {string} type
   * @param {Object} fields
   * @returns {Object}
   */
  const toBody = (type, fields = {}) => {
    const normalize = normalizers.get(type);
    if (!normalize) fail(`unknown body type ${type}`);
    return normalize(fields);
  };

  /**
   * Rehydrate a `CONTRACT_MESSAGE` body; `null` for other types or malformed bodies.
   * @param {Object} body
   * @returns {Object|null}
   */
  const fromBody = (body) => {
    const normalize = body && typeof body === 'object' ? normalizers.get(body.type) : null;
    if (!normalize) return null;
    if (body.version != null && Number(body.version) !== version) return null;
    try {
      return normalize(body);
    } catch {
      return null;
    }
  };

  /**
   * Compressed public key for a 32-byte private key.
   * @param {Buffer|string} priv32
   * @returns {string} 66 hex characters
   */
  const pubkeyFromPrivate = (priv32) => {
    return Buffer.from(ecc.pointFromScalar(privOf(priv32), true)).toString('hex');
  };

  /**
   * Normalize and BIP340-sign a body. The signer must own the body's author key.
   * @param {Object} body
   * @param {Buffer|string} priv32
   * @returns {Object} normalized body with `signature`
   */
  const signBody = (body, priv32) => {
    const unsigned = toBody(body.type, Object.assign({}, body, { signature: undefined }));
    const priv = privOf(priv32);
    const field = signerField[unsigned.type];
    if (pubkeyFromPrivate(priv) !== unsigned[field]) fail(`signing key does not match ${field}`);
    const hash = crypto.createHash('sha256').update(signingString(unsigned)).digest();
    const sig = Buffer.from(ecc.signSchnorr(hash, priv)).toString('hex');
    return Object.assign(unsigned, { signature: sig });
  };

  /**
   * Check a body's shape and its author's BIP340 signature.
   * @param {Object} body
   * @returns {{ ok: boolean, reason: (string|null), body: (Object|null), id: (string|null) }}
   */
  const verifyBody = (body) => {
    const normalized = fromBody(body);
    if (!normalized) return { ok: false, reason: 'malformed body', body: null, id: null };
    if (!normalized.signature) return { ok: false, reason: 'unsigned body', body: normalized, id: null };
    const xonly = Buffer.from(normalized[signerField[normalized.type]], 'hex').subarray(1);
    const hash = crypto.createHash('sha256').update(signingString(normalized)).digest();
    let ok = false;
    try {
      ok = ecc.verifySchnorr(hash, xonly, Buffer.from(normalized.signature, 'hex'));
    } catch {
      ok = false;
    }
    if (!ok) return { ok: false, reason: 'bad signature', body: normalized, id: null };
    return { ok: true, reason: null, body: normalized, id: bodyId(normalized) };
  };

  return Object.freeze({
    toBody,
    fromBody,
    signingString,
    bodyId,
    pubkeyFromPrivate,
    signBody,
    verifyBody,
    randomNonce
  });
}

class SignedBook extends Book {
  /**
   * @param {Object} [settings]
   * @param {string} [settings.network='regtest'] only entries for this network are held
   * @param {number} [settings.maxCancelled=10000]
   * @param {number} [settings.maxPendingCancelsPerMaker=100] cancels per key for entries not held
   * @param {Function} [settings.now] clock in ms (tests)
   * @param {Object} spec what the subclass trades
   * @param {Object} spec.codec the market's {@link SignedBook.codec}
   * @param {string} spec.entryType body type of an entry (e.g. `CoinjoinOffer`)
   * @param {string} spec.cancelType body type of a cancel
   * @param {string} spec.field row field holding the verified body (`offer`, `order`)
   * @param {string} spec.idField cancel body field naming the entry (`offerId`, `orderId`)
   * @param {string} spec.noun used in reasons (`offer expired`, `duplicate order`)
   * @param {string} [spec.capacitySetting='maxEntries'] setting holding the row cap
   */
  constructor (settings = {}, spec = {}) {
    super(Object.assign({
      network: 'regtest',
      maxCancelled: MAX_CANCELLED,
      maxPendingCancelsPerMaker: MAX_PENDING_CANCELS_PER_MAKER
    }, settings));
    this.settings.network = String(this.settings.network).toLowerCase();
    this.settings.maxCancelled = limitOf(this.settings.maxCancelled, MAX_CANCELLED);
    this.settings.maxPendingCancelsPerMaker = limitOf(this.settings.maxPendingCancelsPerMaker, MAX_PENDING_CANCELS_PER_MAKER);
    this._spec = Object.freeze(Object.assign({ capacitySetting: 'maxEntries' }, spec));
    // `entryId:makerPubkey` → the cancelled entry's `expiresAt`, or null while it is not held
    this._cancelled = new Map();
    // maker → keys of its cancels for entries not held
    this._pendingCancels = new Map();
    // maker → keys of all its remembered cancels, oldest first
    this._makerCancels = new Map();
    this._seq = 0;
  }

  /** @returns {number} */
  get capacity () {
    return this.settings[this._spec.capacitySetting];
  }

  /**
   * The verified body held in a row.
   * @private
   */
  _body (row) {
    return row[this._spec.field];
  }

  /**
   * Verify and hold a signed entry body.
   * @protected
   * @param {Object} body
   * @returns {{ ok: boolean, id: (string|null), reason: (string|null), duplicate: (boolean|undefined) }}
   */
  _ingestSigned (body) {
    const { codec, entryType, field, noun } = this._spec;
    if (!body || body.type !== entryType) return { ok: false, id: null, reason: `not a ${entryType}` };
    const v = codec.verifyBody(body);
    if (!v.ok) return { ok: false, id: null, reason: v.reason };
    const entry = v.body;
    if (entry.network !== this.settings.network) return { ok: false, id: v.id, reason: 'wrong network' };
    if (entry.expiresAt <= this.now()) return { ok: false, id: v.id, reason: `${noun} expired` };
    const cancelled = cancelKey(v.id, entry.makerPubkey);
    if (this._cancelled.has(cancelled)) {
      this._confirmCancel(cancelled, entry.expiresAt);
      return { ok: false, id: v.id, reason: `${noun} cancelled` };
    }
    if (this.has(v.id)) return { ok: false, id: v.id, reason: `duplicate ${noun}`, duplicate: true };
    this.prune();
    this._beforeInsert(entry);
    this._insert(v.id, { id: v.id, [field]: entry, seq: ++this._seq });
    return { ok: true, id: v.id, reason: null };
  }

  /**
   * Hook run before a verified entry is inserted (e.g. per-maker caps).
   * @protected
   * @param {Object} _entry verified body
   */
  _beforeInsert (_entry) {}

  /**
   * Apply a signed cancel from the entry's maker. A cancel for an entry not
   * held yet is remembered with its signer, so the entry cannot arrive later
   * from that maker; another key's cancel never blocks it.
   * @param {Object} body
   * @returns {{ ok: boolean, id: (string|null), reason: (string|null) }}
   */
  cancel (body) {
    const { codec, cancelType, idField } = this._spec;
    if (!body || body.type !== cancelType) return { ok: false, id: null, reason: `not a ${cancelType}` };
    const v = codec.verifyBody(body);
    if (!v.ok) return { ok: false, id: null, reason: v.reason };
    const entryId = v.body[idField];
    const makerPubkey = v.body.makerPubkey;
    const held = this._row(entryId);
    if (held && this._body(held).makerPubkey !== makerPubkey) return { ok: false, id: entryId, reason: 'cancel is not from the maker' };
    this._delete(entryId);
    this._rememberCancelled(entryId, makerPubkey, held ? this._body(held).expiresAt : null);
    return { ok: true, id: entryId, reason: null };
  }

  /** @private */
  _rememberCancelled (entryId, makerPubkey, expiresAt) {
    const key = cancelKey(entryId, makerPubkey);
    if (this._cancelled.has(key)) {
      if (expiresAt != null) this._confirmCancel(key, expiresAt);
      return;
    }
    if (expiresAt == null) {
      const pending = this._pendingCancels.get(makerPubkey);
      if (pending && pending.size >= this.settings.maxPendingCancelsPerMaker) {
        this._forgetCancel(pending.values().next().value);
      }
    }
    if (this._cancelled.size >= this.settings.maxCancelled) this._evictCancel();
    this._cancelled.set(key, expiresAt);
    if (!this._makerCancels.has(makerPubkey)) this._makerCancels.set(makerPubkey, new Set());
    this._makerCancels.get(makerPubkey).add(key);
    if (expiresAt == null) {
      if (!this._pendingCancels.has(makerPubkey)) this._pendingCancels.set(makerPubkey, new Set());
      this._pendingCancels.get(makerPubkey).add(key);
    }
  }

  /**
   * The cancelled entry is known now: keep the cancel until it expires.
   * @private
   */
  _confirmCancel (key, expiresAt) {
    this._cancelled.set(key, expiresAt);
    this._dropPending(key);
  }

  /** @private */
  _forgetCancel (key) {
    this._cancelled.delete(key);
    this._dropPending(key);
    const maker = makerOf(key);
    const keys = this._makerCancels.get(maker);
    if (keys && keys.delete(key) && !keys.size) this._makerCancels.delete(maker);
  }

  /** @private */
  _dropPending (key) {
    const maker = makerOf(key);
    const pending = this._pendingCancels.get(maker);
    if (pending && pending.delete(key) && !pending.size) this._pendingCancels.delete(maker);
  }

  /**
   * Make room for one cancel: drop cancels whose entry expired, else the
   * oldest cancel for an entry never held, else the oldest cancel of the
   * signer holding the most (the latest such signer on a tie). Anyone can
   * post and cancel their own entries, so evicting the oldest cancel would
   * let one key flush another maker's cancel and replay its entry; this way
   * a flood evicts the flooder's own cancels, and a Sybil flood needs one
   * key per remembered cancel.
   * @private
   */
  _evictCancel () {
    const now = this.now();
    for (const [key, expiresAt] of this._cancelled) {
      if (expiresAt != null && expiresAt <= now) this._forgetCancel(key);
    }
    if (this._cancelled.size < this.settings.maxCancelled) return;
    for (const [key, expiresAt] of this._cancelled) {
      if (expiresAt == null) return this._forgetCancel(key);
    }
    let victim = null;
    for (const keys of this._makerCancels.values()) {
      if (!victim || keys.size >= victim.size) victim = keys;
    }
    if (victim) return this._forgetCancel(victim.values().next().value);
    this._cancelled.delete(this._cancelled.keys().next().value);
  }

  /**
   * Drop expired entries.
   * @returns {number} entries removed
   */
  prune () {
    const now = this.now();
    const n = this._forget((row) => this._body(row).expiresAt <= now);
    if (n) this._afterPrune();
    return n;
  }

  /**
   * Hook run after {@link SignedBook#prune} removed entries.
   * @protected
   */
  _afterPrune () {}

  /**
   * Drop every entry from one maker (disconnect, fraud, failed settlement).
   * @param {string} makerPubkey
   * @returns {number} entries removed
   */
  forgetMaker (makerPubkey) {
    const key = String(makerPubkey || '').toLowerCase();
    const n = this._forget((row) => this._body(row).makerPubkey === key);
    this._afterForget(key);
    return n;
  }

  /**
   * Hook run after {@link SignedBook#forgetMaker}.
   * @protected
   * @param {string} _makerPubkey lowercased
   */
  _afterForget (_makerPubkey) {}

  /**
   * @param {string} id
   * @returns {Object|null} a copy of the entry body
   */
  get (id) {
    const row = this._row(String(id || ''));
    return row ? Object.assign({}, this._body(row)) : null;
  }

  /**
   * Unexpired rows matching `predicate`, in arrival order.
   * @protected
   * @param {Function} [predicate] `(entry, row) → boolean`
   * @returns {Object[]} rows `{ id, [field], seq }`
   */
  _liveRows (predicate) {
    const now = this.now();
    return this._list((row) => {
      const entry = this._body(row);
      return entry.expiresAt > now && (!predicate || predicate(entry, row));
    }).sort((a, b) => a.seq - b.seq);
  }
}

module.exports = SignedBook;
module.exports.SignedBook = SignedBook;
module.exports.codec = codec;
module.exports.signingString = signingString;
module.exports.bodyId = bodyId;
module.exports.randomNonce = randomNonce;
module.exports.cancelKey = cancelKey;
module.exports.MAX_CANCELLED = MAX_CANCELLED;
module.exports.MAX_PENDING_CANCELS_PER_MAKER = MAX_PENDING_CANCELS_PER_MAKER;
