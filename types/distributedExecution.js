'use strict';

/**
 * Shared helpers for multi-operator contract execution: canonical payloads,
 * beacon epoch signing strings, and federation signature verification.
 *
 * Used by Hub Beacon, HTTP manifest routes (`@fabric/http`), and peers that
 * must reject messages outside the agreed program.
 */
/** @private */
const crypto = require('crypto');
const Key = require('./key');

const BEACON_EPOCH_SIGNING_KIND = 'BeaconEpoch';

/**
 * Deterministic JSON (sorted object keys) for hashing and signing.
 * @private
 * @param {*} value
 * @returns {string}
 */
function stableStringify (value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map((v) => stableStringify(v)).join(',') + ']';
  }
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
}

/**
 * Drop `undefined` and normalize values the same way JSON.parse(JSON.stringify) does.
 * @private
 * @param {*} value
 * @returns {*}
 */
function jsonSafe (value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * UTF-8 string that federation members sign for a beacon epoch (same bytes for all validators).
 * @private
 * @param {object} epochPayload — clock, blockHash, height, balance, balanceSats, timestamp, …
 * @returns {string}
 */
function signingStringForBeaconEpoch (epochPayload) {
  const safe = jsonSafe(epochPayload);
  return stableStringify({
    version: 1,
    kind: BEACON_EPOCH_SIGNING_KIND,
    epoch: safe
  });
}

/**
 * SHA-256 hex digest of {@link signingStringForBeaconEpoch} (public commitment).
 * @private
 * @param {object} epochPayload
 * @returns {string}
 */
function epochCommitmentDigestHex (epochPayload) {
  const s = signingStringForBeaconEpoch(epochPayload);
  return crypto.createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex');
}

/**
 * Verify threshold Schnorr signatures over the **same** message buffer used when signing
 * (`Key.signSchnorr(messageBuffer)`), without requiring a full {@link Federation} instance.
 * @private
 *
 * @param {Buffer} messageBuffer — typically `Buffer.from(signingStringForBeaconEpoch(epoch), 'utf8')`
 * @param {object} witness
 * @param {string[]} validatorPubkeys — compressed secp256k1 pubkeys, hex
 * @param {number} [threshold=1]
 * @returns {boolean}
 */
function verifyFederationWitnessOnMessage (messageBuffer, witness, validatorPubkeys, threshold = 1) {
  if (!witness || !witness.signatures || typeof witness.signatures !== 'object') return false;
  if (!Buffer.isBuffer(messageBuffer)) return false;
  const pubkeys = Array.isArray(validatorPubkeys) ? validatorPubkeys : [];
  const thr = Math.max(1, Number(threshold) || 1);
  let valid = 0;
  for (const pubkey of pubkeys) {
    if (typeof pubkey !== 'string' || !pubkey) continue;
    const sigHex = witness.signatures[pubkey];
    if (!sigHex || typeof sigHex !== 'string') continue;
    try {
      const k = new Key({ pubkey });
      const sig = Buffer.from(sigHex, 'hex');
      if (k.verifySchnorr(messageBuffer, sig)) valid++;
      if (valid >= thr) return true;
    } catch (_) {
      /* ignore */
    }
  }
  return false;
}

/**
 * Setup-phase manifest schema (v1): program identity + allowed traffic + optional federation policy.
 * @private
 * @param {object} raw
 * @returns {object}
 */
function parseDistributedManifestV1 (raw) {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'manifest must be an object' };
  const version = Number(raw.version);
  if (version !== 1) return { ok: false, error: 'unsupported manifest version' };
  const programId = typeof raw.programId === 'string' ? raw.programId.trim() : '';
  const programHash = typeof raw.programHash === 'string' ? raw.programHash.trim() : '';
  if (!programId || !programHash) return { ok: false, error: 'programId and programHash are required' };
  const allowedMessageTypes = Array.isArray(raw.allowedMessageTypes)
    ? raw.allowedMessageTypes.filter((t) => typeof t === 'string')
    : [];
  const federation = raw.federation && typeof raw.federation === 'object'
    ? {
        validators: Array.isArray(raw.federation.validators)
          ? raw.federation.validators.filter((v) => typeof v === 'string')
          : [],
        threshold: Math.max(1, Number(raw.federation.threshold) || 1)
      }
    : null;
  return {
    ok: true,
    manifest: {
      version: 1,
      programId,
      programHash,
      allowedMessageTypes,
      federation
    }
  };
}

module.exports = {
  stableStringify,
  jsonSafe,
  signingStringForBeaconEpoch,
  epochCommitmentDigestHex,
  verifyFederationWitnessOnMessage,
  parseDistributedManifestV1,
  BEACON_EPOCH_SIGNING_KIND
};
