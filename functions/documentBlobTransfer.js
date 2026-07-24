'use strict';

/**
 * Buyer-side DocumentBlobIndex transfer book: verify each blob, accumulate
 * Tree leaves, reassemble only when the merkle root matches.
 */

const crypto = require('crypto');
const {
  INCOMPLETE_TRANSFER_TTL_MS,
  verifyBlob,
  reassemble,
  merkleRootHexFromBlobHashes
} = require('./documentBlobManifest');

/**
 * @param {object} obj P2P_FILE_SEND JSON object
 * @returns {{ ok: boolean, error?: string, legacy?: boolean, documentId?: string, bytes?: Buffer, blobIndex?: number, blobTotal?: number, blobHashHex?: string, merkleRootHex?: string, contentSha256?: string }}
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
      legacy: true,
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
    legacy: false,
    documentId,
    bytes,
    blobIndex,
    blobTotal,
    blobHashHex,
    merkleRootHex,
    contentSha256: obj.contentSha256 != null
      ? String(obj.contentSha256).trim().toLowerCase()
      : null,
    chunkBytes: obj.chunkBytes != null ? Number(obj.chunkBytes) : null
  };
}

function transferKey (documentId, merkleRootHex) {
  return `${documentId}|${merkleRootHex || 'legacy'}`;
}

class DocumentBlobTransferBook {
  /**
   * @param {{ ttlMs?: number }} [opts]
   */
  constructor (opts = {}) {
    /** @type {Map<string, object>} */
    this._pending = new Map();
    this.ttlMs = opts.ttlMs != null ? Number(opts.ttlMs) : INCOMPLETE_TRANSFER_TTL_MS;
  }

  /**
   * Pre-register expected leaves (from inventory DocumentBlobIndex).
   * @param {object} opts
   */
  expectTransfer (opts = {}) {
    const documentId = String(opts.documentId || '').trim();
    if (!documentId) return null;
    const merkleRootHex = opts.merkleRootHex
      ? String(opts.merkleRootHex).toLowerCase()
      : null;
    const total = Math.round(Number(opts.total || opts.blobTotal || 0));
    const key = transferKey(documentId, merkleRootHex);
    const row = {
      key,
      documentId,
      merkleRootHex,
      total: Number.isFinite(total) && total > 0 ? total : null,
      expectedHashes: Array.isArray(opts.blobHashHexes)
        ? opts.blobHashHexes.map((h) => String(h).toLowerCase())
        : null,
      contentSha256: opts.contentSha256
        ? String(opts.contentSha256).toLowerCase()
        : null,
      parts: new Map(),
      created: Date.now(),
      updated: Date.now()
    };
    this._pending.set(key, row);
    return row;
  }

  _purgeExpired () {
    const now = Date.now();
    for (const [k, row] of this._pending.entries()) {
      if (now - (row.updated || row.created) > this.ttlMs) {
        this._pending.delete(k);
      }
    }
  }

  /**
   * @param {object} frame from {@link parseFileSendObject}
   * @returns {{ status: 'reject'|'need_more'|'complete', error?: string, documentId?: string, buffer?: Buffer, merkleRootHex?: string, verified?: boolean, legacy?: boolean, blobIndex?: number, received?: number, total?: number }}
   */
  ingest (frame) {
    this._purgeExpired();
    if (!frame || !frame.ok) {
      return { status: 'reject', error: (frame && frame.error) || 'bad frame' };
    }

    // Legacy whole-body frame: accept as a single verified document (compat).
    if (frame.legacy) {
      return {
        status: 'complete',
        documentId: frame.documentId,
        buffer: frame.bytes,
        merkleRootHex: merkleRootHexFromBlobHashes([frame.blobHashHex]),
        verified: true,
        legacy: true,
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

    const key = transferKey(frame.documentId, frame.merkleRootHex);
    let row = this._pending.get(key);
    if (!row) {
      row = {
        key,
        documentId: frame.documentId,
        merkleRootHex: frame.merkleRootHex,
        total: frame.blobTotal,
        expectedHashes: null,
        contentSha256: frame.contentSha256,
        parts: new Map(),
        created: Date.now(),
        updated: Date.now()
      };
      this._pending.set(key, row);
    }
    row.updated = Date.now();
    if (row.total == null) row.total = frame.blobTotal;
    if (row.total !== frame.blobTotal) {
      return {
        status: 'reject',
        error: 'blobTotal mismatch',
        documentId: frame.documentId
      };
    }
    if (row.merkleRootHex && frame.merkleRootHex && row.merkleRootHex !== frame.merkleRootHex) {
      return {
        status: 'reject',
        error: 'merkleRootHex mismatch',
        documentId: frame.documentId
      };
    }
    if (!row.merkleRootHex && frame.merkleRootHex) {
      row.merkleRootHex = frame.merkleRootHex;
    }

    if (row.expectedHashes && row.expectedHashes[frame.blobIndex] &&
        row.expectedHashes[frame.blobIndex] !== frame.blobHashHex) {
      return {
        status: 'reject',
        error: 'blob hash not in advertised index',
        documentId: frame.documentId,
        blobIndex: frame.blobIndex
      };
    }

    row.parts.set(frame.blobIndex, frame.bytes);

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

    const assembled = reassemble(row.parts, row.total, row.merkleRootHex);
    this._pending.delete(key);
    if (!assembled.ok) {
      return {
        status: 'reject',
        error: assembled.error || 'reassemble failed',
        documentId: frame.documentId
      };
    }
    if (row.contentSha256) {
      const full = crypto.createHash('sha256').update(assembled.buffer).digest('hex');
      if (full !== row.contentSha256) {
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
      legacy: false,
      received: row.total,
      total: row.total
    };
  }

  get pendingCount () {
    return this._pending.size;
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
  parseFileSendObject,
  transferKey,
  DocumentBlobTransferBook,
  settlementDedupeKey
};
