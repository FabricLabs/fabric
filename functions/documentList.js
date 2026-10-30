'use strict';

/**
 * @fileoverview Compact document catalogs shared as `DocumentList` contract
 * messages. Rows carry metadata only (no bytes, blob indexes, or content).
 * A list that does not fit one AMP body is split. Folding is by document id
 * and does not depend on arrival order: the newest `observedAt` wins, and an
 * equal time keeps the higher frame hash. A winning row with `removed: true`
 * drops the id.
 *
 * @module functions/documentList
 */

const { MAX_DOCUMENT_ID_LENGTH, MAX_MESSAGE_SIZE } = require('../constants');
const Message = require('../types/message');
const { CONTRACT_BODY_TYPES } = require('./applicationNamespaces');

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
function observedAtOf (value) {
  if (value) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
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
    observedAt: observedAtOf(opts.observedAt),
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
    chunks[0].truncated = false;
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
  return next.hash > prev.hash;
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
    const observedAt = observedAtOf(parts.list.observedAt);
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

module.exports = {
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
