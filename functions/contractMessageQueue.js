'use strict';

/**
 * Opaque Application Resource Contract message queue.
 *
 * Hubs (and other relays) store signed AMP `CONTRACT_MESSAGE` bytes by
 * `contractId` without opening sealed content. Participants later pull or
 * receive the same frames and fold them via {@link ./contractMessageAccumulate}
 * with `origin: 'queue'`.
 *
 * Identity is the AMP message hash (same as accumulate). Delivery tracking is a
 * sidecar per peer key — it does not alter message bytes.
 *
 * @module functions/contractMessageQueue
 */

const crypto = require('crypto');
const Message = require('../types/message');
const {
  normalizeContractId,
  bufferFromPaste,
  messageHashHex,
  authorXOnlyHex,
  parseContractMessageBody,
  verifyMessageSignature,
  createMemoryStore
} = require('./contractMessageAccumulate');

const COLLECTION = 'contractmessagequeue';
const DEFAULT_MAX_ENTRIES = 512;
const ABSOLUTE_MAX_ENTRIES = 10000;

function clampMaxEntries (value, fallback = DEFAULT_MAX_ENTRIES) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), ABSOLUTE_MAX_ENTRIES);
}

/**
 * @param {{ get: Function, put: Function }} store
 * @param {string} contractId
 * @returns {object}
 */
function loadQueueDoc (store, contractId) {
  if (!store || typeof store.get !== 'function' || typeof store.put !== 'function') {
    throw new TypeError('contractMessageQueue requires a Store (get/put)');
  }
  const id = normalizeContractId(contractId);
  const existing = store.get(COLLECTION, id);
  if (existing && typeof existing === 'object') {
    return {
      id,
      maxEntries: clampMaxEntries(existing.maxEntries, DEFAULT_MAX_ENTRIES),
      entries: Array.isArray(existing.entries) ? existing.entries.slice() : []
    };
  }
  return { id, maxEntries: DEFAULT_MAX_ENTRIES, entries: [] };
}

/**
 * @param {{ get: Function, put: Function }} store
 * @param {object} doc
 * @returns {object}
 */
function persistQueueDoc (store, doc) {
  store.put(COLLECTION, doc.id, {
    id: doc.id,
    maxEntries: doc.maxEntries,
    entries: doc.entries
  });
  return doc;
}

/**
 * Trim oldest entries when over max. Prefer dropping already-delivered rows.
 * @param {object} doc
 * @returns {object}
 */
function trimQueueDoc (doc) {
  const max = clampMaxEntries(doc.maxEntries, DEFAULT_MAX_ENTRIES);
  doc.maxEntries = max;
  while (doc.entries.length > max) {
    let dropIdx = doc.entries.findIndex((e) => {
      const d = e && e.deliveredTo;
      return d && typeof d === 'object' && Object.keys(d).length > 0;
    });
    if (dropIdx < 0) dropIdx = 0;
    doc.entries.splice(dropIdx, 1);
  }
  return doc;
}

/**
 * Enqueue opaque signed Message bytes for a contract namespace.
 * @param {{ get: Function, put: Function }} store
 * @param {string} contractId
 * @param {Buffer|string} bufferOrPaste
 * @param {{ origin?: string, maxEntries?: number, type?: string, author?: string }} [meta]
 * @returns {{ accepted: boolean, duplicate: boolean, entry: object|null, error?: string }}
 */
function enqueueMessageBuffer (store, contractId, bufferOrPaste, meta = {}) {
  let id;
  try {
    id = normalizeContractId(contractId);
  } catch (e) {
    return { accepted: false, duplicate: false, entry: null, error: e.message || 'invalid contractId' };
  }

  let buffer;
  try {
    buffer = Buffer.isBuffer(bufferOrPaste)
      ? bufferOrPaste
      : bufferFromPaste(bufferOrPaste);
  } catch (e) {
    return { accepted: false, duplicate: false, entry: null, error: e.message || 'invalid buffer' };
  }

  let msg;
  try {
    msg = Message.fromBuffer(buffer);
  } catch (e) {
    return { accepted: false, duplicate: false, entry: null, error: e.message || 'parse failed' };
  }

  if (!verifyMessageSignature(msg)) {
    return { accepted: false, duplicate: false, entry: null, error: 'invalid signature' };
  }

  const hash = messageHashHex(msg);
  if (!hash) {
    return { accepted: false, duplicate: false, entry: null, error: 'missing message hash' };
  }

  const body = parseContractMessageBody(msg);
  if (!body || !body.contract) {
    return { accepted: false, duplicate: false, entry: null, error: 'not a CONTRACT_MESSAGE body' };
  }
  if (body.contract !== id) {
    return { accepted: false, duplicate: false, entry: null, error: 'contract id mismatch' };
  }

  const doc = loadQueueDoc(store, id);
  if (meta.maxEntries != null) {
    doc.maxEntries = clampMaxEntries(meta.maxEntries, doc.maxEntries);
  }
  if (doc.entries.some((e) => e && e.hash === hash)) {
    return { accepted: false, duplicate: true, entry: null };
  }

  const entry = {
    hash,
    hex: buffer.toString('hex'),
    type: (body && body.type) || (meta.type != null ? String(meta.type) : null),
    author: authorXOnlyHex(msg) || (meta.author != null ? String(meta.author) : null),
    origin: meta.origin != null ? String(meta.origin) : 'mesh',
    enqueuedAt: meta.enqueuedAt || new Date().toISOString(),
    deliveredTo: {}
  };
  doc.entries.push(entry);
  trimQueueDoc(doc);
  persistQueueDoc(store, doc);
  return { accepted: true, duplicate: false, entry };
}

/**
 * @param {{ get: Function, put: Function }} store
 * @param {string} contractId
 * @param {{ limit?: number, includeDelivered?: boolean, peerKey?: string }} [opts]
 * @returns {object[]}
 */
function listQueuedMessages (store, contractId, opts = {}) {
  const doc = loadQueueDoc(store, contractId);
  const peerKey = opts.peerKey != null ? String(opts.peerKey).toLowerCase() : null;
  let rows = doc.entries.slice();
  if (peerKey && opts.includeDelivered !== true) {
    rows = rows.filter((e) => !(e.deliveredTo && e.deliveredTo[peerKey]));
  }
  const limit = Number(opts.limit);
  if (limit > 0 && rows.length > limit) rows = rows.slice(-limit);
  return rows;
}

/**
 * Frames still awaiting delivery to `peerKey` (or all undelivered if omitted).
 * @param {{ get: Function, put: Function }} store
 * @param {string} contractId
 * @param {string} [peerKey]
 * @returns {object[]}
 */
function pendingForDelivery (store, contractId, peerKey) {
  return listQueuedMessages(store, contractId, {
    peerKey: peerKey || undefined,
    includeDelivered: peerKey ? false : true
  }).filter((e) => {
    if (!peerKey) {
      const d = e.deliveredTo;
      return !d || typeof d !== 'object' || Object.keys(d).length === 0;
    }
    return !(e.deliveredTo && e.deliveredTo[String(peerKey).toLowerCase()]);
  });
}

/**
 * Mark a queued frame delivered to a peer (sidecar only).
 * @param {{ get: Function, put: Function }} store
 * @param {string} contractId
 * @param {string} hash
 * @param {string} peerKey
 * @param {string} [at]
 * @returns {{ ok: boolean, entry: object|null }}
 */
function markDelivered (store, contractId, hash, peerKey, at) {
  const id = normalizeContractId(contractId);
  const h = String(hash || '').trim().toLowerCase();
  const peer = String(peerKey || '').trim().toLowerCase();
  if (!h || !peer) return { ok: false, entry: null };
  const doc = loadQueueDoc(store, id);
  const entry = doc.entries.find((e) => e && e.hash === h);
  if (!entry) return { ok: false, entry: null };
  if (!entry.deliveredTo || typeof entry.deliveredTo !== 'object') entry.deliveredTo = {};
  if (!entry.deliveredTo[peer]) {
    entry.deliveredTo[peer] = at || new Date().toISOString();
    persistQueueDoc(store, doc);
  }
  return { ok: true, entry };
}

/**
 * Opaque hex list suitable for accumulate ingest (`origin: 'queue'`).
 * @param {object[]} entries
 * @returns {string[]}
 */
function entryHexList (entries) {
  return (Array.isArray(entries) ? entries : [])
    .map((e) => e && e.hex)
    .filter((h) => typeof h === 'string' && /^[0-9a-f]+$/i.test(h));
}

/**
 * SHA-256 of buffer when Message parse is unavailable (diagnostics only).
 * Prefer {@link messageHashHex} on a parsed Message for queue identity.
 * @param {Buffer} buffer
 * @returns {string}
 */
function fallbackContentHash (buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

module.exports = {
  COLLECTION,
  DEFAULT_MAX_ENTRIES,
  ABSOLUTE_MAX_ENTRIES,
  clampMaxEntries,
  loadQueueDoc,
  persistQueueDoc,
  trimQueueDoc,
  enqueueMessageBuffer,
  listQueuedMessages,
  pendingForDelivery,
  markDelivered,
  entryHexList,
  fallbackContentHash,
  createMemoryStore,
  normalizeContractId,
  bufferFromPaste
};
