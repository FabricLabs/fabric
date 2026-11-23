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

const {
  MAX_MESSAGE_SIZE,
  MAX_DOCUMENT_BLOBS,
  MAX_DOCUMENT_BYTES,
  DOCUMENT_CHUNK_BYTES,
  DOCUMENT_SEALED_CHUNK_BYTES,
  DOCUMENT_GCM_TAG_BYTES
} = require('../constants');
const State = require('./state');
const {
  CONVERGENT_SCHEME,
  sealPlaintext,
  openCiphertext,
  isConvergentKey,
  paymentHashHexFromKey,
  buildKeyRevealMessage
} = require('../functions/documentSealedExchange');

// Chunk sizes and the file cap live in `constants.js` so the blob count is
// exactly the number of sealed plaintext chunks in a 2^32 − 1 byte file.
const DEFAULT_BLOB_CHUNK_BYTES = DOCUMENT_CHUNK_BYTES;
const SEALED_BLOB_CHUNK_BYTES = DOCUMENT_SEALED_CHUNK_BYTES;

const BLOB_INDEX_TYPE = 'DocumentBlobIndex';
const BLOB_MERKLE_ALGO = 'DocumentTree';

const DOCUMENT_TREE_LEAF = 0x00;
const DOCUMENT_TREE_NODE = 0x01;
const DOCUMENT_TREE_ROOT = 0x02;
const DOCUMENT_TREE_IV_BYTES = 12;

/** AES-GCM tag appended to each sealed blob. */
const GCM_TAG_BYTES = DOCUMENT_GCM_TAG_BYTES;

/**
 * Refuse a file larger than {@link MAX_DOCUMENT_BYTES}.
 * @param {number} byteLength
 * @private
 */
function assertDocumentByteLength (byteLength) {
  if (!Number.isSafeInteger(byteLength) || byteLength < 0 || byteLength > MAX_DOCUMENT_BYTES) {
    throw new Error(`document is ${byteLength} bytes (max ${MAX_DOCUMENT_BYTES})`);
  }
}

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
    assertDocumentByteLength(plain.length);
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
    assertDocumentByteLength(buf.length);
    const size = normalizeChunkBytes(chunkBytes);
    const total = Math.max(1, Math.ceil(buf.length / size) || 1);
    if (!_validTotal(total)) {
      throw new Error(`document would split into ${total} blobs (1..${MAX_DOCUMENT_BLOBS} allowed at ${size} bytes per blob)`);
    }
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
    // A loop, not Math.max(...): a FAT-sized file is ~1.9e5 blobs, and the
    // spread overflows the stack.
    let total = 0;
    for (let i = 0; i < blobsIn.length; i++) {
      const n = Number(blobsIn[i].total != null ? blobsIn[i].total : blobsIn.length);
      if (n > total) total = n;
    }
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
    if (!_validTotal(leaves.length)) return { ok: false, error: `document must have 1..${MAX_DOCUMENT_BLOBS} blobs` };
    for (const h of leaves) {
      if (!/^[0-9a-f]{64}$/.test(h)) return { ok: false, error: 'invalid blobHashHex leaf' };
    }
    if (index.total != null && Number(index.total) > 0 && Number(index.total) !== leaves.length) {
      return { ok: false, error: 'blob count does not match index total' };
    }
    let got;
    try {
      got = Document.rootHexFromBlobHashes(leaves, opts);
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err) };
    }
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
Document.MAX_BYTES = MAX_DOCUMENT_BYTES;
Document.checkFileSize = assertDocumentByteLength;
Document.BLOB_INDEX_TYPE = BLOB_INDEX_TYPE;

module.exports = Document;

const document_list = (function () {
/**
 * @fileoverview Compact document catalogs shared as `DocumentList` contract
 * messages. Rows carry metadata only (no bytes, blob indexes, or content).
 * A list that does not fit one AMP body is split. Folding is by document id
 * and does not depend on arrival order: the newest `observedAt` wins, and an
 * equal time keeps the higher frame hash. A winning row with `removed: true`
 * drops the id.
 *
 */

const { MAX_DOCUMENT_ID_LENGTH, MAX_MESSAGE_SIZE } = require('../constants');
const Message = require('./message');
const { CONTRACT_BODY_TYPES } = require('../functions/applicationNamespaces');

const DOCUMENT_LIST_TYPE = CONTRACT_BODY_TYPES.DocumentList;
const DOCUMENT_LIST_VERSION = 1;
const NAME_MAX = 128;
const MIME_MAX = 128;

/**
 * @param {*} value
 * @returns {string}
 * @private
 */
function cleanText (value) {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * @param {*} value
 * @returns {string|null}
 * @private
 */
function hex64 (value) {
  const s = String(value || '').trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(s) ? s : null;
}

/**
 * @param {*} value
 * @returns {number|null}
 * @private
 */
function nonNegativeInt (value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.floor(n));
}

/**
 * Metadata for one document. Drops content, blobs, and `documentBlobIndex`.
 * @param {object} row
 * @returns {object|null}
 */
function compactDocumentRow (row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  let id = String(row.id || row.sha256 || '').trim();
  if (!id || id.length > MAX_DOCUMENT_ID_LENGTH) return null;
  if (/^[0-9a-fA-F]+$/.test(id)) id = id.toLowerCase();
  const sha256 = hex64(row.sha256) || hex64(id);
  if (row.removed === true) {
    const removed = { id, removed: true };
    if (sha256) removed.sha256 = sha256;
    return removed;
  }
  const name = cleanText(row.name || row.title).slice(0, NAME_MAX) || 'file';
  const mime = cleanText(row.mime || row.mime_type || 'application/octet-stream').slice(0, MIME_MAX)
    || 'application/octet-stream';
  const out = {
    id,
    name,
    mime
  };
  if (sha256) out.sha256 = sha256;
  const size = nonNegativeInt(row.size != null ? row.size : row.file_size);
  if (size != null) out.size = size;
  const root = hex64(row.merkleRootHex);
  if (root) out.merkleRootHex = root;
  const blobTotal = nonNegativeInt(row.blobTotal);
  if (blobTotal != null) out.blobTotal = blobTotal;
  const chunkBytes = nonNegativeInt(row.chunkBytes);
  if (chunkBytes != null) out.chunkBytes = chunkBytes;
  const price = nonNegativeInt(row.purchasePriceSats);
  if (price != null && row.purchasePriceSats != null && row.purchasePriceSats !== '') {
    out.purchasePriceSats = price;
  }
  return out;
}

/**
 * @param {string} [value]
 * @returns {string}
 * @private
 */
function observedAtOf (value, fallback) {
  if (value) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return fallback;
}

/**
 * One catalog object. `recipient`, when set, is also the contract-message
 * index field (it is not a document row).
 * @param {object} opts
 * @param {string} opts.libraryId
 * @param {string} [opts.publisher]
 * @param {Array<object>} [opts.documents]
 * @param {string} [opts.observedAt]
 * @param {string} [opts.recipient]
 * @param {boolean} [opts.truncated]
 * @returns {object|null}
 */
function buildDocumentList (opts = {}) {
  const libraryId = String(opts.libraryId || '').trim();
  if (!libraryId || libraryId.length > MAX_DOCUMENT_ID_LENGTH) return null;
  const documents = [];
  const raw = Array.isArray(opts.documents) ? opts.documents : [];
  for (const row of raw) {
    const compact = compactDocumentRow(row);
    if (compact) documents.push(compact);
  }
  const out = {
    type: DOCUMENT_LIST_TYPE,
    v: DOCUMENT_LIST_VERSION,
    libraryId,
    publisher: cleanText(opts.publisher).slice(0, 256),
    observedAt: observedAtOf(opts.observedAt, new Date().toISOString()),
    truncated: opts.truncated === true,
    documents
  };
  const recipient = cleanText(opts.recipient).slice(0, 256);
  if (recipient) out.recipient = recipient;
  return out;
}

/**
 * Byte length of a `CONTRACT_MESSAGE` body for this list, or `Infinity` when
 * the body cannot be encoded under the AMP cap.
 * @param {object} list
 * @param {string} contractId
 * @returns {number}
 */
function documentListBodyLength (list, contractId) {
  const contract = String(contractId || (list && list.libraryId) || '').trim();
  if (!contract || !list) return Infinity;
  try {
    const msg = Message.fromLegacyBody('CONTRACT_MESSAGE', Object.assign({ contract }, list));
    const data = msg.raw && msg.raw.data;
    if (!data) return Infinity;
    return data.length;
  } catch (err) {
    return Infinity;
  }
}

/**
 * @param {object} list
 * @param {string} contractId
 * @returns {boolean}
 */
function documentListFits (list, contractId) {
  const len = documentListBodyLength(list, contractId);
  return len > 0 && len <= MAX_MESSAGE_SIZE;
}

/**
 * Split `documents` until each `DocumentList` encodes under the AMP body cap.
 * @param {object} opts Same fields as {@link buildDocumentList}, plus `contract`.
 * @param {string} [opts.contract] Namespace id used to measure the frame.
 * @returns {object[]}
 */
function chunkDocumentList (opts = {}) {
  const contract = String(opts.contract || opts.libraryId || '').trim();
  const documents = [];
  const raw = Array.isArray(opts.documents) ? opts.documents : [];
  for (const row of raw) {
    const compact = compactDocumentRow(row);
    if (compact) documents.push(compact);
  }
  if (!documents.length) {
    const empty = buildDocumentList(Object.assign({}, opts, { documents: [], truncated: opts.truncated === true }));
    return empty && documentListFits(empty, contract) ? [empty] : [];
  }
  const chunks = [];
  let batch = [];
  const flush = (truncated) => {
    if (!batch.length) return;
    const list = buildDocumentList(Object.assign({}, opts, {
      documents: batch,
      truncated: truncated === true
    }));
    if (list) chunks.push(list);
    batch = [];
  };
  for (const doc of documents) {
    const trial = batch.concat([doc]);
    const trialList = buildDocumentList(Object.assign({}, opts, {
      documents: trial,
      truncated: true
    }));
    if (trialList && documentListFits(trialList, contract)) {
      batch = trial;
      continue;
    }
    flush(true);
    const alone = buildDocumentList(Object.assign({}, opts, {
      documents: [doc],
      truncated: true
    }));
    if (alone && documentListFits(alone, contract)) batch = [doc];
  }
  const tailTruncated = opts.truncated === true || chunks.length > 0 || batch.length < documents.length;
  flush(tailTruncated);
  if (chunks.length === 1 && opts.truncated !== true && chunks[0].documents.length === documents.length) {
    const open = Object.assign({}, chunks[0], { truncated: false });
    if (documentListFits(open, contract)) {
      chunks[0] = open;
    } else if (chunks[0].documents.length > 1) {
      const docs = chunks[0].documents;
      const head = buildDocumentList(Object.assign({}, opts, { documents: docs.slice(0, -1), truncated: true }));
      const tail = buildDocumentList(Object.assign({}, opts, { documents: docs.slice(-1), truncated: false }));
      const tailFits = tail && documentListFits(tail, contract);
      const headFits = head && documentListFits(head, contract);
      if (headFits && tailFits) chunks.splice(0, 1, head, tail);
      else if (tail && !tailFits) {
        const capped = buildDocumentList(Object.assign({}, opts, { documents: docs, truncated: true }));
        if (capped && documentListFits(capped, contract)) chunks[0] = capped;
      }
    } else {
      const capped = buildDocumentList(Object.assign({}, opts, { documents: chunks[0].documents, truncated: true }));
      if (capped && documentListFits(capped, contract)) chunks[0] = capped;
    }
  }
  return chunks;
}

/**
 * @param {object} frame
 * @returns {{ list: object, hash: string }|null}
 * @private
 */
function frameParts (frame) {
  if (!frame || typeof frame !== 'object') return null;
  const list = frame.documents || frame.type === DOCUMENT_LIST_TYPE
    ? frame
    : (frame.list && typeof frame.list === 'object' ? frame.list : null);
  if (!list || !Array.isArray(list.documents)) return null;
  const hash = String(frame.hash || frame.frameHash || list.hash || '').toLowerCase();
  return { list, hash };
}

/**
 * @param {{ observedAt: string, hash: string }} next
 * @param {{ observedAt: string, hash: string }} prev
 * @returns {boolean}
 * @private
 */
function wins (next, prev) {
  if (next.observedAt > prev.observedAt) return true;
  if (next.observedAt < prev.observedAt) return false;
  if (next.hash !== prev.hash) return next.hash > prev.hash;
  const nextRemoved = !!(next.row && next.row.removed === true);
  const prevRemoved = !!(prev.row && prev.row.removed === true);
  if (nextRemoved !== prevRemoved) return nextRemoved;
  return false;
}

/**
 * Merge catalog frames. Arrival order does not change the result.
 * @param {Array<object>} frames DocumentList objects, optionally with `hash`.
 * @returns {{ documents: object[], truncated: boolean }}
 */
function foldDocumentList (frames) {
  const best = new Map();
  let truncated = false;
  const rows = Array.isArray(frames) ? frames : [];
  for (const frame of rows) {
    const parts = frameParts(frame);
    if (!parts) continue;
    if (parts.list.truncated === true) truncated = true;
    const observedAt = observedAtOf(parts.list.observedAt, '1970-01-01T00:00:00.000Z');
    for (const raw of parts.list.documents) {
      const row = compactDocumentRow(raw);
      if (!row) continue;
      const candidate = { row, observedAt, hash: parts.hash };
      const prev = best.get(row.id);
      if (!prev || wins(candidate, prev)) best.set(row.id, candidate);
    }
  }
  const documents = [];
  for (const entry of best.values()) {
    if (entry.row.removed === true) continue;
    documents.push(entry.row);
  }
  documents.sort((a, b) => {
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });
  return { documents, truncated };
}

/**
 * Bytes of a CONTRACT_MESSAGE that are not the application object.
 * The larger of a field-encoded probe ({@link Message.fromLegacyBody}) and a
 * legacy JSON envelope (`contract`, `type`, `actor`, `object`) so a payload
 * that fits this reserve still fits either encoding.
 * @returns {number}
 */
function contractMessageEnvelopeReserve () {
  const probe = { type: 'probe', v: 1 };
  const probeBytes = Buffer.byteLength(JSON.stringify(probe), 'utf8');
  const contract = 'a'.repeat(64);
  const pubkey = '02' + 'b'.repeat(64);
  const wrapped = {
    contract,
    type: 'DocumentList',
    actor: { publicKey: pubkey, id: pubkey },
    object: probe
  };
  const jsonReserve = Buffer.byteLength(JSON.stringify(wrapped), 'utf8') - probeBytes;
  let fieldReserve = jsonReserve;
  try {
    const msg = Message.fromLegacyBody('CONTRACT_MESSAGE', Object.assign({
      contract,
      recipient: pubkey
    }, probe));
    const data = msg.raw && msg.raw.data;
    if (data) fieldReserve = Math.max(0, data.length - probeBytes);
  } catch (err) {
    fieldReserve = jsonReserve;
  }
  return Math.max(jsonReserve, fieldReserve, 1);
}

/**
 * Largest UTF-8 JSON object that still fits in one AMP body after the reserve.
 * @returns {number}
 */
function ampObjectBudget () {
  return Math.max(1024, MAX_MESSAGE_SIZE - contractMessageEnvelopeReserve());
}
  return {
    DOCUMENT_LIST_TYPE,
    DOCUMENT_LIST_VERSION,
    compactDocumentRow,
    buildDocumentList,
    chunkDocumentList,
    documentListBodyLength,
    documentListFits,
    foldDocumentList,
    contractMessageEnvelopeReserve,
    ampObjectBudget
  };
})();
Document.DOCUMENT_LIST_TYPE = document_list.DOCUMENT_LIST_TYPE;
Document.DOCUMENT_LIST_VERSION = document_list.DOCUMENT_LIST_VERSION;
Document.compactDocumentRow = document_list.compactDocumentRow;
Document.buildDocumentList = document_list.buildDocumentList;
Document.chunkDocumentList = document_list.chunkDocumentList;
Document.documentListBodyLength = document_list.documentListBodyLength;
Document.documentListFits = document_list.documentListFits;
Document.foldDocumentList = document_list.foldDocumentList;
Document.contractMessageEnvelopeReserve = document_list.contractMessageEnvelopeReserve;
Document.ampObjectBudget = document_list.ampObjectBudget;
const document_revisions = (function () {
/**
 * @fileoverview Editable documents as contracts. A `DocumentContract` is a
 * `CONTRACT_PUBLISH` whose signers are the document's editors; every edit is a
 * signed `CONTRACT_MESSAGE` of type `DocumentRevision` whose header `parent`
 * is the frame id ({@link Message#id}) of the revision it replaces (revision 1
 * points at the publish frame). Each version keeps its own content-addressed
 * document identifier, so older versions stay shareable and purchasable; the
 * frames from the publish to a version are that version's provenance, which
 * anyone can check offline.
 *
 * Folding does not depend on arrival order. Two edits on the same parent are
 * both kept: the head is the highest revision (lowest frame id on a tie), and
 * revisions off the head's chain are reported as `forks`.
 *
 * @see docs/DOCUMENT_REVISIONS.md
 */

const crypto = require('crypto');

const Actor = require('./actor');
const Message = require('./message');
const {
  MAX_DOCUMENT_ID_LENGTH,
  P2P_CONTRACT_PUBLISH,
  P2P_CONTRACT_MESSAGE
} = require('../constants');
const { CONTRACT_BODY_TYPES } = require('../functions/applicationNamespaces');
const { pubkeyXOnly } = require('./key');
function collections () {
  return require('../functions/fabricMessageCollection');
}

const DOCUMENT_CONTRACT_TYPE = 'DocumentContract';
const DOCUMENT_REVISION_TYPE = CONTRACT_BODY_TYPES.DocumentRevision;
const DOCUMENT_PROVENANCE_TYPE = 'DocumentProvenance';
const DOCUMENT_REVISIONS_VERSION = 1;
/** Editors one contract may list. */
const MAX_EDITORS = 64;
const NAME_MAX = 256;
const MIME_MAX = 128;
const NOTE_MAX = 1024;

/**
 * @param {*} value
 * @param {number} max
 * @returns {string}
 * @private
 */
function cleanText (value, max) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, max);
}

/**
 * @param {*} value
 * @returns {string|null}
 * @private
 */
function hex64 (value) {
  const s = String(value || '').trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(s) ? s : null;
}

/**
 * A document identifier as stored: 1–128 safe characters, hex lowercased.
 * @param {*} value
 * @returns {string|null}
 */
function normalizeDocumentIdentifier (value) {
  let s = String(value == null ? '' : value).trim();
  if (!s || s.length > MAX_DOCUMENT_ID_LENGTH) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return null;
  if (/^[0-9a-fA-F]+$/.test(s)) s = s.toLowerCase();
  return s;
}

/**
 * @param {*} value
 * @returns {string}
 * @private
 */
function isoTime (value) {
  if (value) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

/**
 * x-only hex of a Key (or a pubkey string).
 * @param {*} keyOrPubkey
 * @returns {string|null}
 * @private
 */
function xOnlyOf (keyOrPubkey) {
  if (!keyOrPubkey) return null;
  if (typeof keyOrPubkey === 'string') return pubkeyXOnly(keyOrPubkey);
  if (keyOrPubkey.public && typeof keyOrPubkey.public.encodeCompressed === 'function') {
    return pubkeyXOnly(keyOrPubkey.public.encodeCompressed('hex'));
  }
  return pubkeyXOnly(keyOrPubkey.pubkey || keyOrPubkey.publicKey);
}

/**
 * The `CONTRACT_PUBLISH` body for an editable document.
 * @param {Object} opts
 * @param {string} opts.name Document name.
 * @param {string} [opts.mime]
 * @param {string} opts.publisher Publisher pubkey (x-only or compressed). Always an editor.
 * @param {Array<string>} [opts.editors] Further editor pubkeys.
 * @param {number} [opts.threshold=1] Editors that must sign a revision (only 1 is enforced in v1).
 * @param {string} [opts.created] ISO time.
 * @param {string} [opts.nonce] 32-hex; random when omitted, so two contracts for one document differ.
 * @returns {object}
 */
function buildDocumentContractGenesis (opts = {}) {
  const publisher = xOnlyOf(opts.publisher);
  if (!publisher) throw new Error('publisher pubkey required');
  const editors = new Set([publisher]);
  for (const entry of Array.isArray(opts.editors) ? opts.editors : []) {
    const x = xOnlyOf(entry);
    if (!x) throw new Error(`invalid editor pubkey: ${String(entry).slice(0, 80)}`);
    editors.add(x);
  }
  if (editors.size > MAX_EDITORS) throw new Error(`at most ${MAX_EDITORS} editors`);
  const signers = [...editors].sort();
  const threshold = opts.threshold == null ? 1 : Number(opts.threshold);
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > signers.length) {
    throw new Error('threshold must be an integer between 1 and the number of editors');
  }
  const nonce = opts.nonce != null
    ? String(opts.nonce).trim().toLowerCase()
    : crypto.randomBytes(16).toString('hex');
  if (!/^[0-9a-f]{32}$/.test(nonce)) throw new Error('nonce must be 16 bytes of hex');
  return {
    type: DOCUMENT_CONTRACT_TYPE,
    v: DOCUMENT_REVISIONS_VERSION,
    name: cleanText(opts.name, NAME_MAX) || 'document',
    mime: cleanText(opts.mime || 'application/octet-stream', MIME_MAX) || 'application/octet-stream',
    publisher,
    members: { signers, threshold },
    primitives: { messageTypes: [DOCUMENT_REVISION_TYPE] },
    created: isoTime(opts.created),
    nonce
  };
}

/**
 * Contract (namespace) id of a genesis, as every Peer computes it.
 * @param {object} definition
 * @returns {string}
 */
function documentContractId (definition) {
  return new Actor(definition).id;
}

/**
 * Whether a `CONTRACT_PUBLISH` body is a document contract.
 * @param {*} definition
 * @returns {boolean}
 */
function isDocumentContractDefinition (definition) {
  return !!(definition && typeof definition === 'object' && !Array.isArray(definition) &&
    definition.type === DOCUMENT_CONTRACT_TYPE &&
    definition.members && Array.isArray(definition.members.signers));
}

/**
 * Editors (x-only) of a genesis.
 * @param {object} definition
 * @returns {string[]}
 */
function documentContractEditors (definition) {
  if (!isDocumentContractDefinition(definition)) return [];
  const out = [];
  for (const entry of definition.members.signers) {
    const x = pubkeyXOnly(entry);
    if (x && !out.includes(x)) out.push(x);
  }
  return out;
}

/**
 * Signed `CONTRACT_PUBLISH` frame for a genesis (genesis parent).
 * @param {Object} opts
 * @param {object} opts.definition From {@link buildDocumentContractGenesis}.
 * @param {Object} opts.key Fabric Key of an editor (with private key).
 * @returns {Message}
 */
function buildDocumentContractPublishMessage (opts = {}) {
  const definition = opts.definition;
  if (!isDocumentContractDefinition(definition)) throw new Error('document contract definition required');
  const author = xOnlyOf(opts.key);
  if (!author || !documentContractEditors(definition).includes(author)) {
    throw new Error('the publishing key must be one of the editors');
  }
  const message = Message.fromLegacyBody('CONTRACT_PUBLISH', definition);
  message.signWithKey(opts.key);
  return message;
}

/**
 * The `DocumentRevision` body (without the signature or parent).
 * @param {Object} opts
 * @param {string} opts.contract Document contract id.
 * @param {Object} opts.document Version: `id` (or `documentIdentifier`), `sha256`, `name`, `mime`, `size`, `merkleRootHex`.
 * @param {number} opts.revision 1 for the first version.
 * @param {string|null} [opts.previousDocumentIdentifier] Identifier of the version this one replaces.
 * @param {string} [opts.editedAt] ISO time.
 * @param {string} [opts.note]
 * @returns {object}
 */
function buildDocumentRevisionBody (opts = {}) {
  const contract = hex64(opts.contract);
  if (!contract) throw new Error('contract id required');
  const doc = opts.document && typeof opts.document === 'object' ? opts.document : {};
  const documentIdentifier = normalizeDocumentIdentifier(doc.documentIdentifier || doc.id || doc.sha256);
  if (!documentIdentifier) throw new Error('document identifier required');
  const revision = Number(opts.revision);
  if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('revision must be a positive integer');
  let previous = null;
  if (revision > 1) {
    previous = normalizeDocumentIdentifier(opts.previousDocumentIdentifier);
    if (!previous) throw new Error('previousDocumentIdentifier required after revision 1');
  }
  const body = {
    contract,
    type: DOCUMENT_REVISION_TYPE,
    v: DOCUMENT_REVISIONS_VERSION,
    documentIdentifier,
    revision,
    previousDocumentIdentifier: previous,
    name: cleanText(doc.name, NAME_MAX) || 'document',
    mime: cleanText(doc.mime || 'application/octet-stream', MIME_MAX) || 'application/octet-stream',
    editedAt: isoTime(opts.editedAt)
  };
  const sha256 = hex64(doc.sha256);
  if (sha256) body.sha256 = sha256;
  const merkleRootHex = hex64(doc.merkleRootHex);
  if (merkleRootHex) body.merkleRootHex = merkleRootHex;
  const size = Number(doc.size);
  if (Number.isSafeInteger(size) && size >= 0) body.size = size;
  const note = cleanText(opts.note, NOTE_MAX);
  if (note) body.note = note;
  return body;
}

/**
 * Signed `DocumentRevision` frame chained to `opts.previous`.
 * @param {Object} opts Fields of {@link buildDocumentRevisionBody}, plus:
 * @param {Message|Buffer|string|Object} opts.previous The publish frame (revision 1) or the replaced revision's frame (Message, bytes, hex, or a record with `id`).
 * @param {Object} opts.key Fabric Key of an editor (with private key).
 * @returns {Message}
 */
function buildDocumentRevisionMessage (opts = {}) {
  const parent = frameIdOfInput(opts.previous);
  if (!parent) throw new Error('previous frame required');
  const body = buildDocumentRevisionBody(opts);
  const message = Message.fromLegacyBody('CONTRACT_MESSAGE', body);
  message.parent = parent;
  message.signWithKey(opts.key);
  return message;
}

/**
 * @param {*} input
 * @returns {string|null}
 * @private
 */
function frameIdOfInput (input) {
  if (!input) return null;
  if (typeof input === 'string') {
    const id = hex64(input);
    if (id) return id;
  }
  if (input && typeof input === 'object' && !Buffer.isBuffer(input) && typeof input.toBuffer !== 'function') {
    if (hex64(input.id)) return hex64(input.id);
  }
  const decoded = collections().bufferFromInput(input);
  return decoded.ok ? Message.frameIdOf(decoded.buffer) : null;
}

/**
 * Parse and verify one frame of a document contract.
 * @param {*} input Message, Buffer, hex, `fabric:<hex>`, or a collection record.
 * @returns {{ ok: boolean, reason?: string, kind?: 'publish'|'revision', id?: string, hash?: string, hex?: string, parent?: string, author?: string, contractId?: string, definition?: object, body?: object }}
 */
function parseDocumentContractFrame (input) {
  const decoded = collections().bufferFromInput(input);
  if (!decoded.ok) return { ok: false, reason: decoded.error || 'not a frame' };
  const parsed = collections().parseFrame(decoded.buffer);
  if (!parsed.ok) return { ok: false, reason: parsed.error };
  const signed = Message.verifyFrameAuthor(decoded.buffer);
  if (!signed.ok) return { ok: false, reason: signed.reason };
  const out = {
    ok: true,
    id: Message.frameIdOf(decoded.buffer),
    hash: signed.hash,
    hex: decoded.buffer.toString('hex'),
    parent: signed.parent,
    author: signed.author
  };
  const body = Message.tryParseLegacyBody(parsed.message);
  if (!body.ok || !body.value || typeof body.value !== 'object') {
    return { ok: false, reason: 'unreadable body' };
  }
  if (signed.type === P2P_CONTRACT_PUBLISH) {
    if (!isDocumentContractDefinition(body.value)) return { ok: false, reason: 'not a document contract' };
    out.kind = 'publish';
    out.definition = body.value;
    out.contractId = documentContractId(body.value);
    return out;
  }
  if (signed.type === P2P_CONTRACT_MESSAGE) {
    if (body.value.type !== DOCUMENT_REVISION_TYPE) return { ok: false, reason: 'not a document revision' };
    out.kind = 'revision';
    out.body = body.value;
    out.contractId = hex64(body.value.contract);
    if (!out.contractId) return { ok: false, reason: 'revision has no contract id' };
    return out;
  }
  return { ok: false, reason: 'not a contract frame' };
}

/**
 * @param {*} frames Collection, `{ messages }`, provenance, or an array.
 * @returns {Array}
 * @private
 */
function frameList (frames) {
  if (!frames) return [];
  if (Array.isArray(frames)) return frames;
  if (frames.type === DOCUMENT_PROVENANCE_TYPE && frames.collection) return frameList(frames.collection);
  if (Array.isArray(frames.messages)) return frames.messages;
  return [];
}

/**
 * @param {object} parsed
 * @returns {object}
 * @private
 */
function revisionView (parsed) {
  const b = parsed.body;
  const out = {
    revision: b.revision,
    documentIdentifier: b.documentIdentifier,
    previousDocumentIdentifier: b.previousDocumentIdentifier || null,
    name: b.name,
    mime: b.mime,
    editedAt: b.editedAt,
    author: parsed.author,
    frameId: parsed.id,
    parent: parsed.parent,
    hash: parsed.hash
  };
  // A present field, including `null` or `''`, is a signed commitment. Only an omitted field falls back to the identifier.
  if (Object.prototype.hasOwnProperty.call(b, 'sha256')) out.sha256 = b.sha256;
  if (b.merkleRootHex) out.merkleRootHex = b.merkleRootHex;
  if (b.size != null) out.size = b.size;
  if (b.note) out.note = b.note;
  return out;
}

/**
 * @param {object} a
 * @param {object} b
 * @returns {number}
 * @private
 */
function byId (a, b) {
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

/**
 * Fold the frames of one document contract.
 * @param {*} frames Publish + revision frames (any order; other contracts' frames are ignored).
 * @param {Object} [opts]
 * @param {string} [opts.contractId] Which contract, when the frames hold several.
 * @returns {{ ok: boolean, reason?: string, contractId: string|null, definition: object|null, editors: string[], publish: object|null, head: object|null, revisions: object[], forks: object[], invalid: object[], frames: object[] }}
 */
function foldDocumentRevisions (frames, opts = {}) {
  const empty = {
    ok: false,
    contractId: null,
    definition: null,
    editors: [],
    publish: null,
    head: null,
    revisions: [],
    forks: [],
    invalid: [],
    frames: []
  };
  const parsedAll = [];
  const seen = new Set();
  for (const input of frameList(frames)) {
    const parsed = parseDocumentContractFrame(input);
    if (!parsed.ok) {
      empty.invalid.push({ id: null, reason: parsed.reason });
      continue;
    }
    if (seen.has(parsed.id)) continue;
    seen.add(parsed.id);
    parsedAll.push(parsed);
  }
  if (opts.contractId != null && String(opts.contractId) !== '' && !hex64(opts.contractId)) {
    return Object.assign(empty, { reason: 'contract id is not a 64-hex digest' });
  }
  const wanted = hex64(opts.contractId);
  const publishes = parsedAll
    .filter((p) => p.kind === 'publish' && (!wanted || p.contractId === wanted))
    .sort(byId);
  const invalid = empty.invalid;
  let publish = null;
  for (const p of publishes) {
    const editors = documentContractEditors(p.definition);
    if (!Message.isZeroParent(p.parent)) {
      invalid.push({ id: p.id, reason: 'publish frame must be genesis' });
      continue;
    }
    if (!editors.includes(p.author)) {
      invalid.push({ id: p.id, reason: 'publish not signed by an editor' });
      continue;
    }
    if (publish && publish.contractId !== p.contractId) {
      return Object.assign(empty, { reason: 'frames hold several document contracts; pass contractId' });
    }
    if (!publish) publish = p;
  }
  if (!publish) return Object.assign(empty, { reason: 'no document contract publish frame' });

  const contractId = publish.contractId;
  const editors = documentContractEditors(publish.definition);
  const accepted = new Map();
  accepted.set(publish.id, { revision: 0, documentIdentifier: null, parsed: publish });
  let pending = parsedAll
    .filter((p) => p.kind === 'revision' && p.contractId === contractId)
    .sort(byId);
  for (const p of parsedAll) {
    if (p.kind === 'revision' && p.contractId !== contractId && !wanted) {
      invalid.push({ id: p.id, reason: 'revision for another contract' });
    }
  }

  // Accept revisions whose parent is already accepted, until nothing changes.
  let progressed = true;
  while (pending.length && progressed) {
    progressed = false;
    const waiting = [];
    for (const p of pending) {
      const parent = accepted.get(p.parent);
      if (!parent) {
        waiting.push(p);
        continue;
      }
      progressed = true;
      const b = p.body;
      let reason = null;
      if (!editors.includes(p.author)) reason = 'revision not signed by an editor';
      else if (b.v !== DOCUMENT_REVISIONS_VERSION) reason = 'unsupported revision version';
      else if (!normalizeDocumentIdentifier(b.documentIdentifier)) reason = 'invalid document identifier';
      else if (b.revision !== parent.revision + 1) reason = 'revision number does not follow its parent';
      else if ((b.previousDocumentIdentifier || null) !== parent.documentIdentifier) {
        reason = 'previousDocumentIdentifier does not match the parent revision';
      }
      if (reason) {
        invalid.push({ id: p.id, reason });
        continue;
      }
      accepted.set(p.id, { revision: b.revision, documentIdentifier: b.documentIdentifier, parsed: p });
    }
    pending = waiting;
  }
  for (const p of pending) invalid.push({ id: p.id, reason: 'parent frame missing' });

  const valid = [...accepted.values()].filter((row) => row.revision > 0).map((row) => row.parsed);
  let head = null;
  for (const p of valid) {
    if (!head || p.body.revision > head.body.revision ||
      (p.body.revision === head.body.revision && p.id < head.id)) head = p;
  }
  const mainline = [];
  const onMainline = new Set();
  let cursor = head;
  while (cursor) {
    mainline.unshift(revisionView(cursor));
    onMainline.add(cursor.id);
    const parent = accepted.get(cursor.parent);
    cursor = parent && parent.revision > 0 ? parent.parsed : null;
  }
  const forks = valid
    .filter((p) => !onMainline.has(p.id))
    .sort((a, b) => (a.body.revision - b.body.revision) || byId(a, b))
    .map(revisionView);
  const ordered = [publish].concat(
    valid.slice().sort((a, b) => (a.body.revision - b.body.revision) || byId(a, b))
  );
  return {
    ok: true,
    contractId,
    definition: publish.definition,
    editors,
    publish: { frameId: publish.id, hash: publish.hash, author: publish.author },
    head: mainline.length ? mainline[mainline.length - 1] : null,
    revisions: mainline,
    forks,
    invalid,
    frames: ordered.map((p) => ({ id: p.id, hash: p.hash, hex: p.hex, parent: p.parent, author: p.author }))
  };
}

/**
 * Provenance of one version: the publish frame and every revision from 1 to
 * that version (never later edits), as a `FabricMessageCollection`.
 * @param {*} frames Frames of the contract.
 * @param {string} documentIdentifier Version to prove.
 * @param {Object} [opts]
 * @param {string} [opts.contractId]
 * @returns {object|null} `{ type: 'DocumentProvenance', v, contractId, documentIdentifier, revision, collection }`, or null when the version is not in the contract.
 */
function documentProvenance (frames, documentIdentifier, opts = {}) {
  const target = normalizeDocumentIdentifier(documentIdentifier);
  if (!target) return null;
  const fold = foldDocumentRevisions(frames, opts);
  if (!fold.ok) return null;
  // A rename keeps the content id, so one id may name several revisions: take
  // the latest on the head's chain, else the earliest fork.
  const onChain = fold.revisions.filter((r) => r.documentIdentifier === target);
  const offChain = fold.forks.filter((r) => r.documentIdentifier === target);
  const chosen = onChain.length ? onChain[onChain.length - 1] : offChain[0];
  if (!chosen) return null;
  const byFrame = new Map(fold.frames.map((f) => [f.id, f]));
  const chain = [];
  let cur = byFrame.get(chosen.frameId);
  while (cur) {
    chain.unshift(cur);
    if (cur.id === fold.publish.frameId) break;
    cur = byFrame.get(cur.parent);
  }
  const collection = collections().createCollection();
  for (const frame of chain) collections().ingest(collection, frame.hex);
  return {
    type: DOCUMENT_PROVENANCE_TYPE,
    v: DOCUMENT_REVISIONS_VERSION,
    contractId: fold.contractId,
    documentIdentifier: target,
    revision: chosen.revision,
    collection: collections().toJSON(collection)
  };
}

/**
 * Check a provenance offline: one unbroken chain of editor-signed frames from
 * the publish to the claimed version, with nothing invalid or forked.
 * @param {*} provenance From {@link documentProvenance} (or its collection / frames).
 * @param {Object} [expect]
 * @param {string} [expect.documentIdentifier]
 * @param {string} [expect.contractId]
 * @param {string} [expect.sha256] Content digest the last revision must commit to (its `sha256`, or a 64-hex identifier when it has none); refused when it doesn't, and an empty string is refused as malformed.
 * @returns {{ ok: boolean, reason?: string, contractId?: string, documentIdentifier?: string, revision?: number, definition?: object, revisions?: object[] }}
 */
function verifyDocumentProvenance (provenance, expect = {}) {
  const fold = foldDocumentRevisions(provenance, { contractId: expect.contractId });
  if (!fold.ok) return { ok: false, reason: fold.reason || 'no document contract' };
  if (fold.invalid.length) return { ok: false, reason: `invalid frame: ${fold.invalid[0].reason}` };
  if (fold.forks.length) return { ok: false, reason: 'provenance holds more than one chain' };
  if (!fold.head) return { ok: false, reason: 'provenance has no revision' };
  const head = fold.head;
  if (provenance && provenance.type === DOCUMENT_PROVENANCE_TYPE) {
    if (provenance.contractId && provenance.contractId !== fold.contractId) {
      return { ok: false, reason: 'contract id does not match the frames' };
    }
    if (provenance.documentIdentifier && provenance.documentIdentifier !== head.documentIdentifier) {
      return { ok: false, reason: 'documentIdentifier does not match the last revision' };
    }
    if (provenance.revision != null && Number(provenance.revision) !== head.revision) {
      return { ok: false, reason: 'revision does not match the last revision' };
    }
  }
  const expected = normalizeDocumentIdentifier(expect.documentIdentifier);
  if (expect.documentIdentifier != null && expected !== head.documentIdentifier) {
    return { ok: false, reason: 'provenance is for another document' };
  }
  if (expect.sha256 != null) {
    const sha = hex64(expect.sha256);
    if (!sha) return { ok: false, reason: 'expected sha256 is not a 64-hex digest' };
    // A revision commits to content through `sha256`, or, without one, through an identifier that is that digest.
    const signed = Object.prototype.hasOwnProperty.call(head, 'sha256');
    // A one-element array stringifies to its digest, so only a string counts.
    const committed = signed
      ? (typeof head.sha256 === 'string' ? hex64(head.sha256) : null)
      : hex64(head.documentIdentifier);
    if (signed && !committed) return { ok: false, reason: 'revision sha256 is not a 64-hex digest' };
    if (!committed) return { ok: false, reason: 'revision does not commit to a sha256' };
    if (sha !== committed) return { ok: false, reason: 'sha256 does not match the revision' };
  }
  return {
    ok: true,
    contractId: fold.contractId,
    documentIdentifier: head.documentIdentifier,
    revision: head.revision,
    definition: fold.definition,
    revisions: fold.revisions
  };
}
  return {
    DOCUMENT_CONTRACT_TYPE,
    DOCUMENT_REVISION_TYPE,
    DOCUMENT_PROVENANCE_TYPE,
    DOCUMENT_REVISIONS_VERSION,
    MAX_EDITORS,
    normalizeDocumentIdentifier,
    buildDocumentContractGenesis,
    documentContractId,
    isDocumentContractDefinition,
    documentContractEditors,
    buildDocumentContractPublishMessage,
    buildDocumentRevisionBody,
    buildDocumentRevisionMessage,
    parseDocumentContractFrame,
    foldDocumentRevisions,
    documentProvenance,
    verifyDocumentProvenance
  };
})();
Document.DOCUMENT_CONTRACT_TYPE = document_revisions.DOCUMENT_CONTRACT_TYPE;
Document.DOCUMENT_REVISION_TYPE = document_revisions.DOCUMENT_REVISION_TYPE;
Document.DOCUMENT_PROVENANCE_TYPE = document_revisions.DOCUMENT_PROVENANCE_TYPE;
Document.DOCUMENT_REVISIONS_VERSION = document_revisions.DOCUMENT_REVISIONS_VERSION;
Document.MAX_EDITORS = document_revisions.MAX_EDITORS;
Document.normalizeDocumentIdentifier = document_revisions.normalizeDocumentIdentifier;
Document.buildDocumentContractGenesis = document_revisions.buildDocumentContractGenesis;
Document.documentContractId = document_revisions.documentContractId;
Document.isDocumentContractDefinition = document_revisions.isDocumentContractDefinition;
Document.documentContractEditors = document_revisions.documentContractEditors;
Document.buildDocumentContractPublishMessage = document_revisions.buildDocumentContractPublishMessage;
Document.buildDocumentRevisionBody = document_revisions.buildDocumentRevisionBody;
Document.buildDocumentRevisionMessage = document_revisions.buildDocumentRevisionMessage;
Document.parseDocumentContractFrame = document_revisions.parseDocumentContractFrame;
Document.foldDocumentRevisions = document_revisions.foldDocumentRevisions;
Document.documentProvenance = document_revisions.documentProvenance;
Document.verifyDocumentProvenance = document_revisions.verifyDocumentProvenance;
