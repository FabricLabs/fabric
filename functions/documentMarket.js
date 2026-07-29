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

/** Ranked multi-peer document / blob sale offer book. */

const DEFAULT_WEIGHTS = Object.freeze({
  price: 45 / 100,
  latency: 25 / 100,
  peerScore: 1 / 5,
  completeness: 1 / 10
});

function offerKey (row) {
  const blob = row.blobIndex != null ? String(row.blobIndex) : 'all';
  return `${row.documentId}|${blob}|${row.sellerId || row.sellerAddress || ''}`;
}

class DocumentOfferBook {
  constructor () {
    /** @type {Map<string, object>} */
    this._offers = new Map();
  }

  /**
   * @param {object} opts
   * @param {string} opts.origin seller address / peer key
   * @param {object[]} opts.items inventory items
   * @param {number} [opts.peerScore]
   * @param {number} [opts.latencyMs]
   * @param {string} [opts.sellerId]
   */
  ingestInventoryResponse (opts = {}) {
    const origin = String(opts.origin || '').trim();
    const items = Array.isArray(opts.items) ? opts.items : [];
    const peerScore = Number(opts.peerScore);
    const latencyMs = Number(opts.latencyMs);
      const sellerId = opts.sellerId != null ? String(opts.sellerId) : origin;
    const sellerPubkey = opts.sellerPubkey != null
      ? String(opts.sellerPubkey).trim().toLowerCase()
      : null;
    const now = Date.now();
    for (const it of items) {
      if (!it || typeof it !== 'object') continue;
      const documentId = String(it.id || it.documentId || '').trim();
      if (!documentId) continue;
      const rateSats = Number(it.rateSats != null ? it.rateSats : it.purchasePriceSats) || 0;
      const contentHashHex = contentHashHexFromObject(it);
      const sealed = it.sealed === true;
      const blobs = Array.isArray(it.blobs) ? it.blobs : null;
      const indexObj = it.documentBlobIndex && typeof it.documentBlobIndex === 'object'
        ? it.documentBlobIndex
        : null;
      const merkleRootHex = it.merkleRootHex || (indexObj && indexObj.merkleRootHex) || null;
      if (blobs && blobs.length) {
        for (const b of blobs) {
          // Sealed: one doc-level SHA256(K). Unsealed: per-blob payment hash, else item hash.
          // Never bind HTLCs to raw blobHashHex (content bytes hash ≠ payment hash).
          const paymentHash = sealed
            ? (contentHashHex || contentHashHexFromObject(b))
            : (contentHashHexFromObject(b) || contentHashHex);
          const row = {
            documentId,
            blobIndex: Number(b.index),
            blobTotal: Number(b.total != null ? b.total : blobs.length),
            sellerId,
            sellerAddress: origin,
            sellerPubkey: sellerPubkey || it.sellerPubkey || null,
            rateSats: Number(b.rateSats != null ? b.rateSats : rateSats) || 0,
            contentHashHex: paymentHash,
            blobHashHex: b.blobHashHex || null,
            merkleRootHex: merkleRootHex || null,
            size: b.size != null ? Number(b.size) : (it.size != null ? Number(it.size) : null),
            mime: it.mime || null,
            htlc: b.htlc || it.htlc || null,
            peerScore: Number.isFinite(peerScore) ? peerScore : 0,
            latencyMs: Number.isFinite(latencyMs) ? latencyMs : 0,
            observedAt: now,
            completeness: 1
          };
          this._offers.set(offerKey(row), row);
        }
      } else {
        const row = {
          documentId,
          blobIndex: it.blobIndex != null ? Number(it.blobIndex) : null,
          blobTotal: it.blobTotal != null ? Number(it.blobTotal) : null,
          sellerId,
          sellerAddress: origin,
          sellerPubkey: sellerPubkey || it.sellerPubkey || null,
          rateSats,
          contentHashHex,
          blobHashHex: it.blobHashHex || null,
          merkleRootHex: merkleRootHex || null,
          size: it.size != null ? Number(it.size) : null,
          mime: it.mime || null,
          htlc: it.htlc || null,
          peerScore: Number.isFinite(peerScore) ? peerScore : 0,
          latencyMs: Number.isFinite(latencyMs) ? latencyMs : 0,
          observedAt: now,
          completeness: it.completeness != null ? Number(it.completeness) : 1
        };
        this._offers.set(offerKey(row), row);
      }
    }
  }

  listOffers ({ documentId, blobIndex } = {}) {
    const out = [];
    for (const row of this._offers.values()) {
      if (documentId && row.documentId !== documentId) continue;
      if (blobIndex != null && row.blobIndex !== Number(blobIndex)) continue;
      out.push(Object.assign({}, row));
    }
    return out;
  }

  /**
   * @param {object[]} offers
   * @param {object} [weights]
   * @returns {object[]}
   */
  rankOffers (offers, weights = DEFAULT_WEIGHTS) {
    const list = Array.isArray(offers) ? offers.slice() : [];
    if (!list.length) return list;
    const w = Object.assign({}, DEFAULT_WEIGHTS, weights || {});
    const prices = list.map((o) => Number(o.rateSats) || 0);
    const lats = list.map((o) => Number(o.latencyMs) || 0);
    const scores = list.map((o) => Number(o.peerScore) || 0);
    const comps = list.map((o) => {
      const c = Number(o.completeness);
      return Number.isFinite(c) ? Math.min(1, Math.max(0, c)) : 1;
    });
    const minP = Math.min(...prices);
    const maxP = Math.max(...prices);
    const minL = Math.min(...lats);
    const maxL = Math.max(...lats);
    const minS = Math.min(...scores);
    const maxS = Math.max(...scores);
    const normLowBetter = (v, min, max) => (max <= min ? 1 : 1 - ((v - min) / (max - min)));
    const normHighBetter = (v, min, max) => (max <= min ? 1 : (v - min) / (max - min));

    return list.map((o, i) => {
      const priceN = normLowBetter(prices[i], minP, maxP);
      const latN = normLowBetter(lats[i], minL, maxL);
      const scoreN = normHighBetter(scores[i], minS, maxS);
      const compN = comps[i];
      const rankScore = (w.price * priceN) + (w.latency * latN) + (w.peerScore * scoreN) + (w.completeness * compN);
      return Object.assign({}, o, { rankScore });
    }).sort((a, b) => b.rankScore - a.rankScore);
  }

  pickBest (documentId, opts = {}) {
    let offers = this.listOffers({ documentId, blobIndex: opts.blobIndex });
    if (opts.maxSats != null && Number.isFinite(Number(opts.maxSats))) {
      const max = Number(opts.maxSats);
      offers = offers.filter((o) => (Number(o.rateSats) || 0) <= max);
    }
    if (Array.isArray(opts.excludeSellers) && opts.excludeSellers.length) {
      const ex = new Set(opts.excludeSellers.map(String));
      offers = offers.filter((o) => !ex.has(String(o.sellerId)) && !ex.has(String(o.sellerAddress)));
    }
    const ranked = this.rankOffers(offers, opts.weights);
    return ranked[0] || null;
  }

  /**
   * Prefer diversity across sellers when rank scores within 10%.
   * @param {string} documentId
   * @param {number} blobTotal
   * @returns {Map<number, object>}
   */
  pickBlobPlan (documentId, blobTotal) {
    const n = Math.round(Number(blobTotal));
    const plan = new Map();
    if (!Number.isFinite(n) || n < 1) return plan;
    const used = [];
    for (let i = 0; i < n; i++) {
      let offers = this.listOffers({ documentId, blobIndex: i });
      if (!offers.length) {
        offers = this.listOffers({ documentId }).filter((o) => o.blobIndex == null);
      }
      const ranked = this.rankOffers(offers);
      if (!ranked.length) continue;
      const top = ranked[0];
      let pick = top;
      if (used.length && ranked.length > 1) {
        const band = top.rankScore * 0.9;
        const diverse = ranked.find((o) => {
          return o.rankScore >= band && !used.includes(String(o.sellerId || o.sellerAddress));
        });
        if (diverse) pick = diverse;
      }
      plan.set(i, pick);
      used.push(String(pick.sellerId || pick.sellerAddress));
    }
    return plan;
  }
}

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
  DocumentOfferBook,
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
