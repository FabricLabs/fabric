'use strict';

/**
 * Ranked multi-peer document / blob sale offer book.
 */

const {
  contentHashHexFromObject
} = require('./documentPaymentHash');

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

module.exports = {
  DocumentOfferBook,
  DEFAULT_WEIGHTS,
  offerKey
};
