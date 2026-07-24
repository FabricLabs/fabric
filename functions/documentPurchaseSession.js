'use strict';

/**
 * Buyer/seller document purchase session records (whole-doc or per-blob).
 */

const crypto = require('crypto');
const inventoryHtlc = require('./inventoryHtlc');
const { settlementDedupeKey } = require('./documentBlobTransfer');
const { refundLocktimeMature } = inventoryHtlc;

/**
 * @param {object} opts
 * @param {string} opts.documentId
 * @param {string} opts.seller
 * @param {string} opts.contentHashHex
 * @param {number} opts.amountSats
 * @param {string} opts.paymentAddress
 * @param {string} [opts.bitcoinUri]
 * @param {string} [opts.network]
 * @param {number} [opts.blobIndex]
 * @param {number} [opts.blobTotal]
 * @param {object} [opts.htlc]
 * @returns {object}
 */
function createDocumentPurchaseSession (opts = {}) {
  const documentId = String(opts.documentId || '').trim();
  if (!documentId) throw new Error('documentId is required');
  const amountSats = Math.round(Number(opts.amountSats || 0));
  if (!Number.isFinite(amountSats) || amountSats < 0) {
    throw new Error('amountSats must be a non-negative number');
  }
  const contentHashHex = String(opts.contentHashHex || '').trim().toLowerCase();
  if (contentHashHex && !/^[0-9a-f]{64}$/.test(contentHashHex)) {
    throw new Error('contentHashHex must be 64 hex chars');
  }
  const settlementId = opts.settlementId || crypto.randomBytes(16).toString('hex');
  const paymentAddress = String(opts.paymentAddress || '').trim();
  let bitcoinUri = opts.bitcoinUri || '';
  if (!bitcoinUri && paymentAddress && amountSats > 0) {
    bitcoinUri = inventoryHtlc.buildHtlcFundingHints({
      paymentAddress,
      amountSats,
      label: documentId.slice(0, 32)
    }).bitcoinUri;
  }
  const session = {
    settlementId,
    documentId,
    seller: opts.seller != null ? String(opts.seller) : null,
    contentHashHex: contentHashHex || null,
    amountSats,
    paymentAddress: paymentAddress || null,
    bitcoinUri: bitcoinUri || null,
    network: opts.network || 'regtest',
    htlc: opts.htlc || null,
    created: Date.now(),
    status: 'open'
  };
  if (opts.blobIndex != null && Number.isFinite(Number(opts.blobIndex))) {
    session.blobIndex = Math.round(Number(opts.blobIndex));
  }
  if (opts.blobTotal != null && Number.isFinite(Number(opts.blobTotal))) {
    session.blobTotal = Math.round(Number(opts.blobTotal));
  }
  if (opts.blobHashHex) session.blobHashHex = String(opts.blobHashHex).toLowerCase();
  if (opts.merkleRootHex) session.merkleRootHex = String(opts.merkleRootHex).toLowerCase();
  session.dedupeKey = settlementDedupeKey(session);
  return session;
}

/**
 * True when this (documentId, blobIndex, contentHash) was already settled.
 * @param {Set|Map|object} paidKeys
 * @param {object} session
 * @returns {boolean}
 */
function isDuplicateSettlement (paidKeys, session) {
  if (!paidKeys || !session) return false;
  const key = session.dedupeKey || settlementDedupeKey(session);
  if (paidKeys instanceof Set) return paidKeys.has(key);
  if (paidKeys instanceof Map) return paidKeys.has(key);
  return !!paidKeys[key];
}

/**
 * @param {Set|Map|object} paidKeys
 * @param {object} session
 */
function rememberSettlement (paidKeys, session) {
  if (!paidKeys || !session) return;
  const key = session.dedupeKey || settlementDedupeKey(session);
  if (paidKeys instanceof Set) paidKeys.add(key);
  else if (paidKeys instanceof Map) paidKeys.set(key, session);
  else paidKeys[key] = session;
}

/**
 * @param {Map|object} store
 * @param {string} key settlementId or documentId
 * @returns {object|null}
 */
function findSession (store, key) {
  if (!store || key == null) return null;
  const k = String(key);
  if (store instanceof Map) {
    if (store.has(k)) return store.get(k);
    for (const row of store.values()) {
      if (row && (row.settlementId === k || row.documentId === k)) return row;
    }
    return null;
  }
  if (store[k]) return store[k];
  for (const id of Object.keys(store)) {
    const row = store[id];
    if (row && (row.settlementId === k || row.documentId === k)) return row;
  }
  return null;
}

/**
 * Classify purchase sessions for refund TUI listing.
 *
 * @param {Map|Iterable|object} store purchaseSessions
 * @param {number|null} tipHeight
 * @param {{ filter?: string }} [opts] filter: outstanding|mature|failed|pending|refunded|all
 * @returns {Array<object>}
 */
function listRefundCandidates (store, tipHeight, opts = {}) {
  const filter = String(opts.filter || 'outstanding').toLowerCase();
  const tip = tipHeight != null && Number.isFinite(Number(tipHeight)) ? Number(tipHeight) : null;
  const rows = [];
  const values = store instanceof Map
    ? store.values()
    : (Array.isArray(store) ? store : Object.values(store || {}));

  for (const session of values) {
    if (!session || typeof session !== 'object') continue;
    const htlc = session.htlc || {};
    const lock = htlc.refundLocktimeHeight != null
      ? Number(htlc.refundLocktimeHeight)
      : null;
    const hasHtlc = !!(session.paymentAddress || htlc.paymentAddress);
    const status = String(session.status || 'open');
    const mature = tip != null && Number.isFinite(lock) && refundLocktimeMature(tip, lock);
    const isComplete = status === 'complete';
    const isRefunded = status === 'refunded';
    const isFailed = status === 'fraud';

    let bucket = null;
    if (isRefunded) bucket = 'refunded';
    else if (isFailed) bucket = 'failed';
    else if (isComplete) bucket = 'complete';
    else if (hasHtlc && mature) bucket = 'mature';
    else if (hasHtlc && Number.isFinite(lock)) bucket = 'pending';
    else if (hasHtlc) bucket = 'pending';
    else continue;

    const include =
      filter === 'all' ||
      (filter === 'outstanding' && (bucket === 'mature' || bucket === 'failed' || bucket === 'pending')) ||
      (filter === 'mature' && bucket === 'mature') ||
      (filter === 'failed' && bucket === 'failed') ||
      (filter === 'pending' && bucket === 'pending') ||
      (filter === 'refunded' && bucket === 'refunded');

    if (!include) continue;

    rows.push({
      settlementId: session.settlementId,
      documentId: session.documentId,
      status,
      bucket,
      amountSats: session.amountSats,
      paymentAddress: session.paymentAddress || htlc.paymentAddress || null,
      refundLocktimeHeight: Number.isFinite(lock) ? lock : null,
      tipHeight: tip,
      mature: !!mature,
      blocksRemaining: (tip != null && Number.isFinite(lock) && tip < lock) ? (lock - tip) : 0,
      txid: session.txid || null,
      refundTxid: session.refundTxid || null,
      error: session.error || null,
      seller: session.seller || null
    });
  }

  const order = { failed: 0, mature: 1, pending: 2, refunded: 3, complete: 4 };
  rows.sort((a, b) => (order[a.bucket] - order[b.bucket]) || String(a.settlementId).localeCompare(String(b.settlementId)));
  return rows;
}

module.exports = {
  createDocumentPurchaseSession,
  findSession,
  settlementDedupeKey,
  isDuplicateSettlement,
  rememberSettlement,
  listRefundCandidates
};
