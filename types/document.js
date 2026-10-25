'use strict';

/**
 * @fileoverview Sealed blob-tree document.
 *
 * A Fabric {@link Document} is a Merkle tree over wire-sized blobs. The
 * statics split content into blobs (`Document.split`), build and check the
 * tree and its inclusion proofs, advertise the `DocumentBlobIndex`, and
 * reassemble verified blobs; `DocumentBlobTransferBook` collects them off the
 * wire. When sealed, **every blob has its own
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
 *
 * **Document tree** (`Document.rootHex`): domain-separated SHA-256.
 * `leaf_i = H(0x00 || blobHash_i || paymentHash_i || iv_i)` (32 + 32 + 12
 * bytes; zeros when unsealed), `node = H(0x01 || left || right)`, an odd last
 * node is promoted unchanged, and the root is
 * `H(0x02 || uint32be(blobTotal) || treeRoot)`. The root therefore commits the
 * blob count (no CVE-2012-2459 twins), every blob's payment hash `SHA256(K_i)`
 * (the AES key commitment that closes AES-GCM's non-key-committing gap), and
 * its IV, so a frame carries a short inclusion proof and a buyer verifies the
 * free ciphertext (and the pinned key hash and IV) before paying. When the
 * full leaf list will not fit in one AMP body, the advertised index carries
 * only the root (`leavesInline: false`).
 *
 * **Convergent by default.** `seal` derives each `K_i` (and its IV) from the
 * blob's plaintext, so the same bytes seal to the same blob hash, payment
 * hash, and root for every seller: a chunk two files (or two sellers) share is
 * one chunk, bought once and served by anyone holding it. Opening checks that
 * the key really is the content-derived one. `{ private: true }` keeps random
 * per-blob keys (no de-duplication, no confirmation-of-file exposure);
 * `convergenceSecret` scopes de-duplication to those who hold the secret.
 */

const crypto = require('crypto');

const { MAX_MESSAGE_SIZE, MAX_DOCUMENT_BLOBS } = require('../constants');
const State = require('./state');
const {
  CONVERGENT_SCHEME,
  sealPlaintext,
  openCiphertext,
  isConvergentKey,
  paymentHashHexFromKey,
  buildKeyRevealMessage
} = require('../functions/documentSealedExchange');

// Rough JSON envelope overhead for `P2P_FILE_SEND` / blob frames around a
// base64 body (`name`, blob index fields, optional sealed/paymentHash/iv/scheme).
const FILE_SEND_JSON_OVERHEAD = 640;

// Max raw content bytes per blob so base64(body) + JSON stays ≤ MAX_MESSAGE_SIZE.
const DEFAULT_BLOB_CHUNK_BYTES = Math.max(
  256,
  Math.floor((MAX_MESSAGE_SIZE - FILE_SEND_JSON_OVERHEAD) * 3 / 4)
);

// MAX_DOCUMENT_BLOBS × DEFAULT_BLOB_CHUNK_BYTES (197,394,432 bytes ≈ 188.3 MiB).
// Callers with a larger metadata reserve use smaller blobs and a lower ceiling.
const MAX_DOCUMENT_BYTES = MAX_DOCUMENT_BLOBS * DEFAULT_BLOB_CHUNK_BYTES;

const BLOB_INDEX_TYPE = 'DocumentBlobIndex';
const BLOB_MERKLE_ALGO = 'DocumentTree';

const DOCUMENT_TREE_LEAF = 0x00;
const DOCUMENT_TREE_NODE = 0x01;
const DOCUMENT_TREE_ROOT = 0x02;
const DOCUMENT_TREE_IV_BYTES = 12;

// JSON envelope reserve for a sealed per-blob frame: the inclusion proof
// (up to log2(MAX_DOCUMENT_BLOBS) = 13 hex siblings) rides every frame.
const SEALED_FRAME_JSON_OVERHEAD = 2048;
// Max ciphertext bytes per sealed blob so frame + proof stay ≤ MAX_MESSAGE_SIZE.
const SEALED_BLOB_CHUNK_BYTES = Math.max(
  256,
  Math.floor((MAX_MESSAGE_SIZE - SEALED_FRAME_JSON_OVERHEAD) * 3 / 4)
);

/** AES-GCM tag appended to each sealed blob. */
const GCM_TAG_BYTES = 16;
const HEX64 = /^[0-9a-f]{64}$/;
const MANIFEST_TYPE = 'DocumentManifest';

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

/**
 * @param {*} buf
 * @returns {Buffer}
 * @private
 */
function _sha256 (buf) {
  return crypto.createHash('sha256').update(buf).digest();
}

/**
 * @param {*} value
 * @param {string} name
 * @returns {Buffer}
 * @private
 */
function _hex32 (value, name) {
  const h = String(value == null ? '' : value).trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(h)) throw new Error(`${name} must be 64 hex chars`);
  return Buffer.from(h, 'hex');
}

/**
 * Decode an AES-GCM IV given as bytes or canonical base64.
 * @param {Buffer|Uint8Array|string|null} iv
 * @returns {Buffer|null} 12 bytes, or null when missing / malformed
 * @private
 */
function ivBytes (iv) {
  if (iv == null || iv === '') return null;
  let buf;
  if (Buffer.isBuffer(iv) || iv instanceof Uint8Array) {
    buf = Buffer.from(iv);
  } else {
    const s = String(iv).trim();
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(s)) return null;
    buf = Buffer.from(s, 'base64');
    if (buf.toString('base64') !== s) return null;
  }
  return buf.length === DOCUMENT_TREE_IV_BYTES ? buf : null;
}

/**
 * Layers over leaf hashes (leaves first); odd last nodes are promoted.
 * @param {Buffer[]} leaves
 * @returns {Buffer[][]}
 * @private
 */
function _documentLayers (leaves) {
  const layers = [leaves];
  let nodes = leaves;
  while (nodes.length > 1) {
    const next = [];
    for (let i = 0; i < nodes.length; i += 2) {
      next.push(i + 1 < nodes.length
        ? _sha256(Buffer.concat([Buffer.from([DOCUMENT_TREE_NODE]), nodes[i], nodes[i + 1]]))
        : nodes[i]);
    }
    layers.push(next);
    nodes = next;
  }
  return layers;
}

/**
 * @param {Buffer} treeRoot
 * @param {number} total
 * @returns {string}
 * @private
 */
function _documentSealRoot (treeRoot, total) {
  const count = Buffer.alloc(4);
  count.writeUInt32BE(total >>> 0, 0);
  return _sha256(Buffer.concat([Buffer.from([DOCUMENT_TREE_ROOT]), count, treeRoot])).toString('hex');
}

/**
 * @param {number} total
 * @returns {boolean}
 * @private
 */
function _validTotal (total) {
  return Number.isInteger(total) && total >= 1 && total <= MAX_DOCUMENT_BLOBS;
}

/**
 * @param {Buffer[][]} layers
 * @param {number} idx
 * @returns {string[]}
 * @private
 */
function _proofFromLayers (layers, idx) {
  const proof = [];
  for (let level = 0; level < layers.length - 1; level++) {
    const layer = layers[level];
    const sibling = idx % 2 ? idx - 1 : idx + 1;
    if (sibling < layer.length) proof.push(layer[sibling].toString('hex'));
    idx = idx >> 1;
  }
  return proof;
}

/**
 * @param {number} [chunkBytes]
 * @returns {number}
 * @private
 */
function normalizeChunkBytes (chunkBytes) {
  const n = Math.round(Number(chunkBytes));
  if (Number.isFinite(n) && n >= 1) return n;
  return DEFAULT_BLOB_CHUNK_BYTES;
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
    this._convergenceSecret = null;
    /** @private */
    this._meta = {
      merkleRootHex: null,
      computedRootHex: null,
      blobTotal: 0,
      chunkBytes: DEFAULT_BLOB_CHUNK_BYTES,
      sealed: false,
      convergence: null,
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
   * Seal plaintext as a blob tree with one key per blob. Keys are derived
   * from each blob's content (convergent) unless `private` is set.
   * @param {Buffer|string} plaintext
   * @param {Object} [opts]
   * @param {number} [opts.chunkBytes] Ciphertext blob size (default AMP-sized, leaving room for the inclusion proof); plaintext chunks are 16 bytes smaller.
   * @param {string} [opts.documentId] Catalog label (defaults to the Tree root). Offers from different sellers meet on the root, whatever label each uses.
   * @param {string} [opts.publisher] Publisher public key (hex).
   * @param {boolean} [opts.private] random per-blob keys (no cross-seller de-duplication)
   * @param {Buffer|string} [opts.convergenceSecret] scope convergent keys to holders of this secret
   * @returns {Document}
   */
  static seal (plaintext, opts = {}) {
    const plain = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(plaintext == null ? '' : plaintext);
    const chunkBytes = Math.min(normalizeChunkBytes(opts.chunkBytes || SEALED_BLOB_CHUNK_BYTES), SEALED_BLOB_CHUNK_BYTES);
    const plainChunk = Math.max(1, chunkBytes - GCM_TAG_BYTES);
    const total = Math.max(1, Math.ceil(plain.length / plainChunk));
    const convergent = opts.private !== true;
    const secret = convergent && opts.convergenceSecret != null && opts.convergenceSecret !== ''
      ? opts.convergenceSecret
      : null;
    const doc = new Document({ blobs: [] });
    doc._convergenceSecret = secret;
    const blobs = [];
    for (let i = 0; i < total; i++) {
      const slice = plain.subarray(i * plainChunk, Math.min(plain.length, (i + 1) * plainChunk));
      const sealed = sealPlaintext(slice, { convergent, secret });
      const blobHashHex = sha256Hex(sealed.ciphertext);
      blobs.push({
        index: i,
        total,
        blobHashHex,
        paymentHashHex: paymentHashHexFromKey(sealed.key),
        size: sealed.ciphertext.length,
        plaintextSize: slice.length,
        iv: sealed.encryption.iv,
        scheme: sealed.encryption.scheme
      });
      doc._keys.set(i, sealed.key.toString('hex'));
      doc._ciphertexts.set(i, sealed.ciphertext);
      doc._plaintexts.set(i, Buffer.from(slice));
    }
    doc._setBlobs(blobs, {
      sealed: true,
      convergence: convergent ? (secret ? 'scoped' : 'public') : null,
      chunkBytes,
      size: plain.length,
      documentId: opts.documentId || null,
      publisher: opts.publisher || null
    });
    return doc;
  }

  /**
   * Unsealed blob tree over raw content (same leaves and root as `Document.split`).
   * @param {Buffer|string} content
   * @param {Object} [opts]
   * @param {number} [opts.chunkBytes]
   * @param {string} [opts.documentId]
   * @param {string} [opts.publisher]
   * @returns {Document}
   */
  static fromPlain (content, opts = {}) {
    const buf = Buffer.isBuffer(content) ? content : Buffer.from(content == null ? '' : content);
    const split = Document.split(buf, opts.chunkBytes, opts.documentId);
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
    const body = Object.assign({}, meta, { type: MANIFEST_TYPE });
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
   * Document root over blob hashes alone (unsealed blobs: zero payment hash
   * and IV), or with one payment hash on every leaf (a whole-document sale
   * under a single key).
   * @param {string[]} blobHashHexes in index order
   * @param {Object} [opts]
   * @param {string} [opts.paymentHashHex] payment hash committed by every leaf
   * @returns {string} 64 hex chars
   */
  static rootHexFromBlobHashes (blobHashHexes = [], opts = {}) {
    const list = Array.isArray(blobHashHexes) ? blobHashHexes : [];
    const paymentHashHex = opts.paymentHashHex || null;
    return Document.rootHex(list.map((blobHashHex) => ({ blobHashHex, paymentHashHex })));
  }

  /**
   * Compare two IVs by their decoded bytes (base64 spelling does not matter).
   * @param {*} a
   * @param {*} b
   * @returns {boolean}
   */
  static sameIv (a, b) {
    const x = ivBytes(a);
    const y = ivBytes(b);
    return !!(x && y && x.equals(y));
  }

  /**
   * Leaf for one blob: `H(0x00 || blobHash || paymentHash || iv)`.
   * Unsealed blobs use 32 / 12 zero bytes for the payment hash / IV.
   * @param {Object} blob
   * @param {string} blob.blobHashHex SHA256(ciphertext) (64 hex)
   * @param {string} [blob.paymentHashHex] SHA256(K_i) (64 hex)
   * @param {string|Buffer} [blob.iv] 12-byte AES-GCM IV (base64 or bytes)
   * @returns {string} 64 hex chars
   */
  static leafHex (blob = {}) {
    const blobHash = _hex32(blob.blobHashHex, 'blobHashHex');
    const pay = blob.paymentHashHex ? _hex32(blob.paymentHashHex, 'paymentHashHex') : Buffer.alloc(32);
    let iv = Buffer.alloc(DOCUMENT_TREE_IV_BYTES);
    if (blob.iv != null && blob.iv !== '') {
      iv = ivBytes(blob.iv);
      if (!iv) throw new Error('iv must be 12 bytes');
    }
    return _sha256(Buffer.concat([Buffer.from([DOCUMENT_TREE_LEAF]), blobHash, pay, iv])).toString('hex');
  }

  /**
   * Document root for blob leaves in index order.
   * @param {Object[]} blobs `{ blobHashHex, paymentHashHex?, iv? }` per index
   * @returns {string} 64 hex chars
   */
  static rootHex (blobs = []) {
    const list = Array.isArray(blobs) ? blobs : [];
    if (!_validTotal(list.length)) throw new Error(`document must have 1..${MAX_DOCUMENT_BLOBS} blobs`);
    const leaves = list.map((b) => Buffer.from(Document.leafHex(b), 'hex'));
    const layers = _documentLayers(leaves);
    return _documentSealRoot(layers[layers.length - 1][0], list.length);
  }

  /**
   * Inclusion proof for blob `index`: sibling hashes leaf to root, skipping
   * levels where the node is promoted. Positions follow from `index` and the
   * blob count, so the proof is a bare hex list.
   * @param {Object[]} blobs `{ blobHashHex, paymentHashHex?, iv? }` per index
   * @param {number} index
   * @returns {string[]}
   */
  static inclusionProof (blobs = [], index = 0) {
    const list = Array.isArray(blobs) ? blobs : [];
    let idx = Math.round(Number(index));
    if (!Number.isInteger(idx) || idx < 0 || idx >= list.length) throw new Error('blob index out of range');
    const layers = _documentLayers(list.map((b) => Buffer.from(Document.leafHex(b), 'hex')));
    return _proofFromLayers(layers, idx);
  }

  /**
   * Every blob's inclusion proof from one tree build.
   * @param {Object[]} blobs `{ blobHashHex, paymentHashHex?, iv? }` per index
   * @returns {string[][]}
   */
  static inclusionProofs (blobs = []) {
    const list = Array.isArray(blobs) ? blobs : [];
    if (!_validTotal(list.length)) throw new Error(`document must have 1..${MAX_DOCUMENT_BLOBS} blobs`);
    const layers = _documentLayers(list.map((b) => Buffer.from(Document.leafHex(b), 'hex')));
    return list.map((_, i) => _proofFromLayers(layers, i));
  }

  /**
   * Check one blob's leaf against a document root with its inclusion proof.
   * @param {Object} opts
   * @param {string} opts.merkleRootHex document root
   * @param {number} opts.blobTotal blob count the root commits
   * @param {number} opts.blobIndex
   * @param {string} opts.blobHashHex
   * @param {string} [opts.paymentHashHex]
   * @param {string|Buffer} [opts.iv]
   * @param {string[]} opts.proof from {@link Document.inclusionProof}
   * @returns {boolean}
   */
  static verifyInclusion (opts = {}) {
    try {
      const root = String(opts.merkleRootHex || '').trim().toLowerCase();
      const total = Number(opts.blobTotal);
      let idx = Number(opts.blobIndex);
      if (!/^[0-9a-f]{64}$/.test(root) || !_validTotal(total)) return false;
      if (!Number.isInteger(idx) || idx < 0 || idx >= total) return false;
      const proof = Array.isArray(opts.proof) ? opts.proof : [];
      let hash = Buffer.from(Document.leafHex(opts), 'hex');
      let n = total;
      let p = 0;
      while (n > 1) {
        if (idx % 2 === 1 || idx + 1 < n) {
          if (p >= proof.length) return false;
          const sibling = _hex32(proof[p++], 'proof node');
          const pair = idx % 2 === 1 ? [sibling, hash] : [hash, sibling];
          hash = _sha256(Buffer.concat([Buffer.from([DOCUMENT_TREE_NODE]), pair[0], pair[1]]));
        }
        idx = idx >> 1;
        n = Math.ceil(n / 2);
      }
      if (p !== proof.length) return false;
      return _documentSealRoot(hash, total) === root;
    } catch (_) {
      return false;
    }
  }

  /**
   * Check the per-blob leaves an offer advertises against its document root
   * before trusting any of its payment hashes or IVs.
   *
   * - Every blob listed → the root is recomputed from the list.
   * - A subset → each listed blob must carry an inclusion `proof`.
   * - The root commits `blobTotal`, each blob's payment hash and IV, so a
   *   reseller cannot advertise a payment hash (or IV) the publisher did not
   *   seal under.
   *
   * @param {Object} opts
   * @param {string} opts.merkleRootHex advertised document root
   * @param {Object[]} opts.blobs `{ index?, blobHashHex, paymentHashHex?, iv?, proof? }`
   * (`contentHashHex` is read when `paymentHashHex` is absent; `index` defaults to the position)
   * @param {number} opts.blobTotal blob count of the document
   * @returns {{ ok: boolean, error: (string|undefined), index: (number|undefined), indexes: (number[]|undefined) }}
   */
  static verifyOfferLeaves (opts = {}) {
    const root = hex64(opts.merkleRootHex);
    if (!root) return { ok: false, error: 'invalid merkleRootHex' };
    const total = Math.round(Number(opts.blobTotal));
    if (!_validTotal(total)) return { ok: false, error: 'invalid blobTotal' };
    const list = Array.isArray(opts.blobs) ? opts.blobs : [];
    if (!list.length) return { ok: false, error: 'no blob leaves' };
    const byIndex = new Map();
    for (let i = 0; i < list.length; i++) {
      const b = list[i] || {};
      const index = b.index != null ? Number(b.index) : i;
      if (!Number.isInteger(index) || index < 0 || index >= total) return { ok: false, error: 'blob index out of range', index };
      if (byIndex.has(index)) return { ok: false, error: 'duplicate blob index', index };
      const blobHashHex = hex64(b.blobHashHex);
      if (!blobHashHex) return { ok: false, error: 'invalid blobHashHex', index };
      const pay = b.paymentHashHex != null ? b.paymentHashHex : b.contentHashHex;
      byIndex.set(index, {
        blobHashHex,
        paymentHashHex: pay != null && pay !== '' ? String(pay).trim().toLowerCase() : null,
        iv: b.iv != null && b.iv !== '' ? b.iv : null,
        proof: b.proof
      });
    }
    const indexes = Array.from(byIndex.keys()).sort((a, b) => a - b);
    const full = byIndex.size === total;
    try {
      if (full) {
        if (Document.rootHex(indexes.map((i) => byIndex.get(i))) === root) return { ok: true, indexes };
        return { ok: false, error: 'merkle/root mismatch' };
      }
      for (const i of indexes) {
        const b = byIndex.get(i);
        if (!Array.isArray(b.proof)) return { ok: false, error: 'a partial offer needs an inclusion proof per blob', index: i };
        if (!Document.verifyInclusion(Object.assign({}, b, { merkleRootHex: root, blobTotal: total, blobIndex: i }))) {
          return { ok: false, error: 'inclusion proof does not open to merkleRootHex', index: i };
        }
      }
      return { ok: true, indexes };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err) };
    }
  }

  /**
   * Split content into wire-sized blobs and commit them with the document root.
   * Always returns at least one blob (empty buffer → one empty blob).
   *
   * @param {Buffer|string} buffer
   * @param {number} [chunkBytes]
   * @param {string} [documentId]
   * @returns {{
   *   blobs: object[],
   *   merkleRootHex: string,
   *   contentSha256: string,
   *   chunkBytes: number,
   *   documentId: (string|undefined),
   *   index: object
   * }}
   */
  static split (buffer, chunkBytes = DEFAULT_BLOB_CHUNK_BYTES, documentId = undefined) {
    const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer == null ? '' : buffer);
    const size = normalizeChunkBytes(chunkBytes);
    const total = Math.max(1, Math.ceil(buf.length / size) || 1);
    const blobs = [];
    const blobHashHexes = [];

    for (let index = 0; index < total; index++) {
      const start = index * size;
      const bytes = buf.length === 0 && index === 0
        ? Buffer.alloc(0)
        : buf.subarray(start, Math.min(buf.length, start + size));
      const blobHashHex = crypto.createHash('sha256').update(bytes).digest('hex');
      blobHashHexes.push(blobHashHex);
      blobs.push({ index, total, bytes, blobHashHex, size: bytes.length });
    }

    const merkleRootHex = Document.rootHexFromBlobHashes(blobHashHexes);
    const contentSha256 = crypto.createHash('sha256').update(buf).digest('hex');
    const index = Document.blobIndex({
      documentId,
      merkleRootHex,
      contentSha256,
      chunkBytes: size,
      blobs: blobs.map((b) => ({
        index: b.index,
        total: b.total,
        blobHashHex: b.blobHashHex,
        size: b.size
      }))
    });

    return {
      blobs,
      merkleRootHex,
      contentSha256,
      chunkBytes: size,
      index,
      ...(documentId != null ? { documentId: String(documentId) } : {})
    };
  }

  /**
   * Canonical index message (no content bytes). Always produced — even for one blob.
   *
   * @param {object} opts
   * @param {string} [opts.documentId]
   * @param {string} opts.merkleRootHex
   * @param {string} [opts.contentSha256]
   * @param {number} [opts.chunkBytes]
   * @param {Object[]} opts.blobs `{ index, total?, blobHashHex, size?, rateSats?, contentHash? }` per blob
   * @param {boolean} [opts.leavesInline]
   * @returns {object}
   */
  static blobIndex (opts = {}) {
    const blobsIn = Array.isArray(opts.blobs) ? opts.blobs : [];
    const total = blobsIn.length
      ? Math.max(...blobsIn.map((b) => Number(b.total != null ? b.total : blobsIn.length)))
      : 0;
    const blobs = blobsIn.map((b, i) => ({
      index: Number(b.index != null ? b.index : i),
      total: Number(b.total != null ? b.total : total),
      blobHashHex: String(b.blobHashHex || '').toLowerCase(),
      size: b.size != null ? Number(b.size) : null,
      ...(b.rateSats != null ? { rateSats: Number(b.rateSats) } : {}),
      ...(b.contentHash != null ? { contentHash: String(b.contentHash) } : {})
    }));
    const leavesInline = opts.leavesInline !== false;
    const out = {
      '@type': BLOB_INDEX_TYPE,
      merkle: BLOB_MERKLE_ALGO,
      merkleRootHex: String(opts.merkleRootHex || '').toLowerCase(),
      contentSha256: opts.contentSha256 != null ? String(opts.contentSha256).toLowerCase() : null,
      chunkBytes: opts.chunkBytes != null ? normalizeChunkBytes(opts.chunkBytes) : DEFAULT_BLOB_CHUNK_BYTES,
      total: blobs.length ? total : 0,
      leavesInline,
      blobs: leavesInline ? blobs : []
    };
    if (opts.documentId != null) out.documentId = String(opts.documentId);
    return out;
  }

  /**
   * Drop inline leaves when the JSON index would exceed AMP body size.
   * @param {object} index from {@link Document.blobIndex}
   * @param {number} [maxBytes=MAX_MESSAGE_SIZE]
   * @returns {object}
   */
  static compactBlobIndex (index, maxBytes = MAX_MESSAGE_SIZE) {
    const cap = Math.max(256, Math.round(Number(maxBytes) || MAX_MESSAGE_SIZE));
    let wire = index && typeof index === 'object' ? Object.assign({}, index) : Document.blobIndex({});
    const asJson = () => Buffer.byteLength(JSON.stringify(wire), 'utf8');
    if (asJson() <= cap) return wire;
    wire = Object.assign({}, wire, { leavesInline: false, blobs: [] });
    return wire;
  }

  /**
   * Inventory / offer advertisement: index fields + optional per-blob payment hashes.
   * Always includes `blobs[]` when leaves fit; otherwise root-only with `leavesInline: false`.
   *
   * @param {Buffer|string} buffer
   * @param {object} [opts]
   * @param {string} [opts.documentId]
   * @param {number} [opts.chunkBytes]
   * @param {number} [opts.rateSats]
   * @param {boolean} [opts.includePaymentHashes]
   * @returns {{ index: object, itemBlobs: object[], merkleRootHex: string, contentSha256: string, chunkBytes: number }}
   */
  static advertise (buffer, opts = {}) {
    const documentId = opts.documentId != null ? String(opts.documentId) : undefined;
    const split = Document.split(buffer, opts.chunkBytes, documentId);
    const rateSats = Number(opts.rateSats) || 0;
    const perBlobRate = split.blobs.length
      ? Math.max(0, Math.ceil(rateSats / split.blobs.length))
      : 0;
    const includePay = opts.includePaymentHashes !== false && documentId;
    const itemBlobs = split.blobs.map((b) => {
      const row = {
        index: b.index,
        total: b.total,
        blobHashHex: b.blobHashHex,
        size: b.size,
        rateSats: perBlobRate || rateSats
      };
      if (includePay) {
        row.contentHash = Document.blobPaymentHash({
          documentId,
          blobIndex: b.index,
          blobHashHex: b.blobHashHex
        });
      }
      return row;
    });
    let index = Document.blobIndex({
      documentId,
      merkleRootHex: split.merkleRootHex,
      contentSha256: split.contentSha256,
      chunkBytes: split.chunkBytes,
      blobs: itemBlobs
    });
    index = Document.compactBlobIndex(index);
    return {
      index,
      itemBlobs: index.leavesInline === false ? itemBlobs : index.blobs,
      merkleRootHex: split.merkleRootHex,
      contentSha256: split.contentSha256,
      chunkBytes: split.chunkBytes,
      blobs: split.blobs
    };
  }

  /**
   * Verify an index's root against listed (or supplied) blob hashes.
   * @param {object} index
   * @param {string[]} [blobHashHexes] override leaves when `leavesInline` is false
   * @param {Object} [opts]
   * @param {string} [opts.paymentHashHex] whole-document payment hash on every leaf
   * @returns {{ ok: boolean, error: (string|undefined), merkleRootHex: (string|undefined) }}
   */
  static verifyBlobIndex (index, blobHashHexes = null, opts = {}) {
    if (!index || typeof index !== 'object') return { ok: false, error: 'missing index' };
    const want = String(index.merkleRootHex || '').toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(want) && want !== '') {
      return { ok: false, error: 'invalid merkleRootHex' };
    }
    let leaves = Array.isArray(blobHashHexes) ? blobHashHexes.slice() : null;
    if (!leaves) {
      const blobs = Array.isArray(index.blobs) ? index.blobs : [];
      leaves = blobs.map((b) => String(b && b.blobHashHex || '').toLowerCase());
    }
    if (!leaves.length) return { ok: false, error: 'no blob leaves' };
    for (const h of leaves) {
      if (!/^[0-9a-f]{64}$/.test(h)) return { ok: false, error: 'invalid blobHashHex leaf' };
    }
    if (index.total != null && Number(index.total) > 0 && Number(index.total) !== leaves.length) {
      return { ok: false, error: 'blob count does not match index total' };
    }
    const got = Document.rootHexFromBlobHashes(leaves, opts);
    if (want && got !== want) return { ok: false, error: 'merkle/root mismatch', merkleRootHex: got };
    return { ok: true, merkleRootHex: got };
  }

  /**
   * Per-blob payment commitment (distinct from whole-doc purchaseContentHashHex).
   * @param {{ documentId: string, blobIndex: number, blobHashHex: string }} opts
   * @returns {string} 64 hex chars
   */
  static blobPaymentHash (opts = {}) {
    const documentId = String(opts.documentId || '');
    const blobIndex = Math.round(Number(opts.blobIndex));
    const blobHashHex = String(opts.blobHashHex || '').trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(blobHashHex)) throw new Error('blobHashHex must be 64 hex chars');
    if (!Number.isFinite(blobIndex) || blobIndex < 0) throw new Error('blobIndex must be >= 0');
    const tag = Buffer.from('Fabric/DocumentBlob', 'utf8');
    const payload = Buffer.concat([
      tag,
      Buffer.from(documentId, 'utf8'),
      Buffer.from([0]),
      Buffer.from(String(blobIndex), 'utf8'),
      Buffer.from([0]),
      Buffer.from(blobHashHex, 'utf8')
    ]);
    return crypto.createHash('sha256').update(payload).digest('hex');
  }

  /**
   * @param {Buffer|string} bytes
   * @param {string} expectedHashHex
   * @returns {boolean}
   */
  static verifyBlob (bytes, expectedHashHex) {
    const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes == null ? '' : bytes);
    const want = String(expectedHashHex || '').trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(want)) return false;
    const got = crypto.createHash('sha256').update(buf).digest('hex');
    return got === want;
  }

  /**
   * @param {Map<number, Buffer>|object} blobsByIndex
   * @param {number} total
   * @param {string} [merkleRootHex]
   * @param {Object} [opts]
   * @param {Map<number, Object>|Object[]} [opts.leaves] `{ paymentHashHex?, iv? }`
   * per blob index; a whole-document sale repeats one payment hash
   * @returns {{ ok: boolean, buffer: (Buffer|undefined), error: (string|undefined), merkleRootHex: (string|undefined) }}
   */
  static reassemble (blobsByIndex, total, merkleRootHex = null, opts = {}) {
    const n = Math.round(Number(total));
    if (!Number.isFinite(n) || n < 1) return { ok: false, error: 'invalid total' };
    const leaves = opts.leaves || [];
    const parts = [];
    const blobs = [];
    for (let i = 0; i < n; i++) {
      const b = blobsByIndex instanceof Map ? blobsByIndex.get(i) : blobsByIndex[i];
      if (b == null) return { ok: false, error: `missing blob ${i}` };
      const buf = Buffer.isBuffer(b) ? b : Buffer.from(b);
      parts.push(buf);
      const leaf = (leaves instanceof Map ? leaves.get(i) : leaves[i]) || {};
      blobs.push({
        blobHashHex: crypto.createHash('sha256').update(buf).digest('hex'),
        paymentHashHex: leaf.paymentHashHex || null,
        iv: leaf.iv || null
      });
    }
    const buffer = Buffer.concat(parts);
    let gotRoot;
    try {
      gotRoot = Document.rootHex(blobs);
    } catch (err) {
      return { ok: false, error: err.message };
    }
    if (merkleRootHex) {
      const want = String(merkleRootHex).toLowerCase();
      if (gotRoot !== want) {
        // With leaf metadata the root must commit it; the whole-content hash proves nothing about the leaves.
        if (opts.leaves != null) return { ok: false, error: 'merkle/root mismatch', merkleRootHex: gotRoot };
        const full = crypto.createHash('sha256').update(buffer).digest('hex');
        if (full !== want) {
          return { ok: false, error: 'merkle/root mismatch', merkleRootHex: gotRoot };
        }
      }
    }
    return { ok: true, buffer, merkleRootHex: gotRoot };
  }

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
      iv: b.iv != null ? String(b.iv) : null,
      scheme: b.scheme != null ? String(b.scheme) : null
    }));
    this._setBlobs(blobs, {
      sealed: record.sealed === true || blobs.some((b) => !!b.paymentHashHex && !!b.iv),
      convergence: record.convergence === 'scoped' ? 'scoped'
        : (record.convergence === 'public' || blobs.some((b) => b.scheme === CONVERGENT_SCHEME) ? 'public' : null),
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
    let computed = null;
    if (this._blobs.length && this._blobs.every((b) => b.blobHashHex)) {
      try {
        computed = Document.rootHex(this._blobs);
      } catch (_) {
        computed = null;
      }
    }
    this._proofs = null;
    this._meta.computedRootHex = computed;
    this._meta.merkleRootHex = meta.merkleRootHex || computed;
    this._meta.blobTotal = this._blobs.length;
    this._meta.chunkBytes = meta.chunkBytes || this._meta.chunkBytes;
    this._meta.sealed = !!meta.sealed;
    this._meta.convergence = meta.sealed && meta.convergence ? meta.convergence : null;
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
   * `'public'` (content-derived keys anyone can check), `'scoped'` (derived
   * under a convergence secret), or `null` (private random keys / unsealed).
   * @type {string|null}
   */
  get convergence () { return this._meta.convergence; }
  /** True when blob keys are derived from content (cross-seller de-duplication). */
  get convergent () { return !!this._meta.convergence; }
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
      convergence: this._meta.convergence,
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
   * Hold `K_i` without opening the blob (seller rehydrating from storage).
   * @param {number} index
   * @param {string|Buffer} keyHex must hash to the blob's payment hash
   * @returns {boolean}
   */
  setKey (index, keyHex) {
    const leaf = this.blob(index);
    const key = Buffer.isBuffer(keyHex) ? keyHex.toString('hex') : String(keyHex || '').toLowerCase();
    if (!leaf || !leaf.paymentHashHex || !HEX64.test(key)) return false;
    if (paymentHashHexFromKey(key) !== leaf.paymentHashHex) return false;
    this._keys.set(leaf.index, key);
    return true;
  }

  /**
   * Hold the convergence secret of a `'scoped'` document so opened blobs can
   * be checked against their content-derived keys. Never part of `record()`.
   * @param {Buffer|string|null} secret
   * @returns {Document}
   */
  setConvergenceSecret (secret) {
    this._convergenceSecret = secret == null || secret === '' ? null : secret;
    return this;
  }

  /**
   * True when a convergent blob's key can be checked against its plaintext
   * here (public convergence, or scoped with the secret held).
   * @param {Object} leaf
   * @returns {boolean}
   * @private
   */
  _checksConvergence (leaf) {
    if (!leaf || leaf.scheme !== CONVERGENT_SCHEME) return false;
    if (this._meta.convergence === 'scoped') return this._convergenceSecret != null;
    return true;
  }

  /**
   * Inclusion proof for one blob (`[]` for a one-blob tree).
   * @param {number} index
   * @returns {string[]|null} null when the leaves do not build a root
   */
  proofFor (index) {
    if (!this._meta.computedRootHex) return null;
    const i = this._blobs.findIndex((b) => b.index === Number(index));
    if (i < 0) return null;
    if (!this._proofs) this._proofs = Document.inclusionProofs(this._blobs);
    return this._proofs[i].slice();
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
    return !!this._meta.computedRootHex && this._meta.computedRootHex === this._meta.merkleRootHex;
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
   * Open one sealed blob with its key (checks `SHA256(K_i)`; GCM authenticates the plaintext).
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
      if (this._checksConvergence(leaf) &&
          !isConvergentKey(plaintext, key, { iv: leaf.iv, secret: this._convergenceSecret })) {
        return { ok: false, error: 'key is not derived from the blob content' };
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
   * with the existing `Book`.
   * A full list lets the buyer recompute the root (`verifyOfferLeaves`); a
   * subset (`indexes`) carries an inclusion proof per blob instead.
   * @param {Object} [opts]
   * @param {number} [opts.rateSats] Per-blob ask.
   * @param {string} [opts.documentId]
   * @param {number[]} [opts.indexes] Subset of blob indexes.
   * @param {boolean} [opts.proofs] Attach proofs even to a full list.
   * @param {number} [opts.creditRateSats] Per-blob price on the credit rail
   *   (pay after verify over a channel); advertised with `paymentModes`.
   * @returns {Object}
   */
  inventoryItem (opts = {}) {
    const rateSats = Math.max(0, Math.floor(Number(opts.rateSats) || 0));
    const creditRateSats = Number(opts.creditRateSats) > 0 ? Math.floor(Number(opts.creditRateSats)) : null;
    const id = opts.documentId || this._meta.documentId;
    const want = Array.isArray(opts.indexes) ? new Set(opts.indexes.map(Number)) : null;
    const withProofs = !!want || opts.proofs === true;
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
      blobs: this._blobs.filter((b) => !want || want.has(b.index)).map((b) => {
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
        if (withProofs) {
          const proof = this.proofFor(b.index);
          if (proof) out.proof = proof;
        }
        return out;
      })
    };
    if (this._meta.convergence) item.convergence = this._meta.convergence;
    if (creditRateSats != null && this._meta.sealed) {
      item.creditRateSats = creditRateSats;
      item.paymentModes = ['htlc', 'credit'];
    }
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
        if (this._meta.convergence) obj.convergence = this._meta.convergence;
      }
      obj.proof = this.proofFor(b.index) || [];
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
Document.GCM_TAG_BYTES = GCM_TAG_BYTES;

Document.CHUNK_BYTES = DEFAULT_BLOB_CHUNK_BYTES;
Document.SEALED_CHUNK_BYTES = SEALED_BLOB_CHUNK_BYTES;
Document.SEALED_FRAME_OVERHEAD = SEALED_FRAME_JSON_OVERHEAD;
Document.MAX_BYTES = MAX_DOCUMENT_BYTES;
Document.BLOB_INDEX_TYPE = BLOB_INDEX_TYPE;

module.exports = Document;
