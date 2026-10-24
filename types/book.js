'use strict';

/**
 * @fileoverview Ranked, locally-held document / blob offer book with
 * per-provider telemetry. The book is the consumer-side "chunk index":
 * blob hash → ranked providers, where ranking folds in locally measured
 * inventory round-trip time, delivery outcomes, refunds, and fraud-proof
 * penalties. Nothing here is gossiped — reputation is local (see
 * `docs/L1_DOCUMENT_EXCHANGE.md`); `exportTelemetry()` is shaped so the
 * record could be signed and shared later without migration.
 */

const crypto = require('crypto');
const { contentHashHexFromObject } = require('../functions/documentPaymentHash');
const { stableStringify, jsonSafe } = require('../functions/fabricCanonicalJson');

/** Default ranking weights (sum to 1). */
const DEFAULT_WEIGHTS = Object.freeze({
  price: 45 / 100,
  latency: 25 / 100,
  peerScore: 1 / 5,
  completeness: 1 / 10
});

/** Telemetry record schema version. */
const TELEMETRY_VERSION = 2;
/** Canonical `type` for an exported telemetry record. */
const TELEMETRY_TYPE = 'ProviderTelemetry';
/** Score for a provider with no observations. */
const SCORE_UNKNOWN = 0;
/** Maximum provider score. */
const SCORE_MAX = 1000;
/** A provider seen only in inventories ranks below a neutral record (500). */
const SCORE_INVENTORY_ONLY = 250;
/** Providers tracked before the least recently updated unpenalized one is evicted. */
const MAX_PROVIDERS = 10000;
/** Offer rows held before the oldest is evicted. */
const MAX_OFFERS = 100000;
/** Fraud-proof evidence ids remembered for dedupe. */
const MAX_EVIDENCE = 10000;
const COUNTERS = ['inventories', 'deliveries', 'failures', 'refunds', 'penalties', 'bytesDelivered'];
/** Each extra gossip hop counts as this many milliseconds of latency. */
const HOP_PENALTY_MS = 50;

/**
 * Stable key for one offer row.
 * @param {object} row
 * @returns {string}
 */
function offerKey (row) {
  const blob = row.blobIndex != null ? String(row.blobIndex) : 'all';
  return `${row.documentId}|${blob}|${row.sellerId || row.sellerAddress || ''}`;
}

/**
 * @private
 * @param {number} prev
 * @param {number} next
 * @param {number} alpha
 * @returns {number}
 */
function ewma (prev, next, alpha) {
  if (!Number.isFinite(prev) || prev <= 0) return next;
  return (alpha * next) + ((1 - alpha) * prev);
}

/**
 * @private
 * @param {string} v
 * @returns {string|null}
 */
function hex64 (v) {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(s) ? s : null;
}

/**
 * @private
 * @param {string} v compressed or x-only hex
 * @returns {string|null} x-only hex
 */
function xOnlyKey (v) {
  const s = String(v || '').trim().toLowerCase();
  if (/^(02|03)[0-9a-f]{64}$/.test(s)) return s.slice(2);
  return /^[0-9a-f]{64}$/.test(s) ? s : null;
}

/** @private non-negative safe integer, else 0 */
function count (v) {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
}

/**
 * @private
 * @param {object} record telemetry record (its `hash` field is ignored)
 * @returns {string}
 */
function telemetryHash (record) {
  const body = Object.assign({}, record);
  delete body.hash;
  return crypto.createHash('sha256').update(stableStringify(jsonSafe(body))).digest('hex');
}

/**
 * Leaf check for an advertised blob list: `functions/documentBlobManifest`
 * `verifyOfferLeaves` (v2 and v1 trees), else a v1 blob-hash root over a
 * complete list. Returns the `verifyOfferLeaves` result (or `true` / `false`),
 * or `null` when the list cannot be checked (a subset without inclusion proofs).
 * @private
 */
function defaultVerifyOfferLeaves (opts) {
  const manifest = require('../functions/documentBlobManifest');
  if (typeof manifest.verifyOfferLeaves === 'function') return manifest.verifyOfferLeaves(opts);
  const hashes = [];
  for (const b of opts.blobs) hashes[Number(b.index)] = b.blobHashHex;
  if (hashes.length !== opts.blobTotal || hashes.some((h) => !h)) return null;
  return manifest.createBlobMerkleTree(hashes).rootHex === opts.merkleRootHex;
}

class Book {
  /**
   * @param {Object} [settings]
   * @param {number} [settings.alpha=0.3] EWMA smoothing for latencies
   * @param {number} [settings.hopPenaltyMs=50] latency added per gossip hop
   * @param {Object} [settings.weights] ranking weight overrides
   * @param {number} [settings.maxProviders=10000] tracked providers (LRU over unpenalized ones)
   * @param {number} [settings.maxOffers=100000] offer rows (oldest evicted)
   * @param {string} [settings.nodeId] stamped on exported telemetry; imports from another node are refused
   * @param {Function} [settings.verifyOfferLeaves] `({ merkleRootHex, blobs, blobTotal, treeVersion }) → boolean|null|{ ok }`
   */
  constructor (settings = {}) {
    this.settings = Object.assign({
      alpha: 0.3,
      hopPenaltyMs: HOP_PENALTY_MS,
      weights: DEFAULT_WEIGHTS,
      maxProviders: MAX_PROVIDERS,
      maxOffers: MAX_OFFERS,
      nodeId: null,
      verifyOfferLeaves: null
    }, settings);
    /** @type {Map<string, object>} offerKey → offer row */
    this._offers = new Map();
    /** @type {Map<string, object>} sellerId → provider telemetry */
    this._providers = new Map();
    /** @type {Map<string, object>} x-only key → `{ penalties, lastPenaltyKind }` (never cleared) */
    this._keyPenalties = new Map();
    /** @type {Map<string, Set<string>>} sellerId → x-only AMP signer keys seen on its offers */
    this._sellerKeys = new Map();
    /** @type {Set<string>} fraud-proof evidence ids already counted */
    this._evidence = new Set();
  }

  // ---------------------------------------------------------------------
  // Telemetry (local only)
  // ---------------------------------------------------------------------

  /**
   * @private
   * @param {string} sellerId
   * @returns {object}
   */
  _stats (sellerId) {
    const id = String(sellerId || '').trim();
    if (!id) return null;
    let s = this._providers.get(id);
    if (!s) {
      if (this._providers.size >= this.settings.maxProviders && !this._evictProvider()) return null;
      s = {
        sellerId: id,
        inventoryLatencyMs: 0,
        deliveryLatencyMs: 0,
        inventories: 0,
        deliveries: 0,
        failures: 0,
        refunds: 0,
        penalties: 0,
        bytesDelivered: 0,
        hops: 0,
        lastPenaltyKind: null,
        updatedAt: 0
      };
      this._providers.set(id, s);
    }
    return s;
  }

  /**
   * Drop the least recently updated provider that carries no penalty.
   * @private
   * @returns {boolean} whether room was made
   */
  _evictProvider () {
    let victim = null;
    for (const s of this._providers.values()) {
      if (this._penaltiesFor(s.sellerId) > 0) continue;
      if (!victim || s.updatedAt < victim.updatedAt) victim = s;
    }
    if (!victim) return false;
    this._providers.delete(victim.sellerId);
    this._sellerKeys.delete(victim.sellerId);
    return true;
  }

  /**
   * Direct penalties plus penalties on every AMP signer key the seller used.
   * @private
   * @param {string} sellerId
   * @returns {number}
   */
  _penaltiesFor (sellerId) {
    const id = String(sellerId || '').trim();
    const s = this._providers.get(id);
    let n = s ? count(s.penalties) : 0;
    const keys = this._sellerKeys.get(id);
    if (keys) {
      for (const k of keys) {
        const p = this._keyPenalties.get(k);
        if (p) n += p.penalties;
      }
    }
    return n;
  }

  /**
   * @private
   * @param {string} sellerId
   * @param {string} pubkey AMP signer (compressed or x-only)
   */
  _linkKey (sellerId, pubkey) {
    const key = xOnlyKey(pubkey);
    const id = String(sellerId || '').trim();
    if (!key || !id || !this._providers.has(id)) return;
    if (!this._sellerKeys.has(id)) this._sellerKeys.set(id, new Set());
    const keys = this._sellerKeys.get(id);
    if (keys.size < 16 || keys.has(key)) keys.add(key);
  }

  /**
   * Record an inventory round trip for a provider.
   * @param {string} sellerId
   * @param {number} latencyMs
   * @param {Object} [opts]
   * @param {number} [opts.hops] gossip hops the response travelled
   */
  recordInventoryLatency (sellerId, latencyMs, opts = {}) {
    const s = this._stats(sellerId);
    if (!s) return null;
    const ms = Number(latencyMs);
    if (Number.isFinite(ms) && ms >= 0) {
      s.inventoryLatencyMs = ewma(s.inventoryLatencyMs, ms, this.settings.alpha);
      s.inventories++;
    }
    if (opts.hops != null && Number.isFinite(Number(opts.hops))) {
      s.hops = Math.max(0, Math.round(Number(opts.hops)));
    }
    s.updatedAt = Date.now();
    return s;
  }

  /**
   * Record a delivery outcome (a blob plan or a single blob).
   * @param {string} sellerId
   * @param {Object} outcome
   * @param {boolean} outcome.ok bytes verified against the advertised hash
   * @param {number} [outcome.latencyMs]
   * @param {number} [outcome.bytes]
   */
  recordDelivery (sellerId, outcome = {}) {
    const s = this._stats(sellerId);
    if (!s) return null;
    if (outcome.ok === true) {
      s.deliveries++;
      const b = Number(outcome.bytes);
      if (Number.isFinite(b) && b > 0) s.bytesDelivered += b;
      const ms = Number(outcome.latencyMs);
      if (Number.isFinite(ms) && ms >= 0) {
        s.deliveryLatencyMs = ewma(s.deliveryLatencyMs, ms, this.settings.alpha);
      }
    } else {
      s.failures++;
    }
    s.updatedAt = Date.now();
    return s;
  }

  /**
   * Record that a purchase from this provider ended in an HTLC refund.
   * @param {string} sellerId
   */
  recordRefund (sellerId) {
    const s = this._stats(sellerId);
    if (!s) return null;
    s.refunds++;
    s.updatedAt = Date.now();
    return s;
  }

  /**
   * Record a verified fraud proof against this provider.
   * @param {string} sellerId
   * @param {Object} [proof] `{ kind }` from `types/witness` FraudProof
   */
  recordPenalty (sellerId, proof = {}) {
    const s = this._stats(sellerId);
    if (!s) return null;
    s.penalties++;
    s.lastPenaltyKind = proof && proof.kind ? String(proof.kind) : null;
    s.updatedAt = Date.now();
    return s;
  }

  /**
   * Verify a `FraudProof` body (`types/witness`) and penalize the offender
   * locally. The penalty lands on the offender's x-only key and sticks: every
   * seller whose offers carry that key as their verified AMP signer
   * (`ampSignerPubkey`, from `signerPubkeyHex` at ingest) scores with it, now
   * and on later ingests. Self-asserted `sellerPubkey` / `sellerId` never
   * route a penalty. Each evidence id counts once; verdicts that name no
   * offender (`reputational: false`) penalize nobody. Reputation stays local
   * (decision 4).
   * @param {Object} body `CONTRACT_MESSAGE` body
   * @param {Object} [ctx] chain view / epoch for the proof kind
   * @returns {{ ok: boolean, offender: string|null, reason: string|null, penalized: string[], duplicate: (boolean|undefined) }}
   */
  ingestFraudProof (body, ctx = {}) {
    const { FraudProof } = require('./witness');
    const proof = body instanceof FraudProof ? body : FraudProof.fromBody(body);
    if (!proof) return { ok: false, offender: null, reason: 'not a FraudProof', penalized: [] };
    const verdict = proof.verify(ctx);
    if (!verdict.ok) return Object.assign(verdict, { penalized: [] });
    const key = xOnlyKey(verdict.offender);
    if (!key || verdict.reputational === false) {
      return Object.assign(verdict, { ok: false, reason: verdict.reason || 'verdict names no offender', penalized: [] });
    }
    const ids = typeof proof.evidenceIds === 'function' ? proof.evidenceIds() : [];
    if (!ids.length) return Object.assign(verdict, { ok: false, reason: 'proof has no evidence id', penalized: [] });
    if (ids.some((id) => this._evidence.has(id))) {
      return Object.assign(verdict, { ok: false, duplicate: true, reason: 'evidence already counted', penalized: [] });
    }
    for (const id of ids) this._rememberEvidence(id);

    if (!this._keyPenalties.has(key) && this._keyPenalties.size >= this.settings.maxProviders) {
      // Self-incriminating proofs against throwaway keys are cheap: drop a key
      // no known seller signs with before one that still routes a penalty.
      const linked = new Set();
      for (const keys of this._sellerKeys.values()) for (const k of keys) linked.add(k);
      let victim = null;
      for (const k of this._keyPenalties.keys()) {
        if (!linked.has(k)) { victim = k; break; }
      }
      this._keyPenalties.delete(victim || this._keyPenalties.keys().next().value);
    }
    const kp = this._keyPenalties.get(key) || { penalties: 0, lastPenaltyKind: null };
    kp.penalties++;
    kp.lastPenaltyKind = String(proof.kind);
    this._keyPenalties.set(key, kp);

    const penalized = [];
    for (const [sellerId, keys] of this._sellerKeys) {
      if (!keys.has(key)) continue;
      const s = this._providers.get(sellerId);
      if (s) {
        s.lastPenaltyKind = String(proof.kind);
        s.updatedAt = Date.now();
      }
      penalized.push(sellerId);
    }
    return Object.assign(verdict, { penalized });
  }

  /**
   * @private
   * @param {string} id
   */
  _rememberEvidence (id) {
    if (this._evidence.size >= MAX_EVIDENCE) this._evidence.delete(this._evidence.values().next().value);
    this._evidence.add(String(id));
  }

  /**
   * Penalty count recorded against an AMP signer key.
   * @param {string} pubkey compressed or x-only
   * @returns {number}
   */
  keyPenalties (pubkey) {
    const p = this._keyPenalties.get(xOnlyKey(pubkey));
    return p ? p.penalties : 0;
  }

  /**
   * Derived 0..1000 score. Unknown providers score {@link SCORE_UNKNOWN},
   * inventory-only ones {@link SCORE_INVENTORY_ONLY} (below a neutral
   * record); a verified penalty — direct or on any AMP signer key the seller
   * used — is weighted as ten failed deliveries.
   * @param {string} sellerId
   * @returns {number}
   */
  scoreFor (sellerId) {
    const s = this._providers.get(String(sellerId || '').trim());
    if (!s) return SCORE_UNKNOWN;
    const penalties = this._penaltiesFor(s.sellerId);
    const attempts = s.deliveries + s.failures + s.refunds + (penalties * 10);
    if (attempts <= 0) {
      return s.inventories > 0 ? SCORE_INVENTORY_ONLY : SCORE_UNKNOWN;
    }
    const ratio = s.deliveries / attempts;
    return Math.max(0, Math.min(SCORE_MAX, Math.round(ratio * SCORE_MAX)));
  }

  /**
   * Effective latency for ranking: measured RTT plus a per-hop penalty.
   * @param {string} sellerId
   * @returns {number}
   */
  latencyFor (sellerId) {
    const s = this._providers.get(String(sellerId || '').trim());
    if (!s) return 0;
    const base = s.inventoryLatencyMs || s.deliveryLatencyMs || 0;
    return base + (s.hops * this.settings.hopPenaltyMs);
  }

  /**
   * @param {string} sellerId
   * @returns {object|null}
   */
  providerStats (sellerId) {
    const s = this._providers.get(String(sellerId || '').trim());
    if (!s) return null;
    return Object.assign({}, s, {
      penalties: this._penaltiesFor(s.sellerId),
      score: this.scoreFor(sellerId),
      latencyMs: this.latencyFor(sellerId)
    });
  }

  /**
   * All known providers with derived score, best first.
   * @returns {object[]}
   */
  listProviders () {
    return Array.from(this._providers.keys())
      .map((id) => this.providerStats(id))
      .sort((a, b) => (b.score - a.score) || (a.latencyMs - b.latencyMs));
  }

  /**
   * Signable, versioned telemetry record (local persistence; future gossip).
   * `hash` is SHA-256 over the canonical JSON (`stableStringify`) of every
   * other field, so it survives a JSON round trip.
   * @returns {{ type: string, version: number, nodeId: (string|null), providers: object[], keys: object[], evidence: string[], hash: string }}
   */
  exportTelemetry () {
    const providers = Array.from(this._providers.values())
      .map((s) => ({
        sellerId: s.sellerId,
        inventoryLatencyMs: s.inventoryLatencyMs,
        deliveryLatencyMs: s.deliveryLatencyMs,
        inventories: s.inventories,
        deliveries: s.deliveries,
        failures: s.failures,
        refunds: s.refunds,
        penalties: s.penalties,
        bytesDelivered: s.bytesDelivered,
        hops: s.hops,
        lastPenaltyKind: s.lastPenaltyKind || null,
        updatedAt: s.updatedAt
      }))
      .sort((a, b) => String(a.sellerId).localeCompare(String(b.sellerId)));
    const keys = Array.from(this._keyPenalties)
      .map(([pubkey, p]) => ({ pubkey, penalties: p.penalties, lastPenaltyKind: p.lastPenaltyKind || null }))
      .sort((a, b) => a.pubkey.localeCompare(b.pubkey));
    const body = {
      type: TELEMETRY_TYPE,
      version: TELEMETRY_VERSION,
      nodeId: this.settings.nodeId != null ? String(this.settings.nodeId) : null,
      providers,
      keys,
      evidence: Array.from(this._evidence).sort()
    };
    return Object.assign(body, { hash: telemetryHash(body) });
  }

  /**
   * Merge a telemetry record exported earlier by this node. The hash must
   * match; a record stamped with another `nodeId` is refused unless
   * `opts.allowForeign`. Counters merge by maximum (re-importing is
   * idempotent and cannot inflate a provider), penalties are never reduced,
   * and latencies take the newer sample.
   * @param {object} record
   * @param {Object} [opts]
   * @param {boolean} [opts.allowForeign]
   * @returns {number} providers merged
   */
  importTelemetry (record, opts = {}) {
    if (!record || record.type !== TELEMETRY_TYPE || !Array.isArray(record.providers)) return 0;
    if (!record.hash || telemetryHash(record) !== String(record.hash)) return 0;
    const own = this.settings.nodeId != null ? String(this.settings.nodeId) : null;
    if (record.nodeId != null && own != null && String(record.nodeId) !== own && opts.allowForeign !== true) return 0;
    let n = 0;
    for (const p of record.providers) {
      if (!p || typeof p.sellerId !== 'string' || !p.sellerId.trim()) continue;
      const s = this._stats(p.sellerId);
      if (!s) continue;
      for (const k of COUNTERS) s[k] = Math.max(count(s[k]), count(p[k]));
      const at = count(p.updatedAt);
      if (at >= count(s.updatedAt)) {
        const inv = Number(p.inventoryLatencyMs);
        const del = Number(p.deliveryLatencyMs);
        if (Number.isFinite(inv) && inv >= 0) s.inventoryLatencyMs = inv;
        if (Number.isFinite(del) && del >= 0) s.deliveryLatencyMs = del;
        s.hops = count(p.hops);
        s.updatedAt = at || s.updatedAt;
        if (p.lastPenaltyKind) s.lastPenaltyKind = String(p.lastPenaltyKind);
      }
      n++;
    }
    for (const k of Array.isArray(record.keys) ? record.keys : []) {
      const key = xOnlyKey(k && k.pubkey);
      const penalties = count(k && k.penalties);
      if (!key || !penalties) continue;
      const prev = this._keyPenalties.get(key);
      if (!prev && this._keyPenalties.size >= this.settings.maxProviders) continue;
      this._keyPenalties.set(key, {
        penalties: Math.max(prev ? prev.penalties : 0, penalties),
        lastPenaltyKind: (prev && prev.lastPenaltyKind) || (k.lastPenaltyKind ? String(k.lastPenaltyKind) : null)
      });
    }
    for (const id of Array.isArray(record.evidence) ? record.evidence : []) {
      if (typeof id === 'string' && id) this._rememberEvidence(id);
    }
    return n;
  }

  // ---------------------------------------------------------------------
  // Offers
  // ---------------------------------------------------------------------

  /**
   * Ingest an `INVENTORY_RESPONSE`. Caller-supplied `peerScore` / `latencyMs`
   * win; otherwise local telemetry for the seller is applied.
   * @param {object} opts
   * @param {string} opts.origin seller address / peer key
   * @param {object[]} opts.items inventory items
   * @param {number} [opts.peerScore]
   * @param {number} [opts.latencyMs] measured round trip for this response
   * @param {number} [opts.hops] gossip hops travelled
   * @param {string} [opts.sellerId]
   * @param {string} [opts.sellerPubkey]
   * @param {string} [opts.signerPubkeyHex] AMP signer (preferred identity)
   */
  ingestInventoryResponse (opts = {}) {
    const origin = String(opts.origin || '').trim();
    const items = Array.isArray(opts.items) ? opts.items : [];
    const sellerId = opts.sellerId != null ? String(opts.sellerId) : origin;
    const sellerPubkey = opts.sellerPubkey != null
      ? String(opts.sellerPubkey).trim().toLowerCase()
      : null;
    const ampSignerPubkey = opts.signerPubkeyHex != null
      ? String(opts.signerPubkeyHex).trim().toLowerCase()
      : (opts.ampSignerPubkey != null ? String(opts.ampSignerPubkey).trim().toLowerCase() : null);

    if (opts.latencyMs != null && Number.isFinite(Number(opts.latencyMs))) {
      this.recordInventoryLatency(sellerId, Number(opts.latencyMs), { hops: opts.hops });
    } else if (opts.hops != null) {
      const s = this._stats(sellerId);
      if (s) s.hops = Math.max(0, Math.round(Number(opts.hops) || 0));
    }
    if (ampSignerPubkey && this._stats(sellerId)) this._linkKey(sellerId, ampSignerPubkey);

    const peerScore = Number.isFinite(Number(opts.peerScore)) ? Number(opts.peerScore) : this.scoreFor(sellerId);
    const latencyMs = Number.isFinite(Number(opts.latencyMs)) ? Number(opts.latencyMs) : this.latencyFor(sellerId);
    const hops = Number.isFinite(Number(opts.hops)) ? Math.max(0, Math.round(Number(opts.hops))) : 0;
    const now = Date.now();
    const upserted = [];

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
      const merkleRootHex = hex64(it.merkleRootHex || (indexObj && indexObj.merkleRootHex));
      const rawTreeVersion = it.treeVersion != null ? it.treeVersion : (indexObj && indexObj.treeVersion);
      const treeVersion = Number.isSafeInteger(Number(rawTreeVersion)) && Number(rawTreeVersion) > 0 ? Number(rawTreeVersion) : null;
      let rootVerified = false;
      let leavesCommitted = null;
      if (blobs && blobs.length && merkleRootHex) {
        const leaves = this._verifyLeaves(it, merkleRootHex, blobs, indexObj);
        if (leaves === false) continue;
        rootVerified = leaves != null;
        leavesCommitted = leaves ? leaves.committed : null;
      }
      const base = {
        documentId,
        sellerId,
        sellerAddress: origin,
        sellerPubkey: sellerPubkey || (it.sellerPubkey ? String(it.sellerPubkey).toLowerCase() : null),
        ampSignerPubkey: ampSignerPubkey || null,
        merkleRootHex,
        rootVerified,
        leavesCommitted,
        treeVersion,
        mime: it.mime || null,
        sealed,
        peerScore,
        latencyMs,
        hops,
        observedAt: now
      };
      if (blobs && blobs.length) {
        for (const b of blobs) {
          if (!b || typeof b !== 'object') continue;
          // Per-blob payment hash when present (sealed K_i or unsealed tagged
          // hash); fall back to the item-level hash. Never bind to blobHashHex.
          const paymentHash = contentHashHexFromObject(b) || contentHashHex;
          const row = Object.assign({}, base, {
            blobIndex: Number(b.index),
            blobTotal: Number(b.total != null ? b.total : blobs.length),
            rateSats: Number(b.rateSats != null ? b.rateSats : rateSats) || 0,
            contentHashHex: paymentHash,
            blobHashHex: hex64(b.blobHashHex),
            iv: typeof b.iv === 'string' && /^[A-Za-z0-9+/]{16,64}={0,2}$/.test(b.iv) ? b.iv : null,
            proof: Array.isArray(b.proof) ? b.proof.slice(0, 64) : null,
            size: b.size != null ? Number(b.size) : (it.size != null ? Number(it.size) : null),
            htlc: b.htlc || it.htlc || null,
            completeness: 1
          });
          this._putOffer(row);
          upserted.push(row);
        }
      } else {
        const row = Object.assign({}, base, {
          blobIndex: it.blobIndex != null ? Number(it.blobIndex) : null,
          blobTotal: it.blobTotal != null ? Number(it.blobTotal) : null,
          rateSats,
          contentHashHex,
          blobHashHex: hex64(it.blobHashHex),
          size: it.size != null ? Number(it.size) : null,
          htlc: it.htlc || null,
          completeness: it.completeness != null ? Number(it.completeness) : 1
        });
        this._putOffer(row);
        upserted.push(row);
      }
    }
    return upserted;
  }

  /**
   * Insert or refresh a row; past `maxOffers` the oldest row goes.
   * @private
   * @param {object} row
   */
  _putOffer (row) {
    const key = offerKey(row);
    this._offers.delete(key);
    while (this._offers.size >= this.settings.maxOffers) {
      this._offers.delete(this._offers.keys().next().value);
    }
    this._offers.set(key, row);
  }

  /**
   * Check an item's inline blob leaves against its `merkleRootHex`
   * (`settings.verifyOfferLeaves`, else `documentBlobManifest.verifyOfferLeaves`).
   * @private
   * @returns {Object|boolean|null} `false` = reject the item; `null` = a subset
   *   without inclusion proofs (rows kept with `rootVerified: false`); else
   *   `{ committed }` — `true` when the root commits the payment hashes and
   *   IVs (v2), `false` for a v1 root, `null` when the verifier does not say
   */
  _verifyLeaves (it, merkleRootHex, blobs, indexObj) {
    const first = blobs.find((b) => b && b.total != null);
    const blobTotal = Number(
      it.blobTotal != null ? it.blobTotal
        : (indexObj && indexObj.blobTotal != null ? indexObj.blobTotal
          : (first ? first.total : blobs.length))
    );
    if (!Number.isSafeInteger(blobTotal) || blobTotal < 1) return false;
    const leaves = [];
    for (const b of blobs) {
      if (!b || typeof b !== 'object') return false;
      leaves.push({
        index: Number(b.index),
        blobHashHex: b.blobHashHex,
        paymentHashHex: contentHashHexFromObject(b),
        iv: b.iv,
        proof: b.proof
      });
    }
    const indexes = new Set(leaves.map((l) => l.index));
    const full = indexes.size === blobTotal && leaves.length === blobTotal;
    if (!full && !leaves.every((l) => Array.isArray(l.proof))) return null;
    const verify = typeof this.settings.verifyOfferLeaves === 'function'
      ? this.settings.verifyOfferLeaves
      : defaultVerifyOfferLeaves;
    const treeVersion = it.treeVersion != null ? it.treeVersion : (indexObj && indexObj.treeVersion);
    try {
      const out = verify({ merkleRootHex, blobs: leaves, blobTotal, treeVersion: treeVersion != null ? Number(treeVersion) : undefined });
      if (out === null) return null;
      if (out === true) return { committed: null };
      if (out != null && typeof out === 'object' && out.ok === true) {
        return { committed: typeof out.committed === 'boolean' ? out.committed : null };
      }
      return false;
    } catch (err) {
      return false;
    }
  }

  /**
   * Drop every offer from one seller (disconnect, fraud, expiry).
   * @param {string} sellerId
   * @returns {number} rows removed
   */
  forgetSeller (sellerId) {
    const id = String(sellerId || '');
    let n = 0;
    for (const [k, row] of this._offers) {
      if (String(row.sellerId) === id || String(row.sellerAddress) === id) {
        this._offers.delete(k);
        n++;
      }
    }
    return n;
  }

  /**
   * @param {Object} [filter]
   * @param {string} [filter.documentId]
   * @param {number} [filter.blobIndex]
   * @param {string} [filter.blobHashHex] chunk selector
   * @param {string} [filter.merkleRootHex] tree selector
   * @param {string} [filter.sellerId]
   * @returns {object[]}
   */
  listOffers (filter = {}) {
    const blobHash = hex64(filter.blobHashHex);
    const root = hex64(filter.merkleRootHex);
    const out = [];
    for (const row of this._offers.values()) {
      if (filter.documentId && row.documentId !== filter.documentId) continue;
      if (filter.blobIndex != null && row.blobIndex !== Number(filter.blobIndex)) continue;
      if (blobHash && row.blobHashHex !== blobHash) continue;
      if (root && row.merkleRootHex !== root) continue;
      if (filter.sellerId && String(row.sellerId) !== String(filter.sellerId) &&
          String(row.sellerAddress) !== String(filter.sellerId)) continue;
      out.push(Object.assign({}, row));
    }
    return out;
  }

  /**
   * Chunk index: ranked providers for one blob hash.
   * @param {string} blobHashHex
   * @param {Object} [opts] see {@link Book#pickBest}
   * @returns {object[]} ranked offers, best first
   */
  providersForBlob (blobHashHex, opts = {}) {
    let offers = this.listOffers({ blobHashHex });
    offers = this._applyFilters(offers, opts);
    return this.rankOffers(offers, opts.weights);
  }

  /**
   * Full chunk index: blob hash → ranked offers.
   * @param {Object} [filter] `{ merkleRootHex, documentId }`
   * @returns {Map<string, object[]>}
   */
  indexByBlobHash (filter = {}) {
    const index = new Map();
    for (const row of this.listOffers(filter)) {
      if (!row.blobHashHex) continue;
      if (!index.has(row.blobHashHex)) index.set(row.blobHashHex, []);
      index.get(row.blobHashHex).push(row);
    }
    for (const [k, rows] of index) index.set(k, this.rankOffers(rows));
    return index;
  }

  /**
   * @private
   */
  _applyFilters (offers, opts = {}) {
    let out = offers;
    if (opts.maxSats != null && Number.isFinite(Number(opts.maxSats))) {
      const max = Number(opts.maxSats);
      out = out.filter((o) => (Number(o.rateSats) || 0) <= max);
    }
    if (opts.minPaidSats != null && Number.isFinite(Number(opts.minPaidSats))) {
      // Free offers stay; a paid one must be large enough to settle.
      const min = Number(opts.minPaidSats);
      out = out.filter((o) => {
        const rate = Number(o.rateSats) || 0;
        return rate <= 0 || rate >= min;
      });
    }
    if (Array.isArray(opts.excludeSellers) && opts.excludeSellers.length) {
      const ex = new Set(opts.excludeSellers.map(String));
      out = out.filter((o) => !ex.has(String(o.sellerId)) && !ex.has(String(o.sellerAddress)));
    }
    // A v1 root over the same blobs commits no payment hashes, so a reseller
    // could pair real ciphertext with keys it doesn't hold: never pick one
    // while an offer whose root commits them is listed.
    if (out.some((o) => o.leavesCommitted === true)) out = out.filter((o) => o.leavesCommitted !== false);
    return out;
  }

  /**
   * @param {object[]} offers
   * @param {Object} [weights]
   * @returns {object[]} offers with `rankScore`, best first
   */
  rankOffers (offers, weights) {
    const list = Array.isArray(offers) ? offers.slice() : [];
    if (!list.length) return list;
    const w = Object.assign({}, DEFAULT_WEIGHTS, this.settings.weights || {}, weights || {});
    const hopMs = this.settings.hopPenaltyMs;
    const prices = list.map((o) => Number(o.rateSats) || 0);
    const lats = list.map((o) => (Number(o.latencyMs) || 0) + ((Number(o.hops) || 0) * hopMs));
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

  /**
   * @param {string} documentId
   * @param {Object} [opts]
   * @param {number} [opts.blobIndex]
   * @param {number} [opts.maxSats]
   * @param {number} [opts.minPaidSats] drop paid offers below this (free offers stay)
   * @param {string[]} [opts.excludeSellers]
   * @param {string} [opts.merkleRootHex] only offers for this tree root
   * @param {Object} [opts.weights]
   * @returns {object|null}
   */
  pickBest (documentId, opts = {}) {
    let offers = this.listOffers({ documentId, blobIndex: opts.blobIndex, merkleRootHex: opts.merkleRootHex });
    offers = this._applyFilters(offers, opts);
    const ranked = this.rankOffers(offers, opts.weights);
    return ranked[0] || null;
  }

  /**
   * One offer per blob index. Prefers seller diversity when rank scores are
   * within 10%. With per-blob sealing (every blob has its own `K_i` and
   * payment hash) sealed trees split across sellers exactly like unsealed
   * ones; a legacy document-level seal (`opts.singleKey`) stays on one seller.
   * @param {string} documentId
   * @param {number} blobTotal
   * @param {Object} [opts]
   * @param {boolean} [opts.singleKey] legacy whole-document key: lock one seller
   * @param {number} [opts.maxSats] per-blob ceiling
   * @param {number} [opts.minPaidSats] drop paid offers below this (free offers stay)
   * @param {string[]} [opts.excludeSellers]
   * @param {string} [opts.merkleRootHex] only offers for this tree root; when
   *   omitted the plan still stays on **one** root (the first pick's), so
   *   blobs from different trees are never mixed into a single document
   * @returns {Map<number, object>}
   */
  pickBlobPlan (documentId, blobTotal, opts = {}) {
    const n = Math.round(Number(blobTotal));
    const plan = new Map();
    if (!Number.isFinite(n) || n < 1) return plan;
    const all = this._applyFilters(this.listOffers({ documentId, merkleRootHex: opts.merkleRootHex }), opts);
    const lockToOne = opts.singleKey === true || this._usesSingleKey(all, opts);
    const used = [];
    let lockedSeller = null;
    let lockedRoot = hex64(opts.merkleRootHex) || null;
    for (let i = 0; i < n; i++) {
      let offers = all.filter((o) => o.blobIndex === i);
      if (!offers.length) offers = all.filter((o) => o.blobIndex == null);
      if (lockedRoot) offers = offers.filter((o) => !o.merkleRootHex || o.merkleRootHex === lockedRoot);
      if (lockToOne && lockedSeller) {
        offers = offers.filter((o) => String(o.sellerId || o.sellerAddress) === lockedSeller);
      }
      const ranked = this.rankOffers(offers, opts.weights);
      if (!ranked.length) continue;
      const top = ranked[0];
      let pick = top;
      if (!lockToOne && used.length && ranked.length > 1) {
        const band = top.rankScore * 0.9;
        const diverse = ranked.find((o) => {
          return o.rankScore >= band && !used.includes(String(o.sellerId || o.sellerAddress));
        });
        if (diverse) pick = diverse;
      }
      plan.set(i, pick);
      used.push(String(pick.sellerId || pick.sellerAddress));
      if (lockToOne && !lockedSeller) lockedSeller = String(pick.sellerId || pick.sellerAddress);
      if (!lockedRoot && pick.merkleRootHex) lockedRoot = pick.merkleRootHex;
    }
    return plan;
  }

  /**
   * A sealed tree whose blobs all share one payment hash is a legacy
   * document-level seal (one K for the ciphertext) and must stay on one
   * seller. Per-blob seals carry a distinct SHA256(K_i) per index.
   * @private
   * @param {object[]} offers
   * @param {Object} opts
   * @returns {boolean}
   */
  _usesSingleKey (offers, opts = {}) {
    const sealedRows = offers.filter((o) => o && o.sealed === true && o.blobIndex != null);
    if (!sealedRows.length) return opts.sealed === true && offers.some((o) => o.blobIndex == null);
    const byIndex = new Map();
    for (const o of sealedRows) {
      if (!o.contentHashHex) continue;
      byIndex.set(o.blobIndex, o.contentHashHex);
    }
    const distinct = new Set(byIndex.values());
    return distinct.size <= 1;
  }

  /**
   * Group a blob plan by seller: the MVP economic unit (one L1 HTLC per
   * seller covering every blob picked from them).
   * @param {Map<number, object>} plan from {@link Book#pickBlobPlan}
   * @returns {object[]} `[{ sellerId, sellerAddress, blobIndexes, totalSats, offers }]`
   */
  groupPlanBySeller (plan) {
    const groups = new Map();
    for (const [index, offer] of plan) {
      const id = String(offer.sellerId || offer.sellerAddress);
      if (!groups.has(id)) {
        groups.set(id, { sellerId: id, sellerAddress: offer.sellerAddress, blobIndexes: [], totalSats: 0, offers: [] });
      }
      const g = groups.get(id);
      g.blobIndexes.push(index);
      g.totalSats += Number(offer.rateSats) || 0;
      g.offers.push(offer);
    }
    return Array.from(groups.values());
  }
}

module.exports = Book;
module.exports.Book = Book;
/** @deprecated use {@link Book} */
module.exports.DocumentOfferBook = Book;
module.exports.DEFAULT_WEIGHTS = DEFAULT_WEIGHTS;
module.exports.TELEMETRY_TYPE = TELEMETRY_TYPE;
module.exports.TELEMETRY_VERSION = TELEMETRY_VERSION;
module.exports.HOP_PENALTY_MS = HOP_PENALTY_MS;
module.exports.offerKey = offerKey;
module.exports.SCORE_UNKNOWN = SCORE_UNKNOWN;
module.exports.SCORE_INVENTORY_ONLY = SCORE_INVENTORY_ONLY;
module.exports.MAX_PROVIDERS = MAX_PROVIDERS;
