'use strict';

/**
 * @fileoverview Buyer-side reassembly of indexed `P2P_FILE_SEND` blob frames
 * into a {@link Document}: purchase expectations, per-origin quotas, and
 * verify-before-pay for sealed per-blob frames.
 */

const crypto = require('crypto');
const { MAX_DOCUMENT_BLOBS } = require('../constants');
const Document = require('./document');

const INCOMPLETE_TRANSFER_TTL_MS = 10 * 60 * 1000;
// Default lifetime of a purchase expectation (refreshed by matching frames).
const EXPECTATION_TTL_MS = 60 * 60 * 1000;
// Max concurrent unsolicited incomplete transfers.
const MAX_PENDING_BLOB_TRANSFERS = 64;
// Max unsolicited incomplete transfers one origin may hold.
const MAX_PENDING_BLOB_TRANSFERS_PER_ORIGIN = 8;
// Byte budget across every incomplete transfer.
const MAX_PENDING_BLOB_BYTES = 256 * 1024 * 1024;

/**
 * @param {*} v
 * @returns {string|null}
 * @private
 */
function _hex64OrNull (v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(s) ? s : null;
}

/**
 * Pending-transfer map key: document id + Merkle root (`unindexed` when rootless).
 * @param {string} documentId
 * @param {string|null} merkleRootHex
 * @returns {string}
 * @private
 */
function transferKey (documentId, merkleRootHex) {
  return `${documentId}|${merkleRootHex || 'unindexed'}`;
}

/**
 * Buyer-side reassembly of indexed blob transfers.
 *
 * Two tables:
 * - **Expectations** (`expectTransfer`): what the buyer asked / paid for.
 *   Only the local caller writes them; unsolicited frames can never evict
 *   them. Each lives until `expiresAt` (caller-set, default an hour), is
 *   refreshed by matching frames
 *   ({@link DocumentBlobTransferBook#touch}), and ends with
 *   {@link DocumentBlobTransferBook#releaseTransfer} or completion.
 * - **Assembly rows** (`ingest`): bytes received so far. Rows backed by an
 *   expectation are *pinned*; others are unsolicited and bounded by
 *   `maxPending` rows overall, `maxPendingPerOrigin` rows and
 *   `maxPendingBytesPerOrigin` bytes per sending peer, idle `ttlMs`, and are
 *   evicted (oldest first) before any pinned row. A row whose `total`
 *   contradicts the expectation (planted before the purchase) is replaced.
 */
class DocumentBlobTransferBook {
  /**
   * @param {Object} [opts]
   * @param {number} [opts.ttlMs] drop unsolicited incomplete transfers idle this long
   * @param {number} [opts.expectationTtlMs] default expectation lifetime
   * @param {number} [opts.maxPending] max concurrent unsolicited incomplete transfers
   * @param {number} [opts.maxExpectations] max concurrent expectations (oldest released first; defaults to `maxPending`)
   * @param {number} [opts.maxPendingPerOrigin] max unsolicited rows one origin may hold
   * @param {number} [opts.maxPendingBytesPerOrigin] unsolicited byte quota per origin (default a quarter of `maxPendingBytes`)
   * @param {number} [opts.maxParts] max `blobTotal` for one transfer
   * @param {number} [opts.maxPendingBytes] byte budget across every incomplete transfer
   */
  constructor (opts = {}) {
    const positive = (v, fallback) => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? n : fallback;
    };
    // Assembly rows.
    /** @type {Map<string, object>} */
    this._pending = new Map();
    // Purchase expectations.
    /** @type {Map<string, object>} */
    this._expectations = new Map();
    // Unsolicited bytes per origin.
    /** @type {Map<string, number>} */
    this._originBytes = new Map();
    this._pendingBytes = 0;
    this.ttlMs = opts.ttlMs != null ? Number(opts.ttlMs) : INCOMPLETE_TRANSFER_TTL_MS;
    this.expectationTtlMs = positive(opts.expectationTtlMs, EXPECTATION_TTL_MS);
    this.maxPending = positive(opts.maxPending, MAX_PENDING_BLOB_TRANSFERS);
    this.maxExpectations = positive(opts.maxExpectations, this.maxPending);
    this.maxPendingPerOrigin = positive(opts.maxPendingPerOrigin, MAX_PENDING_BLOB_TRANSFERS_PER_ORIGIN);
    this.maxParts = positive(opts.maxParts, MAX_DOCUMENT_BLOBS);
    this.maxPendingBytes = positive(opts.maxPendingBytes, MAX_PENDING_BLOB_BYTES);
    this.maxPendingBytesPerOrigin = positive(opts.maxPendingBytesPerOrigin, Math.floor(this.maxPendingBytes / 4));
  }

  /**
   * @param {object} obj P2P_FILE_SEND JSON object
   * @returns {{ ok: boolean, error: (string|undefined), unindexed: (boolean|undefined), documentId: (string|undefined), bytes: (Buffer|undefined), blobIndex: (number|undefined), blobTotal: (number|undefined), blobHashHex: (string|undefined), merkleRootHex: (string|undefined), contentSha256: (string|undefined) }}
   */
  static parseFrame (obj) {
    if (!obj || typeof obj !== 'object') return { ok: false, error: 'missing object' };
    const documentId = String(obj.name || obj.documentId || '').trim();
    if (!documentId) return { ok: false, error: 'missing document id' };
    const bodyB64 = obj.body != null ? String(obj.body) : '';
    let bytes;
    try {
      bytes = Buffer.from(bodyB64, 'base64');
    } catch (_) {
      return { ok: false, error: 'invalid base64 body' };
    }

    const hasIndex = obj.blobIndex != null || obj.blobHashHex != null || obj.merkleRootHex != null;
    if (!hasIndex) {
      return {
        ok: true,
        unindexed: true,
        documentId,
        bytes,
        blobIndex: 0,
        blobTotal: 1,
        blobHashHex: crypto.createHash('sha256').update(bytes).digest('hex'),
        merkleRootHex: null,
        contentSha256: crypto.createHash('sha256').update(bytes).digest('hex')
      };
    }

    const blobIndex = Math.round(Number(obj.blobIndex));
    const blobTotal = Math.round(Number(obj.blobTotal != null ? obj.blobTotal : 1));
    const blobHashHex = String(obj.blobHashHex || '').trim().toLowerCase();
    const merkleRootHex = obj.merkleRootHex != null
      ? String(obj.merkleRootHex).trim().toLowerCase()
      : null;
    if (!Number.isFinite(blobIndex) || blobIndex < 0) {
      return { ok: false, error: 'invalid blobIndex' };
    }
    if (!Number.isFinite(blobTotal) || blobTotal < 1) {
      return { ok: false, error: 'invalid blobTotal' };
    }
    if (!/^[0-9a-f]{64}$/.test(blobHashHex)) {
      return { ok: false, error: 'invalid blobHashHex' };
    }
    if (!Document.verifyBlob(bytes, blobHashHex)) {
      return { ok: false, error: 'blob hash mismatch' };
    }
    return {
      ok: true,
      unindexed: false,
      documentId,
      bytes,
      blobIndex,
      blobTotal,
      blobHashHex,
      merkleRootHex,
      contentSha256: obj.contentSha256 != null
        ? String(obj.contentSha256).trim().toLowerCase()
        : null,
      paymentHashHex: _hex64OrNull(obj.paymentHashHex),
      // Only per-blob leaves commit their IV; a whole-document sale's IV is not in the tree.
      leafIv: obj.perBlob === true && obj.iv != null && obj.iv !== '' ? String(obj.iv) : null,
      chunkBytes: obj.chunkBytes != null ? Number(obj.chunkBytes) : null
    };
  }

  /**
   * Verify-before-pay: check one free sealed per-blob `P2P_FILE_SEND` body
   * (ciphertext of blob `i`) against the document root **before** funding the
   * HTLC for `K_i`. The ciphertext must hash to its `blobHashHex` and the leaf
   * `(blobHash, paymentHash, iv)` must open to the root with the frame's
   * inclusion proof (or `expected.proof`). Pins from verified offer leaves
   * ({@link Document.verifyOfferLeaves}) are enforced when given.
   * @param {Object} obj raw `P2P_FILE_SEND` body (`sealed`, `perBlob`)
   * @param {Object} expected
   * @param {string} expected.merkleRootHex
   * @param {number} expected.blobTotal
   * @param {number} [expected.blobIndex]
   * @param {string} [expected.blobHashHex]
   * @param {string} [expected.paymentHashHex]
   * @param {string} [expected.iv]
   * @param {string[]} [expected.proof]
   * @returns {{ ok: boolean, error: (string|undefined), blobIndex: (number|undefined), blobHashHex: (string|undefined), paymentHashHex: (string|null|undefined), iv: (string|null|undefined), bytes: (Buffer|undefined) }}
   */
  static verifySealedFrame (obj, expected = {}) {
    const frame = DocumentBlobTransferBook.parseFrame(obj);
    if (!frame.ok) return { ok: false, error: frame.error };
    if (frame.unindexed) return { ok: false, error: 'not an indexed blob frame' };
    const root = _hex64OrNull(expected.merkleRootHex);
    if (!root) return { ok: false, error: 'expected merkleRootHex required' };
    if (frame.merkleRootHex !== root) return { ok: false, error: 'merkleRootHex mismatch', blobIndex: frame.blobIndex };
    const total = Math.round(Number(expected.blobTotal));
    if (frame.blobTotal !== total) return { ok: false, error: 'blobTotal mismatch', blobIndex: frame.blobIndex };
    if (expected.blobIndex != null && frame.blobIndex !== Number(expected.blobIndex)) {
      return { ok: false, error: 'blobIndex mismatch', blobIndex: frame.blobIndex };
    }
    const paymentHashHex = _hex64OrNull(obj.paymentHashHex);
    const iv = obj.iv != null && obj.iv !== '' ? String(obj.iv) : null;
    const wantBlob = _hex64OrNull(expected.blobHashHex);
    if (wantBlob && wantBlob !== frame.blobHashHex) return { ok: false, error: 'blob hash is not the advertised leaf', blobIndex: frame.blobIndex };
    const wantPay = _hex64OrNull(expected.paymentHashHex);
    if (wantPay && wantPay !== paymentHashHex) return { ok: false, error: 'payment hash is not the advertised leaf', blobIndex: frame.blobIndex };
    if (expected.iv != null && expected.iv !== '' && !Document.sameIv(expected.iv, iv)) {
      return { ok: false, error: 'iv is not the advertised leaf', blobIndex: frame.blobIndex };
    }
    const out = { ok: true, blobIndex: frame.blobIndex, blobHashHex: frame.blobHashHex, paymentHashHex, iv, bytes: frame.bytes };
    const proof = Array.isArray(obj.proof) ? obj.proof : expected.proof;
    if (!Array.isArray(proof)) return { ok: false, error: 'missing inclusion proof', blobIndex: frame.blobIndex };
    if (!Document.verifyInclusion({ merkleRootHex: root, blobTotal: total, blobIndex: frame.blobIndex, blobHashHex: frame.blobHashHex, paymentHashHex, iv: frame.leafIv, proof })) {
      return { ok: false, error: 'inclusion proof does not open to merkleRootHex', blobIndex: frame.blobIndex };
    }
    return out;
  }

  /**
   * @param {object} row
   * @param {number} delta
   * @private
   */
  _countOriginBytes (row, delta) {
    if (row.pinned || !row.origin) return;
    const next = (this._originBytes.get(row.origin) || 0) + delta;
    if (next > 0) this._originBytes.set(row.origin, next);
    else this._originBytes.delete(row.origin);
  }

  /**
   * Remove an assembly row and release its bytes from the budgets.
   * @param {string} key
   * @private
   */
  _drop (key) {
    const row = this._pending.get(key);
    if (!row) return;
    this._pendingBytes -= row.bytes || 0;
    this._countOriginBytes(row, -(row.bytes || 0));
    this._pending.delete(key);
  }

  /**
   * Mark a row as backed by an expectation (moves its bytes out of the
   * unsolicited per-origin quota).
   * @param {object} row
   * @private
   */
  _pin (row) {
    if (row.pinned) return;
    this._countOriginBytes(row, -(row.bytes || 0));
    row.pinned = true;
  }

  /**
   * Pre-register expected leaves (from inventory DocumentBlobIndex).
   * @param {object} opts
   * @param {string[]} [opts.blobHashHexes] expected blob hash per blob index; empty or null
   * entries leave that index unchecked here (the sealed per-blob path refuses them once any
   * index is pinned: that blob was not bought)
   * @param {string[]} [opts.paymentHashHexes] expected sealed payment hash (SHA256(K_i)) per blob index
   * @param {string[]} [opts.ivs] advertised AES-GCM IV (base64) per blob index
   * @param {string[]} [opts.origins] peer the index was bought from (its frame may displace
   * another origin's alternate when the IV is not advertised)
   * @param {boolean} [opts.merge] add these pins to an existing expectation for the same
   * document and root (same `total`) instead of replacing it, so buying blob j keeps blob i pinned
   * @param {number} [opts.expiresAt] epoch ms the expectation lapses (session lifetime)
   * @param {number} [opts.ttlMs] lifetime from now (and refresh step) when `expiresAt` is not given
   * @returns {Object|null} the expectation row
   */
  expectTransfer (opts = {}) {
    this._purgeExpired();
    const documentId = String(opts.documentId || '').trim();
    if (!documentId) return null;
    const merkleRootHex = opts.merkleRootHex
      ? String(opts.merkleRootHex).toLowerCase()
      : null;
    const total = Math.round(Number(opts.total || opts.blobTotal || 0));
    if (total > this.maxParts) return null;
    if (Array.isArray(opts.blobHashHexes) && opts.blobHashHexes.length > this.maxParts) return null;
    for (const list of [opts.paymentHashHexes, opts.ivs, opts.origins]) {
      if (Array.isArray(list) && list.length > this.maxParts) return null;
    }
    const pins = (list, lower = true) => (Array.isArray(list)
      ? Array.from(list, (h) => (h ? (lower ? String(h).toLowerCase() : String(h)) : null))
      : null);
    const expectedHashes = pins(opts.blobHashHexes);
    const expectedPaymentHashes = pins(opts.paymentHashHexes);
    // IVs are base64 and origins are peer names: case matters.
    const expectedIvs = pins(opts.ivs, false);
    const expectedOrigins = pins(opts.origins, false);
    const key = transferKey(documentId, merkleRootHex);
    const now = Date.now();
    const ttlMs = Number(opts.ttlMs) > 0 ? Number(opts.ttlMs) : this.expectationTtlMs;
    const expiresAt = Number(opts.expiresAt) > 0 ? Number(opts.expiresAt) : now + ttlMs;
    const prior = opts.merge ? this._expectations.get(key) : null;
    if (prior && (!prior.total || !(total > 0) || prior.total === total)) {
      const merge = (a, b) => {
        if (!a || !b) return a || b;
        return Array.from({ length: Math.max(a.length, b.length) }, (_, i) => b[i] || a[i] || null);
      };
      prior.expectedHashes = merge(prior.expectedHashes, expectedHashes);
      prior.expectedPaymentHashes = merge(prior.expectedPaymentHashes, expectedPaymentHashes);
      prior.expectedIvs = merge(prior.expectedIvs, expectedIvs);
      prior.expectedOrigins = merge(prior.expectedOrigins, expectedOrigins);
      if (!prior.total && total > 0) prior.total = total;
      prior.ttlMs = Math.max(prior.ttlMs || 0, ttlMs);
      prior.expiresAt = Math.max(prior.expiresAt || 0, expiresAt);
      prior.updated = now;
      this._reconcileRow(prior, true);
      return prior;
    }
    this._expectations.delete(key);
    const row = {
      key,
      documentId,
      merkleRootHex,
      total: Number.isFinite(total) && total > 0 ? total : null,
      expectedHashes,
      expectedPaymentHashes,
      expectedIvs,
      expectedOrigins,
      contentSha256: opts.contentSha256
        ? String(opts.contentSha256).toLowerCase()
        : null,
      ttlMs,
      expiresAt,
      created: now,
      updated: now
    };
    this._expectations.set(key, row);
    while (this._expectations.size > this.maxExpectations) {
      this.releaseTransfer(this._expectations.keys().next().value);
    }
    this._reconcileRow(row);
    return row;
  }

  /**
   * Line the assembly row up with its expectation. A row built before the
   * purchase is unsolicited (possibly planted), and a part it holds would
   * shadow the seller's frame for that index, so it is dropped; a pinned row
   * loses only parts that contradict newly merged pins, or all of them when
   * the total disagrees.
   * @param {object} exp
   * @param {boolean} [checkParts] re-hash held parts against the pins (after a merge)
   * @private
   */
  _reconcileRow (exp, checkParts = false) {
    const row = this._pending.get(exp.key);
    if (!row) return;
    if (!row.pinned || (exp.total && row.total !== exp.total)) {
      this._drop(exp.key);
      return;
    }
    if (!checkParts || !exp.expectedHashes) return;
    for (const [index, bytes] of row.parts) {
      const pin = exp.expectedHashes[index];
      if (pin && !Document.verifyBlob(bytes, pin)) {
        row.parts.delete(index);
        row.leaves.delete(index);
        row.bytes -= bytes.length;
        this._pendingBytes -= bytes.length;
      }
    }
  }

  /**
   * Expectations registered for a document (any root). Lets the per-blob
   * sealed path refuse frames whose root / total disagree with what the buyer
   * actually asked for.
   * @param {string} documentId
   * @returns {Object[]} rows from {@link DocumentBlobTransferBook#expectTransfer}
   */
  expectedFor (documentId) {
    this._purgeExpired();
    const id = String(documentId || '').trim();
    const out = [];
    for (const row of this._expectations.values()) if (row.documentId === id) out.push(row);
    return out;
  }

  /**
   * Extend an expectation by its refresh step (a matching frame arrived).
   * @param {string} documentId
   * @param {string|null} [merkleRootHex]
   * @returns {boolean} true when an expectation was refreshed
   */
  touch (documentId, merkleRootHex = null) {
    const exp = this._expectations.get(transferKey(String(documentId || '').trim(), merkleRootHex ? String(merkleRootHex).toLowerCase() : null));
    if (!exp) return false;
    const now = Date.now();
    exp.updated = now;
    exp.expiresAt = Math.max(exp.expiresAt || 0, now + (exp.ttlMs || this.expectationTtlMs));
    return true;
  }

  /**
   * End a purchase session: drop its expectation and any partial bytes.
   * @param {Object|string} opts `{ documentId, merkleRootHex }` or a transfer key
   * @returns {boolean}
   */
  releaseTransfer (opts = {}) {
    const key = typeof opts === 'string'
      ? opts
      : transferKey(String(opts.documentId || '').trim(), opts.merkleRootHex ? String(opts.merkleRootHex).toLowerCase() : null);
    const had = this._expectations.delete(key);
    if (this._pending.has(key)) {
      this._drop(key);
      return true;
    }
    return had;
  }

  /**
   * Drop expectations past `expiresAt` and unsolicited rows idle longer than
   * `ttlMs`; a pinned row outlives the idle limit while its expectation does.
   * @private
   */
  _purgeExpired () {
    const now = Date.now();
    for (const [k, exp] of this._expectations.entries()) {
      if (now > exp.expiresAt) this._expectations.delete(k);
    }
    for (const [k, row] of this._pending.entries()) {
      if (row.pinned && this._expectations.has(k)) continue;
      if (now - (row.updated || row.created) > this.ttlMs) this._drop(k);
    }
  }

  /**
   * Evict oldest unsolicited rows until under `maxPending` (never a pinned row).
   * @param {string} [keep] key that must not be evicted to make room
   * @private
   */
  _evictOldestIfOverCap (keep = null) {
    let unsolicited = 0;
    for (const row of this._pending.values()) if (!row.pinned) unsolicited++;
    for (const [k, row] of this._pending.entries()) {
      if (unsolicited <= this.maxPending) break;
      if (row.pinned || k === keep) continue;
      this._drop(k);
      unsolicited--;
    }
  }

  /**
   * Evict oldest unsolicited rows until `need` more bytes fit the global budget.
   * @param {number} need
   * @param {string} keep
   * @returns {boolean} whether the bytes now fit
   * @private
   */
  _makeRoom (need, keep) {
    for (const [k, row] of this._pending.entries()) {
      if (this._pendingBytes + need <= this.maxPendingBytes) break;
      if (row.pinned || k === keep) continue;
      this._drop(k);
    }
    return this._pendingBytes + need <= this.maxPendingBytes;
  }

  /**
   * @param {object} frame from {@link DocumentBlobTransferBook.parseFrame}
   * @param {Object} [opts]
   * @param {string} [opts.origin] sending peer (per-origin quotas for unsolicited rows)
   * @returns {{ status: string, error: (string|undefined), documentId: (string|undefined), buffer: (Buffer|undefined), merkleRootHex: (string|undefined), verified: (boolean|undefined), unindexed: (boolean|undefined), blobIndex: (number|undefined), received: (number|undefined), total: (number|undefined) }}
   */
  ingest (frame, opts = {}) {
    this._purgeExpired();
    const origin = opts && opts.origin != null && opts.origin !== '' ? String(opts.origin) : null;
    if (!frame || !frame.ok) {
      return { status: 'reject', error: (frame && frame.error) || 'bad frame' };
    }

    // Unindexed whole-body frame: accept as a single verified document.
    if (frame.unindexed) {
      return {
        status: 'complete',
        documentId: frame.documentId,
        buffer: frame.bytes,
        merkleRootHex: Document.rootHexFromBlobHashes([frame.blobHashHex]),
        verified: true,
        unindexed: true,
        blobIndex: 0,
        received: 1,
        total: 1
      };
    }

    if (!Document.verifyBlob(frame.bytes, frame.blobHashHex)) {
      return {
        status: 'reject',
        error: 'blob hash mismatch',
        documentId: frame.documentId,
        blobIndex: frame.blobIndex
      };
    }
    if (frame.blobTotal > this.maxParts) {
      return {
        status: 'reject',
        error: `blobTotal exceeds ${this.maxParts}`,
        documentId: frame.documentId
      };
    }
    if (frame.blobIndex >= frame.blobTotal) {
      return {
        status: 'reject',
        error: 'blobIndex out of range',
        documentId: frame.documentId,
        blobIndex: frame.blobIndex
      };
    }

    const key = transferKey(frame.documentId, frame.merkleRootHex);
    const reject = (error) => ({ status: 'reject', error, documentId: frame.documentId, blobIndex: frame.blobIndex });
    const exp = this._expectations.get(key) || null;
    if (exp) {
      if (exp.total != null && exp.total !== frame.blobTotal) return reject('blobTotal mismatch');
      if (exp.expectedHashes && exp.expectedHashes[frame.blobIndex] &&
          exp.expectedHashes[frame.blobIndex] !== frame.blobHashHex) {
        return reject('blob hash not in advertised index');
      }
      const wantPay = exp.expectedPaymentHashes && exp.expectedPaymentHashes[frame.blobIndex];
      if (wantPay && frame.paymentHashHex !== wantPay) return reject('payment hash not in advertised index');
    }
    let row = this._pending.get(key);
    if (row && exp) this._reconcileRow(exp);
    row = this._pending.get(key);
    if (!row) {
      if (!exp && origin) {
        let held = 0;
        for (const r of this._pending.values()) if (!r.pinned && r.origin === origin) held++;
        if (held >= this.maxPendingPerOrigin) return reject('too many pending blob transfers from this peer');
      }
      row = {
        key,
        documentId: frame.documentId,
        merkleRootHex: frame.merkleRootHex,
        total: exp && exp.total != null ? exp.total : frame.blobTotal,
        contentSha256: frame.contentSha256,
        origin,
        pinned: !!exp,
        parts: new Map(),
        leaves: new Map(),
        bytes: 0,
        created: Date.now(),
        updated: Date.now()
      };
      this._pending.set(key, row);
      this._evictOldestIfOverCap(row.pinned ? null : key);
      // Cap eviction may have dropped this brand-new row under pressure.
      if (!this._pending.has(key)) return reject('too many pending blob transfers');
    }
    row.updated = Date.now();
    if (exp) this.touch(frame.documentId, frame.merkleRootHex);
    if (row.total == null) row.total = frame.blobTotal;
    if (row.total !== frame.blobTotal) return reject('blobTotal mismatch');
    if (row.merkleRootHex && frame.merkleRootHex && row.merkleRootHex !== frame.merkleRootHex) {
      return reject('merkleRootHex mismatch');
    }
    if (!row.merkleRootHex && frame.merkleRootHex) {
      row.merkleRootHex = frame.merkleRootHex;
    }

    if (!row.parts.has(frame.blobIndex)) {
      const need = frame.bytes.length;
      if (!row.pinned && row.origin && (this._originBytes.get(row.origin) || 0) + need > this.maxPendingBytesPerOrigin) {
        return reject('pending blob bytes exceeded for this peer');
      }
      if (!(row.pinned ? this._makeRoom(need, key) : this._pendingBytes + need <= this.maxPendingBytes)) {
        return reject('pending blob bytes exceeded');
      }
      row.parts.set(frame.blobIndex, frame.bytes);
      row.leaves.set(frame.blobIndex, { paymentHashHex: frame.paymentHashHex || null, iv: frame.leafIv || null });
      row.bytes += need;
      this._pendingBytes += need;
      this._countOriginBytes(row, need);
    }

    if (row.parts.size < row.total) {
      return {
        status: 'need_more',
        documentId: frame.documentId,
        blobIndex: frame.blobIndex,
        received: row.parts.size,
        total: row.total,
        merkleRootHex: row.merkleRootHex
      };
    }

    const assembled = Document.reassemble(row.parts, row.total, row.merkleRootHex, { leaves: row.leaves });
    this._drop(key);
    if (!assembled.ok) {
      return {
        status: 'reject',
        error: assembled.error || 'reassemble failed',
        documentId: frame.documentId
      };
    }
    if (exp) this._expectations.delete(key);
    const contentSha256 = (exp && exp.contentSha256) || row.contentSha256;
    if (contentSha256) {
      const full = crypto.createHash('sha256').update(assembled.buffer).digest('hex');
      if (full !== contentSha256) {
        return {
          status: 'reject',
          error: 'contentSha256 mismatch',
          documentId: frame.documentId
        };
      }
    }
    return {
      status: 'complete',
      documentId: frame.documentId,
      buffer: assembled.buffer,
      merkleRootHex: assembled.merkleRootHex || row.merkleRootHex,
      verified: true,
      unindexed: false,
      received: row.total,
      total: row.total
    };
  }

  /**
   * Number of in-flight transfers (expected or with bytes held).
   * @type {number}
   */
  get pendingCount () {
    let count = this._expectations.size;
    for (const k of this._pending.keys()) if (!this._expectations.has(k)) count++;
    return count;
  }

  /**
   * Bytes held across every in-flight transfer.
   * @type {number}
   */
  get pendingBytes () {
    return this._pendingBytes;
  }
}

DocumentBlobTransferBook.MAX_PENDING_PER_ORIGIN = MAX_PENDING_BLOB_TRANSFERS_PER_ORIGIN;

module.exports = DocumentBlobTransferBook;
