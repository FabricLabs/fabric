'use strict';

/**
 * Split / reassemble document blobs under AMP size limits.
 *
 * Every document is advertised as a **DocumentBlobIndex**:
 * - Small files → one content blob listed in `blobs[]`
 * - Large files → many content blobs listed in `blobs[]`
 *
 * Merkle commitment uses Fabric {@link Tree} over per-blob SHA-256 leaves so
 * roots can be accumulated (`Tree#addLeaf`) for any total size. When the full
 * leaf list will not fit in one AMP body, the index carries only the Tree root
 * (`leavesInline: false`); leaves are still recoverable from verified blobs.
 */

const crypto = require('crypto');
const { MAX_MESSAGE_SIZE } = require('../constants');
const Tree = require('../types/tree');

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

const INCOMPLETE_TRANSFER_TTL_MS = 10 * 60 * 1000;

const BLOB_INDEX_TYPE = 'DocumentBlobIndex';
const BLOB_INDEX_SCHEMA_VERSION = 2;
const BLOB_MERKLE_ALGO = 'Tree';

/**
 * @param {string} hex
 * @returns {Buffer}
 */
function _hashLeafBuffer (hex) {
  const h = String(hex || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(h)) {
    throw new Error('blob leaf must be 64 hex chars');
  }
  return Buffer.from(h, 'hex');
}

/**
 * Build a Fabric Tree whose leaves are raw 32-byte blob hashes.
 * @param {string[]} blobHashHexes
 * @returns {import('../types/tree')}
 */
function createBlobMerkleTree (blobHashHexes = []) {
  const leaves = (Array.isArray(blobHashHexes) ? blobHashHexes : [])
    .map((h) => _hashLeafBuffer(h));
  return new Tree({ leaves });
}

/**
 * @param {string[]} blobHashHexes
 * @returns {string} 64 hex chars (Tree root); empty-input → SHA256(empty)
 */
function merkleRootHexFromBlobHashes (blobHashHexes = []) {
  const list = Array.isArray(blobHashHexes) ? blobHashHexes : [];
  if (!list.length) {
    return crypto.createHash('sha256').update(Buffer.alloc(0)).digest('hex');
  }
  const tree = createBlobMerkleTree(list);
  const hex = tree.rootHex;
  if (!hex) {
    return crypto.createHash('sha256').update(Buffer.alloc(0)).digest('hex');
  }
  return hex;
}

/**
 * Accumulate one verified blob hash into a Tree (any document size).
 * @param {import('../types/tree')|null} tree
 * @param {string} blobHashHex
 * @returns {import('../types/tree')}
 */
function accumulateBlobLeaf (tree, blobHashHex) {
  const t = tree instanceof Tree ? tree : new Tree({ leaves: [] });
  t.addLeaf(_hashLeafBuffer(blobHashHex));
  return t;
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
 * Split content into wire-sized blobs and commit them with a Tree merkle root.
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
 *   index: object,
 *   tree: import('../types/tree')
 * }}
 */
function splitBlobs (buffer, chunkBytes = DEFAULT_BLOB_CHUNK_BYTES, documentId = undefined) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer == null ? '' : buffer);
  const size = normalizeChunkBytes(chunkBytes);
  const total = Math.max(1, Math.ceil(buf.length / size) || 1);
  const blobs = [];
  const blobHashHexes = [];
  const tree = new Tree({ leaves: [] });

  for (let index = 0; index < total; index++) {
    const start = index * size;
    const bytes = buf.length === 0 && index === 0
      ? Buffer.alloc(0)
      : buf.subarray(start, Math.min(buf.length, start + size));
    const blobHashHex = crypto.createHash('sha256').update(bytes).digest('hex');
    blobHashHexes.push(blobHashHex);
    tree.addLeaf(_hashLeafBuffer(blobHashHex));
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
    tree,
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
    schemaVersion: BLOB_INDEX_SCHEMA_VERSION,
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
 * Verify an index's Tree root against listed (or supplied) blob hashes.
 * @param {object} index
 * @param {string[]} [blobHashHexes] override leaves when `leavesInline` is false
 * @returns {{ ok: boolean, error?: string, merkleRootHex?: string }}
 */
function verifyBlobIndex (index, blobHashHexes = null) {
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
  const got = merkleRootHexFromBlobHashes(leaves);
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
  const tag = Buffer.from('Fabric/DocumentBlob/v1', 'utf8');
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
 * @returns {{ ok: boolean, buffer?: Buffer, error?: string, merkleRootHex?: string }}
 */
function reassemble (blobsByIndex, total, merkleRootHex = null) {
  const n = Math.round(Number(total));
  if (!Number.isFinite(n) || n < 1) return { ok: false, error: 'invalid total' };
  const parts = [];
  const hashes = [];
  for (let i = 0; i < n; i++) {
    const b = blobsByIndex instanceof Map ? blobsByIndex.get(i) : blobsByIndex[i];
    if (b == null) return { ok: false, error: `missing blob ${i}` };
    const buf = Buffer.isBuffer(b) ? b : Buffer.from(b);
    parts.push(buf);
    hashes.push(crypto.createHash('sha256').update(buf).digest('hex'));
  }
  const buffer = Buffer.concat(parts);
  const gotRoot = merkleRootHexFromBlobHashes(hashes);
  if (merkleRootHex) {
    const want = String(merkleRootHex).toLowerCase();
    if (gotRoot !== want) {
      const full = crypto.createHash('sha256').update(buffer).digest('hex');
      if (full !== want) {
        return { ok: false, error: 'merkle/root mismatch', merkleRootHex: gotRoot };
      }
    }
  }
  return { ok: true, buffer, merkleRootHex: gotRoot };
}

module.exports = {
  BLOB_INDEX_TYPE,
  BLOB_INDEX_SCHEMA_VERSION,
  BLOB_MERKLE_ALGO,
  DEFAULT_BLOB_CHUNK_BYTES,
  DEFAULT_CHUNK_BYTES,
  LEGACY_HUB_CHUNK_BYTES,
  FILE_SEND_JSON_OVERHEAD,
  INCOMPLETE_TRANSFER_TTL_MS,
  MAX_MESSAGE_SIZE,
  createBlobMerkleTree,
  merkleRootHexFromBlobHashes,
  accumulateBlobLeaf,
  normalizeChunkBytes,
  splitBlobs,
  buildBlobIndex,
  compactBlobIndexForWire,
  advertiseDocumentBlobs,
  verifyBlobIndex,
  blobPaymentHashHex,
  verifyBlob,
  reassemble
};
