'use strict';

/**
 * @fileoverview Sealed blob-tree document.
 *
 * A Fabric {@link Document} is a Merkle tree over wire-sized blobs
 * (`functions/documentBlobManifest.js`). When sealed, **every blob has its own
 * key** `K_i`; the per-blob payment hash is `SHA256(K_i)` and the blob hash is
 * `SHA256(ciphertext_i)`. Chunk-level sealing is therefore the only sealing: a
 * one-blob document is indistinguishable from any other blob on the wire.
 *
 * The record a Document exposes to the network (`record()`, `inventoryItem()`)
 * carries **only hashes** — blob hashes, payment hashes, the Tree root, the
 * publisher key when known. Human-readable metadata (title, URL, MIME) belongs
 * in a separately sealed **manifest blob** (`Document.encodeManifest`) bought
 * like any other chunk. See `docs/L1_DOCUMENT_EXCHANGE.md`.
 *
 * Per-blob key reveal reuses the existing `DocumentContentKeyReveal` body
 * (`functions/documentSealedExchange.js` `buildKeyRevealMessage`) once per blob
 * — the same message, more of them. No new opcodes.
 */

const crypto = require('crypto');

const State = require('./state');
const {
  DEFAULT_BLOB_CHUNK_BYTES,
  merkleRootHexFromBlobHashes,
  normalizeChunkBytes,
  splitBlobs
} = require('../functions/documentBlobManifest');
const {
  SCHEME,
  sealPlaintext,
  openCiphertext,
  paymentHashHexFromKey,
  buildKeyRevealMessage
} = require('../functions/documentSealedExchange');

/** AES-GCM tag appended to each sealed blob. */
const GCM_TAG_BYTES = 16;
const HEX64 = /^[0-9a-f]{64}$/;
const MANIFEST_TYPE = 'DocumentManifest';
const MANIFEST_VERSION = 1;

/**
 * @param {*} v
 * @returns {string|null}
 * @private
 */
function hex64 (v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  return HEX64.test(s) ? s : null;
}

/**
 * @param {Buffer} buf
 * @returns {string}
 * @private
 */
function sha256Hex (buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * @param {*} input
 * @returns {boolean}
 * @private
 */
function looksLikeRecord (input) {
  return !!(input && typeof input === 'object' && !Buffer.isBuffer(input) && Array.isArray(input.blobs));
}

class Document extends State {
  /**
   * Create a Document from a hash-only record (as received from the network)
   * or from arbitrary State input (legacy behaviour). Use {@link Document.seal}
   * or {@link Document.fromPlain} to build one from content.
   * @param {Object} [doc] Record `{ blobs, merkleRootHex, blobTotal, chunkBytes, sealed, documentId, publisher }`.
   */
  constructor (doc = {}) {
    super(doc);

    /** @private */
    this._blobs = [];
    /** @private */
    this._keys = new Map();
    /** @private */
    this._ciphertexts = new Map();
    /** @private */
    this._plaintexts = new Map();
    /** @private */
    this._meta = {
      merkleRootHex: null,
      blobTotal: 0,
      chunkBytes: DEFAULT_BLOB_CHUNK_BYTES,
      sealed: false,
      size: null,
      documentId: null,
      publisher: null,
      signature: null
    };

    if (looksLikeRecord(doc)) this._loadRecord(doc);

    // only valid if this matches
    this.contract = {
      integrity: `sha256-${this.hash}`
    };

    return this;
  }

  // ---------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------

  /**
   * Seal plaintext as a blob tree with one key per blob.
   * @param {Buffer|string} plaintext
   * @param {Object} [opts]
   * @param {number} [opts.chunkBytes] Ciphertext blob size (default AMP-sized); plaintext chunks are 16 bytes smaller.
   * @param {string} [opts.documentId] Catalog id (defaults to the Tree root).
   * @param {string} [opts.publisher] Publisher public key (hex).
   * @returns {Document}
   */
  static seal (plaintext, opts = {}) {
    const plain = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(plaintext == null ? '' : plaintext);
    const chunkBytes = normalizeChunkBytes(opts.chunkBytes);
    const plainChunk = Math.max(1, chunkBytes - GCM_TAG_BYTES);
    const total = Math.max(1, Math.ceil(plain.length / plainChunk));
    const doc = new Document({ blobs: [] });
    const blobs = [];
    for (let i = 0; i < total; i++) {
      const slice = plain.subarray(i * plainChunk, Math.min(plain.length, (i + 1) * plainChunk));
      const sealed = sealPlaintext(slice);
      const blobHashHex = sha256Hex(sealed.ciphertext);
      blobs.push({
        index: i,
        total,
        blobHashHex,
        paymentHashHex: paymentHashHexFromKey(sealed.key),
        size: sealed.ciphertext.length,
        plaintextSize: slice.length,
        plaintextSha256: sha256Hex(slice),
        iv: sealed.encryption.iv,
        scheme: SCHEME
      });
      doc._keys.set(i, sealed.key.toString('hex'));
      doc._ciphertexts.set(i, sealed.ciphertext);
      doc._plaintexts.set(i, Buffer.from(slice));
    }
    doc._setBlobs(blobs, {
      sealed: true,
      chunkBytes,
      size: plain.length,
      documentId: opts.documentId || null,
      publisher: opts.publisher || null
    });
    return doc;
  }

  /**
   * Unsealed blob tree over raw content (same leaves as `splitBlobs`).
   * @param {Buffer|string} content
   * @param {Object} [opts]
   * @param {number} [opts.chunkBytes]
   * @param {string} [opts.documentId]
   * @param {string} [opts.publisher]
   * @returns {Document}
   */
  static fromPlain (content, opts = {}) {
    const buf = Buffer.isBuffer(content) ? content : Buffer.from(content == null ? '' : content);
    const split = splitBlobs(buf, opts.chunkBytes, opts.documentId);
    const doc = new Document({ blobs: [] });
    const blobs = split.blobs.map((b) => {
      doc._plaintexts.set(b.index, Buffer.from(b.bytes));
      return {
        index: b.index,
        total: b.total,
        blobHashHex: b.blobHashHex,
        paymentHashHex: null,
        size: b.bytes.length,
        plaintextSize: b.bytes.length,
        plaintextSha256: b.blobHashHex,
        iv: null,
        scheme: null
      };
    });
    doc._setBlobs(blobs, {
      sealed: false,
      chunkBytes: split.chunkBytes,
      size: buf.length,
      documentId: opts.documentId || null,
      publisher: opts.publisher || null
    });
    return doc;
  }

  /**
   * Rehydrate from a record previously produced by {@link Document#record}.
   * @param {Object} record
   * @returns {Document}
   */
  static fromRecord (record) {
    return new Document(record);
  }

  /**
   * Canonical bytes for a manifest blob — the one place human-readable
   * metadata lives. Seal it as its own one-blob Document.
   * @param {Object} meta `{ title, url, mime, size, merkleRootHex, ... }`
   * @returns {Buffer}
   */
  static encodeManifest (meta = {}) {
    const body = Object.assign({}, meta, { type: MANIFEST_TYPE, version: MANIFEST_VERSION });
    const keys = Object.keys(body).sort();
    const ordered = {};
    for (const k of keys) ordered[k] = body[k];
    return Buffer.from(JSON.stringify(ordered), 'utf8');
  }

  /**
   * @param {Buffer|string} bytes
   * @returns {Object|null} manifest, or null when not a `DocumentManifest`
   */
  static decodeManifest (bytes) {
    try {
      const obj = JSON.parse(Buffer.isBuffer(bytes) ? bytes.toString('utf8') : String(bytes));
      if (!obj || obj.type !== MANIFEST_TYPE) return null;
      return obj;
    } catch (_) {
      return null;
    }
  }

  // ---------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------

  /**
   * @param {Object} record
   * @private
   */
  _loadRecord (record) {
    const blobs = record.blobs.map((b, i) => ({
      index: b.index != null ? Number(b.index) : i,
      total: b.total != null ? Number(b.total) : record.blobs.length,
      blobHashHex: hex64(b.blobHashHex),
      paymentHashHex: hex64(b.paymentHashHex || b.contentHashHex),
      size: b.size != null ? Number(b.size) : null,
      plaintextSize: b.plaintextSize != null ? Number(b.plaintextSize) : null,
      plaintextSha256: hex64(b.plaintextSha256),
      iv: b.iv != null ? String(b.iv) : null,
      scheme: b.scheme != null ? String(b.scheme) : null
    }));
    this._setBlobs(blobs, {
      sealed: record.sealed === true || blobs.some((b) => !!b.paymentHashHex && !!b.iv),
      chunkBytes: record.chunkBytes != null ? Number(record.chunkBytes) : DEFAULT_BLOB_CHUNK_BYTES,
      size: record.size != null ? Number(record.size) : null,
      documentId: record.documentId || null,
      publisher: record.publisher || null,
      signature: record.signature || null,
      merkleRootHex: hex64(record.merkleRootHex)
    });
  }

  /**
   * @param {Object[]} blobs
   * @param {Object} meta
   * @private
   */
  _setBlobs (blobs, meta = {}) {
    this._blobs = blobs.slice().sort((a, b) => a.index - b.index);
    const computed = merkleRootHexFromBlobHashes(this._blobs.map((b) => b.blobHashHex).filter(Boolean));
    this._meta.merkleRootHex = meta.merkleRootHex || computed;
    this._meta.blobTotal = this._blobs.length;
    this._meta.chunkBytes = meta.chunkBytes || this._meta.chunkBytes;
    this._meta.sealed = !!meta.sealed;
    this._meta.size = meta.size != null ? meta.size : null;
    this._meta.documentId = meta.documentId || this._meta.merkleRootHex;
    this._meta.publisher = meta.publisher || null;
    this._meta.signature = meta.signature || null;
    this.contract = { integrity: `sha256-${this.hash}` };
  }

  /** Tree root over blob hashes (hex) — the document's identity. */
  get hash () {
    return this._meta.merkleRootHex || undefined;
  }

  get merkleRootHex () { return this._meta.merkleRootHex; }
  get blobTotal () { return this._meta.blobTotal; }
  get chunkBytes () { return this._meta.chunkBytes; }
  get sealed () { return this._meta.sealed; }
  /**
   * Plaintext byte length of the whole document. Named `contentSize` (not
   * `size`) because `State` already defines an own `size` property.
   * @type {number|null}
   */
  get contentSize () { return this._meta.size; }
  get documentId () { return this._meta.documentId; }
  get publisher () { return this._meta.publisher; }

  /** Hash-only blob leaves (copies). */
  get blobs () {
    return this._blobs.map((b) => Object.assign({}, b));
  }

  /** True when this instance holds every blob key (publisher / full buyer). */
  get complete () {
    return this._blobs.length > 0 && this._blobs.every((b) => this._plaintexts.has(b.index));
  }

  /**
   * Hash-only record: safe to publish, index, and sign. No names, no bytes.
   * @returns {Object}
   */
  record () {
    return {
      type: 'Document',
      documentId: this._meta.documentId,
      merkleRootHex: this._meta.merkleRootHex,
      blobTotal: this._meta.blobTotal,
      chunkBytes: this._meta.chunkBytes,
      sealed: this._meta.sealed,
      size: this._meta.size,
      publisher: this._meta.publisher,
      signature: this._meta.signature,
      blobs: this._blobs.map((b) => ({
        index: b.index,
        total: b.total,
        blobHashHex: b.blobHashHex,
        paymentHashHex: b.paymentHashHex,
        size: b.size,
        plaintextSize: b.plaintextSize,
        plaintextSha256: b.plaintextSha256,
        iv: b.iv,
        scheme: b.scheme
      }))
    };
  }

  // ---------------------------------------------------------------------
  // Per-blob accessors
  // ---------------------------------------------------------------------

  /**
   * @param {number} index
   * @returns {Object|null}
   */
  blob (index) {
    const b = this._blobs.find((x) => x.index === Number(index));
    return b ? Object.assign({}, b) : null;
  }

  /**
   * Payment hash for one blob: `SHA256(K_i)` when sealed, the blob hash when not.
   * @param {number} index
   * @returns {string|null}
   */
  paymentHashFor (index) {
    const b = this.blob(index);
    if (!b) return null;
    return this._meta.sealed ? b.paymentHashHex : b.blobHashHex;
  }

  /**
   * @param {number} index
   * @returns {string|null} `K_i` hex when held
   */
  keyFor (index) {
    return this._keys.get(Number(index)) || null;
  }

  /**
   * @param {number} index
   * @returns {Buffer|null} wire bytes (ciphertext when sealed, plaintext otherwise)
   */
  bytesFor (index) {
    const i = Number(index);
    if (this._meta.sealed) return this._ciphertexts.get(i) || null;
    return this._plaintexts.get(i) || null;
  }

  /**
   * Blob-hash and root check for received wire bytes.
   * @param {Object} blob `{ index, bytes }`
   * @returns {boolean}
   */
  verify (blob) {
    if (!blob || !Buffer.isBuffer(blob.bytes)) return false;
    const leaf = this.blob(blob.index);
    if (!leaf || !leaf.blobHashHex) return false;
    if (sha256Hex(blob.bytes) !== leaf.blobHashHex) return false;
    const root = merkleRootHexFromBlobHashes(this._blobs.map((b) => b.blobHashHex));
    return root === this._meta.merkleRootHex;
  }

  /**
   * Accept verified wire bytes for one blob (ciphertext when sealed).
   * @param {number} index
   * @param {Buffer} bytes
   * @returns {boolean}
   */
  acceptBytes (index, bytes) {
    const i = Number(index);
    if (!this.verify({ index: i, bytes })) return false;
    if (this._meta.sealed) this._ciphertexts.set(i, Buffer.from(bytes));
    else this._plaintexts.set(i, Buffer.from(bytes));
    return true;
  }

  /**
   * Open one sealed blob with its key (checks `SHA256(K_i)` and the plaintext hash).
   * @param {number} index
   * @param {string|Buffer} keyHex
   * @param {Buffer} [ciphertext] Defaults to bytes accepted earlier.
   * @returns {{ ok: boolean, plaintext: (Buffer|undefined), error: (string|undefined) }}
   */
  openBlob (index, keyHex, ciphertext) {
    const i = Number(index);
    const leaf = this.blob(i);
    if (!leaf) return { ok: false, error: 'unknown blob index' };
    if (!this._meta.sealed) {
      const bytes = ciphertext || this._plaintexts.get(i);
      return bytes ? { ok: true, plaintext: bytes } : { ok: false, error: 'no bytes' };
    }
    const key = Buffer.isBuffer(keyHex) ? keyHex.toString('hex') : String(keyHex || '').toLowerCase();
    if (!HEX64.test(key)) return { ok: false, error: 'keyHex must be 64 hex chars' };
    if (leaf.paymentHashHex && paymentHashHexFromKey(key) !== leaf.paymentHashHex) {
      return { ok: false, error: 'key does not match paymentHashHex' };
    }
    const ct = ciphertext || this._ciphertexts.get(i);
    if (!ct) return { ok: false, error: 'no ciphertext for blob' };
    if (sha256Hex(ct) !== leaf.blobHashHex) return { ok: false, error: 'blob hash mismatch' };
    try {
      const plaintext = openCiphertext(ct, key, leaf.iv);
      if (leaf.plaintextSha256 && sha256Hex(plaintext) !== leaf.plaintextSha256) {
        return { ok: false, error: 'plaintextSha256 mismatch' };
      }
      this._keys.set(i, key);
      this._ciphertexts.set(i, Buffer.from(ct));
      this._plaintexts.set(i, plaintext);
      return { ok: true, plaintext };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err) };
    }
  }

  /**
   * Reassembled plaintext when every blob has been opened.
   * @returns {Buffer|null}
   */
  content () {
    if (!this.complete) return null;
    return Buffer.concat(this._blobs.map((b) => this._plaintexts.get(b.index)));
  }

  // ---------------------------------------------------------------------
  // Wire shapes (existing message bodies; no new opcodes)
  // ---------------------------------------------------------------------

  /**
   * `P2P_INVENTORY_RESPONSE` item — hash-only. `contentHashHex` on each blob is
   * the per-blob payment hash so one HTLC per blob (and multi-seller plans) work
   * with the existing `DocumentOfferBook`.
   * @param {Object} [opts]
   * @param {number} [opts.rateSats] Per-blob ask.
   * @param {string} [opts.documentId]
   * @returns {Object}
   */
  inventoryItem (opts = {}) {
    const rateSats = Math.max(0, Math.floor(Number(opts.rateSats) || 0));
    const id = opts.documentId || this._meta.documentId;
    const item = {
      id,
      rateSats,
      sealed: this._meta.sealed,
      merkleRootHex: this._meta.merkleRootHex,
      blobTotal: this._meta.blobTotal,
      chunkBytes: this._meta.chunkBytes,
      size: this._meta.size,
      perBlob: this._meta.sealed,
      network: 'bitcoin',
      blobs: this._blobs.map((b) => {
        const pay = this.paymentHashFor(b.index);
        const out = {
          index: b.index,
          total: b.total,
          blobHashHex: b.blobHashHex,
          size: b.size,
          rateSats,
          contentHash: pay,
          contentHashHex: pay
        };
        // Public (it rides every unpaid frame); lets buyers pin it.
        if (b.iv) out.iv = b.iv;
        return out;
      })
    };
    if (this._meta.publisher) item.publisher = this._meta.publisher;
    return item;
  }

  /**
   * `P2P_FILE_SEND` bodies, one per blob (ciphertext when sealed). The
   * `perBlob` flag tells receivers each blob opens with its own key reveal.
   * @param {Object} [opts]
   * @param {string} [opts.documentId]
   * @param {number[]} [opts.indexes] Subset of blob indexes.
   * @returns {Object[]}
   */
  fileSendObjects (opts = {}) {
    const id = opts.documentId || this._meta.documentId;
    const want = Array.isArray(opts.indexes) ? new Set(opts.indexes.map(Number)) : null;
    const out = [];
    for (const b of this._blobs) {
      if (want && !want.has(b.index)) continue;
      const bytes = this.bytesFor(b.index);
      if (!bytes) continue;
      const obj = {
        name: id,
        body: bytes.toString('base64'),
        blobIndex: b.index,
        blobTotal: b.total,
        blobHashHex: b.blobHashHex,
        merkleRootHex: this._meta.merkleRootHex,
        chunkBytes: this._meta.chunkBytes
      };
      if (this._meta.sealed) {
        obj.sealed = true;
        obj.perBlob = true;
        obj.paymentHashHex = b.paymentHashHex;
        obj.iv = b.iv;
        obj.scheme = b.scheme;
        obj.plaintextSha256 = b.plaintextSha256;
      }
      out.push(obj);
    }
    return out;
  }

  /**
   * Existing `DocumentContentKeyReveal` body for one blob (`K_i`).
   * @param {number} index
   * @param {Object} [opts]
   * @param {string} [opts.documentId]
   * @param {string} [opts.settlementId]
   * @returns {Object} GenericMessage-shaped `{ type, object }`
   */
  keyRevealFor (index, opts = {}) {
    const i = Number(index);
    const leaf = this.blob(i);
    const keyHex = this.keyFor(i);
    if (!leaf || !keyHex) throw new Error(`no key for blob ${index}`);
    const body = buildKeyRevealMessage({
      documentId: opts.documentId || this._meta.documentId,
      keyHex,
      paymentHashHex: leaf.paymentHashHex,
      iv: leaf.iv,
      scheme: leaf.scheme,
      plaintextSha256: leaf.plaintextSha256,
      settlementId: opts.settlementId
    });
    body.object.blobIndex = i;
    body.object.blobHashHex = leaf.blobHashHex;
    return body;
  }

  // ---------------------------------------------------------------------
  // Presentation (kept: [env, ui] Jade contract for @fabric/http)
  // ---------------------------------------------------------------------

  /**
   * Compiles an `input` {@link State} snapshot (signed instruction payload).
   * ENV provides the name of a parent type (e.g., "scaffold" or "0xDEADBEEF...")
   * UI provides the name of the desired component
   * @param  {Array|Object}  input [env, ui]
   * @return {Promise}       Promise which resolves on compilation.
   */
  async compile (input) {
    const vector = new State(input);
    vector._sign();
    const env = String(input[0]);
    const ui = String(input[1] || 'fabric-document');
    const attributes = [`state="${vector.id}"`];
    // Hash-only binding: the component locates the record / offers by root.
    if (this.merkleRootHex) attributes.push(`data-merkle-root="${this.merkleRootHex}"`);
    if (this.documentId) attributes.push(`data-document-id="${String(this.documentId).replace(/"/g, '')}"`);
    const contract = [
      `extends ${env}`,
      `block content`,
      `  ${ui}(${attributes.join(', ')})`
    ].join('\n');

    this.contract = contract;
    this['@id'] = vector.id;
    await this.commit();

    return contract;
  }

  toString () {
    return `<Document id="${this.id}" />`;
  }
}

Document.MANIFEST_TYPE = MANIFEST_TYPE;
Document.MANIFEST_VERSION = MANIFEST_VERSION;
Document.GCM_TAG_BYTES = GCM_TAG_BYTES;

module.exports = Document;
