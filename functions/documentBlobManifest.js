'use strict';

/**
 * Split / reassemble document blobs under AMP size limits, plus buyer-side
 * DocumentBlobIndex transfer book (verify / accumulate / reassemble).
 *
 * Every document is advertised as a **DocumentBlobIndex**:
 * - Small files → one content blob listed in `blobs[]`
 * - Large files → many content blobs listed in `blobs[]`
 *
 * When the full leaf list will not fit in one AMP body, the index carries only
 * the root (`leavesInline: false`); leaves are still recoverable from verified
 * blobs.
 *
 * **Document tree** (every document): domain-separated SHA-256 tree.
 * `leaf_i = H(0x00 || blobHash_i || paymentHash_i || iv_i)` (32 + 32 + 12
 * bytes; zeros when unsealed), `node = H(0x01 || left || right)`, an odd last
 * node is promoted unchanged, and the published root is
 * `H(0x02 || uint32be(blobTotal) || treeRoot)`. The root therefore commits the
 * blob count (no CVE-2012-2459 twins), every blob's payment hash `SHA256(K_i)`
 * (the AES key commitment that closes AES-GCM's non-key-committing gap), and
 * its IV.
 */

const crypto = require('crypto');
const { MAX_MESSAGE_SIZE, MAX_DOCUMENT_BLOBS } = require('../constants');

/** @deprecated Prefer {@link DEFAULT_BLOB_CHUNK_BYTES}; kept for Hub 1 MiB file-chunk callers. */
const LEGACY_HUB_CHUNK_BYTES = 1024 * 1024;

/**
 * Rough JSON envelope overhead for `P2P_FILE_SEND` / blob frames around a
 * base64 body (`name`, blob index fields, optional sealed/paymentHash/iv/scheme).
 */
const FILE_SEND_JSON_OVERHEAD = 640;

/**
 * Max raw content bytes per blob so base64(body) + JSON stays ≤ MAX_MESSAGE_SIZE.
 * floor((MAX_MESSAGE_SIZE - overhead) * 3/4)
 */
const DEFAULT_BLOB_CHUNK_BYTES = Math.max(
  256,
  Math.floor((MAX_MESSAGE_SIZE - FILE_SEND_JSON_OVERHEAD) * 3 / 4)
);

/** Alias used by Peer settings historically. */
const DEFAULT_CHUNK_BYTES = DEFAULT_BLOB_CHUNK_BYTES;

/**
 * Theoretical maximum document size at the default blob size:
 * `MAX_DOCUMENT_BLOBS × DEFAULT_BLOB_CHUNK_BYTES` (197,394,432 bytes ≈ 188.3 MiB).
 * Callers with a larger metadata reserve use smaller blobs and a lower ceiling.
 */
const MAX_DOCUMENT_BYTES = MAX_DOCUMENT_BLOBS * DEFAULT_BLOB_CHUNK_BYTES;

const INCOMPLETE_TRANSFER_TTL_MS = 10 * 60 * 1000;
/** Default lifetime of a purchase expectation (refreshed by matching frames). */
const EXPECTATION_TTL_MS = 60 * 60 * 1000;
/** Max concurrent unsolicited incomplete transfers in {@link DocumentBlobTransferBook}. */
const MAX_PENDING_BLOB_TRANSFERS = 64;
/** Max unsolicited incomplete transfers one origin may hold. */
const MAX_PENDING_BLOB_TRANSFERS_PER_ORIGIN = 8;
/** Byte budget across every incomplete transfer in one {@link DocumentBlobTransferBook}. */
const MAX_PENDING_BLOB_BYTES = 256 * 1024 * 1024;

const BLOB_INDEX_TYPE = 'DocumentBlobIndex';
const BLOB_MERKLE_ALGO = 'DocumentTree';

const DOCUMENT_TREE_LEAF = 0x00;
const DOCUMENT_TREE_NODE = 0x01;
const DOCUMENT_TREE_ROOT = 0x02;
const DOCUMENT_TREE_IV_BYTES = 12;

/**
 * JSON envelope reserve for a sealed per-blob frame: the inclusion proof
 * (up to log2(MAX_DOCUMENT_BLOBS) = 13 hex siblings) rides every frame.
 */
const SEALED_FRAME_JSON_OVERHEAD = 2048;
/** Max ciphertext bytes per sealed blob so frame + proof stay ≤ MAX_MESSAGE_SIZE. */
const SEALED_BLOB_CHUNK_BYTES = Math.max(
  256,
  Math.floor((MAX_MESSAGE_SIZE - SEALED_FRAME_JSON_OVERHEAD) * 3 / 4)
);

/**
 * Document root over blob hashes alone (unsealed blobs: zero payment hash
 * and IV), or with one payment hash on every leaf (a whole-document sale
 * under a single key).
 * @param {string[]} blobHashHexes in index order
 * @param {Object} [opts]
 * @param {string} [opts.paymentHashHex] payment hash committed by every leaf
 * @returns {string} 64 hex chars
 */
function merkleRootHexFromBlobHashes (blobHashHexes = [], opts = {}) {
  const list = Array.isArray(blobHashHexes) ? blobHashHexes : [];
  const paymentHashHex = opts.paymentHashHex || null;
  return documentMerkleRootHex(list.map((blobHashHex) => ({ blobHashHex, paymentHashHex })));
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
 * Compare two IVs by their decoded bytes (base64 spelling does not matter).
 * @param {*} a
 * @param {*} b
 * @returns {boolean}
 */
function sameIv (a, b) {
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
function documentLeafHex (blob = {}) {
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
 * Document root for blob leaves in index order.
 * @param {Object[]} blobs `{ blobHashHex, paymentHashHex?, iv? }` per index
 * @returns {string} 64 hex chars
 */
function documentMerkleRootHex (blobs = []) {
  const list = Array.isArray(blobs) ? blobs : [];
  if (!_validTotal(list.length)) throw new Error(`document must have 1..${MAX_DOCUMENT_BLOBS} blobs`);
  const leaves = list.map((b) => Buffer.from(documentLeafHex(b), 'hex'));
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
function documentInclusionProof (blobs = [], index = 0) {
  const list = Array.isArray(blobs) ? blobs : [];
  let idx = Math.round(Number(index));
  if (!Number.isInteger(idx) || idx < 0 || idx >= list.length) throw new Error('blob index out of range');
  const layers = _documentLayers(list.map((b) => Buffer.from(documentLeafHex(b), 'hex')));
  return _proofFromLayers(layers, idx);
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
 * Every blob's inclusion proof from one tree build.
 * @param {Object[]} blobs `{ blobHashHex, paymentHashHex?, iv? }` per index
 * @returns {string[][]}
 */
function documentInclusionProofs (blobs = []) {
  const list = Array.isArray(blobs) ? blobs : [];
  if (!_validTotal(list.length)) throw new Error(`document must have 1..${MAX_DOCUMENT_BLOBS} blobs`);
  const layers = _documentLayers(list.map((b) => Buffer.from(documentLeafHex(b), 'hex')));
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
 * @param {string[]} opts.proof from {@link documentInclusionProof}
 * @returns {boolean}
 */
function verifyDocumentInclusion (opts = {}) {
  try {
    const root = String(opts.merkleRootHex || '').trim().toLowerCase();
    const total = Number(opts.blobTotal);
    let idx = Number(opts.blobIndex);
    if (!/^[0-9a-f]{64}$/.test(root) || !_validTotal(total)) return false;
    if (!Number.isInteger(idx) || idx < 0 || idx >= total) return false;
    const proof = Array.isArray(opts.proof) ? opts.proof : [];
    let hash = Buffer.from(documentLeafHex(opts), 'hex');
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
 * @param {number} [chunkBytes]
 * @returns {number}
 */
function normalizeChunkBytes (chunkBytes) {
  const n = Math.round(Number(chunkBytes));
  if (Number.isFinite(n) && n >= 1) return n;
  return DEFAULT_BLOB_CHUNK_BYTES;
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
 *   documentId?: string,
 *   index: object
 * }}
 */
function splitBlobs (buffer, chunkBytes = DEFAULT_BLOB_CHUNK_BYTES, documentId = undefined) {
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

  const merkleRootHex = merkleRootHexFromBlobHashes(blobHashHexes);
  const contentSha256 = crypto.createHash('sha256').update(buf).digest('hex');
  const index = buildBlobIndex({
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
 * @param {Array<{ index: number, total?: number, blobHashHex: string, size?: number, rateSats?: number, contentHash?: string }>} opts.blobs
 * @param {boolean} [opts.leavesInline]
 * @returns {object}
 */
function buildBlobIndex (opts = {}) {
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
 * @param {object} index from {@link buildBlobIndex}
 * @param {number} [maxBytes=MAX_MESSAGE_SIZE]
 * @returns {object}
 */
function compactBlobIndexForWire (index, maxBytes = MAX_MESSAGE_SIZE) {
  const cap = Math.max(256, Math.round(Number(maxBytes) || MAX_MESSAGE_SIZE));
  let wire = index && typeof index === 'object' ? Object.assign({}, index) : buildBlobIndex({});
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
function advertiseDocumentBlobs (buffer, opts = {}) {
  const documentId = opts.documentId != null ? String(opts.documentId) : undefined;
  const split = splitBlobs(buffer, opts.chunkBytes, documentId);
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
      row.contentHash = blobPaymentHashHex({
        documentId,
        blobIndex: b.index,
        blobHashHex: b.blobHashHex
      });
    }
    return row;
  });
  let index = buildBlobIndex({
    documentId,
    merkleRootHex: split.merkleRootHex,
    contentSha256: split.contentSha256,
    chunkBytes: split.chunkBytes,
    blobs: itemBlobs
  });
  index = compactBlobIndexForWire(index);
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
 * @returns {{ ok: boolean, error?: string, merkleRootHex?: string }}
 */
function verifyBlobIndex (index, blobHashHexes = null, opts = {}) {
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
  const got = merkleRootHexFromBlobHashes(leaves, opts);
  if (want && got !== want) return { ok: false, error: 'merkle/root mismatch', merkleRootHex: got };
  return { ok: true, merkleRootHex: got };
}

/**
 * Per-blob payment commitment (distinct from whole-doc purchaseContentHashHex).
 * @param {{ documentId: string, blobIndex: number, blobHashHex: string }} opts
 * @returns {string} 64 hex chars
 */
function blobPaymentHashHex (opts = {}) {
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
function verifyBlob (bytes, expectedHashHex) {
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
 * @returns {{ ok: boolean, buffer?: Buffer, error?: string, merkleRootHex?: string }}
 */
function reassemble (blobsByIndex, total, merkleRootHex = null, opts = {}) {
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
    gotRoot = documentMerkleRootHex(blobs);
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


// --- Buyer-side transfer book (formerly documentBlobTransfer.js) ---


/**
 * @param {object} obj P2P_FILE_SEND JSON object
 * @returns {{ ok: boolean, error?: string, unindexed?: boolean, documentId?: string, bytes?: Buffer, blobIndex?: number, blobTotal?: number, blobHashHex?: string, merkleRootHex?: string, contentSha256?: string }}
 */
function parseFileSendObject (obj) {
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
  if (!verifyBlob(bytes, blobHashHex)) {
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
 * @param {*} v
 * @returns {string|null}
 * @private
 */
function _hex64OrNull (v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(s) ? s : null;
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
function verifyOfferLeaves (opts = {}) {
  const root = _hex64OrNull(opts.merkleRootHex);
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
    const blobHashHex = _hex64OrNull(b.blobHashHex);
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
      if (documentMerkleRootHex(indexes.map((i) => byIndex.get(i))) === root) return { ok: true, indexes };
      return { ok: false, error: 'merkle/root mismatch' };
    }
    for (const i of indexes) {
      const b = byIndex.get(i);
      if (!Array.isArray(b.proof)) return { ok: false, error: 'a partial offer needs an inclusion proof per blob', index: i };
      if (!verifyDocumentInclusion(Object.assign({}, b, { merkleRootHex: root, blobTotal: total, blobIndex: i }))) {
        return { ok: false, error: 'inclusion proof does not open to merkleRootHex', index: i };
      }
    }
    return { ok: true, indexes };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

/**
 * Verify-before-pay: check one free sealed per-blob `P2P_FILE_SEND` body
 * (ciphertext of blob `i`) against the document root **before** funding the
 * HTLC for `K_i`. The ciphertext must hash to its `blobHashHex` and the leaf
 * `(blobHash, paymentHash, iv)` must open to the root with the frame's
 * inclusion proof (or `expected.proof`). Pins from verified offer leaves
 * ({@link verifyOfferLeaves}) are enforced when given.
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
function verifySealedBlobFrame (obj, expected = {}) {
  const frame = parseFileSendObject(obj);
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
  if (expected.iv != null && expected.iv !== '' && !sameIv(expected.iv, iv)) {
    return { ok: false, error: 'iv is not the advertised leaf', blobIndex: frame.blobIndex };
  }
  const out = { ok: true, blobIndex: frame.blobIndex, blobHashHex: frame.blobHashHex, paymentHashHex, iv, bytes: frame.bytes };
  const proof = Array.isArray(obj.proof) ? obj.proof : expected.proof;
  if (!Array.isArray(proof)) return { ok: false, error: 'missing inclusion proof', blobIndex: frame.blobIndex };
  if (!verifyDocumentInclusion({ merkleRootHex: root, blobTotal: total, blobIndex: frame.blobIndex, blobHashHex: frame.blobHashHex, paymentHashHex, iv: frame.leafIv, proof })) {
    return { ok: false, error: 'inclusion proof does not open to merkleRootHex', blobIndex: frame.blobIndex };
  }
  return out;
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
 *   them. Each lives until `expiresAt` (caller-set, default
 *   {@link EXPECTATION_TTL_MS}), is refreshed by matching frames
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
    /** @type {Map<string, object>} assembly rows */
    this._pending = new Map();
    /** @type {Map<string, object>} purchase expectations */
    this._expectations = new Map();
    /** @type {Map<string, number>} unsolicited bytes per origin */
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
      if (pin && !verifyBlob(bytes, pin)) {
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
   * @param {object} frame from {@link parseFileSendObject}
   * @param {Object} [opts]
   * @param {string} [opts.origin] sending peer (per-origin quotas for unsolicited rows)
   * @returns {{ status: 'reject'|'need_more'|'complete', error?: string, documentId?: string, buffer?: Buffer, merkleRootHex?: string, verified?: boolean, unindexed?: boolean, blobIndex?: number, received?: number, total?: number }}
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
        merkleRootHex: merkleRootHexFromBlobHashes([frame.blobHashHex]),
        verified: true,
        unindexed: true,
        blobIndex: 0,
        received: 1,
        total: 1
      };
    }

    if (!verifyBlob(frame.bytes, frame.blobHashHex)) {
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

    const assembled = reassemble(row.parts, row.total, row.merkleRootHex, { leaves: row.leaves });
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

/**
 * Dedup key for paid settlements: (documentId, blobIndex|all, contentHash).
 * @param {{ documentId: string, blobIndex?: number, contentHashHex?: string }} session
 * @returns {string}
 */
function settlementDedupeKey (session = {}) {
  const doc = String(session.documentId || '');
  const blob = session.blobIndex != null ? String(session.blobIndex) : 'all';
  const hash = String(session.contentHashHex || '').toLowerCase();
  return `${doc}|${blob}|${hash}`;
}

module.exports = {
  BLOB_INDEX_TYPE,
  BLOB_MERKLE_ALGO,
  DEFAULT_BLOB_CHUNK_BYTES,
  DEFAULT_CHUNK_BYTES,
  LEGACY_HUB_CHUNK_BYTES,
  FILE_SEND_JSON_OVERHEAD,
  INCOMPLETE_TRANSFER_TTL_MS,
  EXPECTATION_TTL_MS,
  MAX_DOCUMENT_BLOBS,
  MAX_DOCUMENT_BYTES,
  MAX_PENDING_BLOB_TRANSFERS,
  MAX_PENDING_BLOB_TRANSFERS_PER_ORIGIN,
  MAX_PENDING_BLOB_BYTES,
  MAX_MESSAGE_SIZE,
  SEALED_FRAME_JSON_OVERHEAD,
  SEALED_BLOB_CHUNK_BYTES,
  merkleRootHexFromBlobHashes,
  ivBytes,
  sameIv,
  documentLeafHex,
  documentMerkleRootHex,
  documentInclusionProof,
  documentInclusionProofs,
  verifyDocumentInclusion,
  verifyOfferLeaves,
  verifySealedBlobFrame,
  normalizeChunkBytes,
  splitBlobs,
  buildBlobIndex,
  compactBlobIndexForWire,
  advertiseDocumentBlobs,
  verifyBlobIndex,
  blobPaymentHashHex,
  verifyBlob,
  reassemble,
  parseFileSendObject,
  transferKey,
  DocumentBlobTransferBook,
  settlementDedupeKey
};
