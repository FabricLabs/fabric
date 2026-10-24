'use strict';

/**
 * Peer-safe document market helpers: ranked offer book, purchase sessions,
 * and private DocumentRequest relay fee/rewrite policy.
 *
 * Formerly split across `documentOfferBook`, `documentPurchaseSession`, and
 * `documentRequestRelay`.
 *
 * @module functions/documentMarket
 * @see docs/L1_DOCUMENT_EXCHANGE.md
 */

const crypto = require('crypto');
const inventoryHtlc = require('./inventoryHtlc');
const { settlementDedupeKey } = require('./documentBlobManifest');
const { refundLocktimeMature } = inventoryHtlc;
const {
  contentHashHexFromObject
} = require('./documentPaymentHash');

/**
 * Ranked multi-peer document / blob sale offer book — the class lives in
 * `types/book.js` (`Book`); re-exported here for `PUBLIC_API.md` compatibility.
 */
const {
  Book,
  DEFAULT_WEIGHTS,
  offerKey
} = require('../types/book');

/** Buyer/seller document purchase session records (whole-doc or per-blob). */

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

/** Privacy-preserving DocumentRequest hop rewrite + fee skim helpers. */


/**
 * @param {object} policy
 * @param {number} maxSatsIn
 * @returns {{ ok: boolean, feeSats?: number, maxSatsOut?: number, error?: string }}
 */
function computeRelayFee (policy = {}, maxSatsIn) {
  const M = Math.round(Number(maxSatsIn));
  if (!Number.isFinite(M) || M < 1) return { ok: false, error: 'maxSats must be >= 1' };
  const minRemaining = Math.max(1, Math.round(Number(policy.documentRelayMinRemainingSats != null
    ? policy.documentRelayMinRemainingSats
    : 1)));
  let fee = 0;
  if (policy.documentRelayFeeSats != null && Number.isFinite(Number(policy.documentRelayFeeSats))) {
    fee = Math.round(Number(policy.documentRelayFeeSats));
  } else if (policy.documentRelayFeeBps != null && Number.isFinite(Number(policy.documentRelayFeeBps))) {
    fee = Math.floor((M * Number(policy.documentRelayFeeBps)) / 10000);
  } else {
    fee = Math.max(1, Math.floor(M * 0.01)); // default 1%
  }
  if (fee < 0) fee = 0;
  if (fee > M - minRemaining) fee = M - minRemaining;
  const Mout = M - fee;
  if (Mout < minRemaining) return { ok: false, error: 'insufficient budget after fee' };
  return { ok: true, feeSats: fee, maxSatsOut: Mout };
}

/**
 * @param {object} inbound parsed DocumentRequest body
 * @param {object} policy
 * @returns {{ ok: boolean, body?: object, feeSats?: number, error?: string }}
 */
function buildForwardedDocumentRequest (inbound = {}, policy = {}) {
  const document = inbound.document || inbound.id;
  if (!document) return { ok: false, error: 'missing document' };
  const hopIn = inbound.relayHop != null ? Math.round(Number(inbound.relayHop)) : Number(policy.documentRelayMaxHops || 4);
  const maxHops = Math.round(Number(policy.documentRelayMaxHops != null ? policy.documentRelayMaxHops : 4));
  if (!Number.isFinite(hopIn) || hopIn <= 0) return { ok: false, error: 'relayHop exhausted' };
  if (hopIn > maxHops) return { ok: false, error: 'relayHop exceeds max' };

  const M = inbound.maxSats != null ? Number(inbound.maxSats) : null;
  if (M == null || !Number.isFinite(M)) return { ok: false, error: 'maxSats required for private relay' };

  const feeRes = computeRelayFee(policy, M);
  if (!feeRes.ok) return feeRes;

  const body = {
    document: String(document),
    maxSats: feeRes.maxSatsOut,
    relayHop: hopIn - 1,
    routeId: crypto.randomBytes(8).toString('hex')
  };
  if (inbound.blobIndex != null) body.blobIndex = Number(inbound.blobIndex);
  if (inbound.blobTotal != null) body.blobTotal = Number(inbound.blobTotal);
  if (inbound.contentHashHex || inbound.contentHash) {
    body.contentHashHex = String(inbound.contentHashHex || inbound.contentHash).toLowerCase();
  }
  return { ok: true, body, feeSats: feeRes.feeSats, maxSatsOut: feeRes.maxSatsOut };
}

/**
 * @param {number} maxSatsIn
 * @param {number} maxSatsOut
 * @returns {boolean}
 */
function assertMonotoneBudget (maxSatsIn, maxSatsOut) {
  const a = Number(maxSatsIn);
  const b = Number(maxSatsOut);
  return Number.isFinite(a) && Number.isFinite(b) && b < a && b >= 1;
}

module.exports = {
  Book,
  // Deprecated alias of `Book`.
  DocumentOfferBook: Book,
  DEFAULT_WEIGHTS,
  offerKey,
  createDocumentPurchaseSession,
  findSession,
  settlementDedupeKey,
  isDuplicateSettlement,
  rememberSettlement,
  listRefundCandidates,
  computeRelayFee,
  buildForwardedDocumentRequest,
  assertMonotoneBudget
};
