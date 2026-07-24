'use strict';

/**
 * Privacy-preserving DocumentRequest hop rewrite + fee skim helpers.
 */

const crypto = require('crypto');

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
  computeRelayFee,
  buildForwardedDocumentRequest,
  assertMonotoneBudget
};
