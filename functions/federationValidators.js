'use strict';

/**
 * Federation validator sets: one entry per signing key, and the default
 * k-of-n threshold when none is configured.
 *
 * @fileoverview Federation validator set helpers.
 * @module functions/federationValidators
 */

const { secp256k1 } = require('@noble/curves/secp256k1.js');
const { normalizePeerPubkeyHex } = require('./contractPublishAuthority');

/**
 * Spelling-independent id for one signing key: lowercase x-only hex. BIP340
 * verifies over the x coordinate only, so `02…` / `03…` / x-only / mixed-case
 * spellings of one key share an id.
 * @param {*} pubkey compressed (33-byte) or x-only (32-byte) hex, or a Buffer
 * @returns {string|null} 64-hex id, or null when the input is not a key encoding
 */
function federationValidatorId (pubkey) {
  if (pubkey == null || pubkey === '') return null;
  const id = normalizePeerPubkeyHex(pubkey);
  return /^[0-9a-f]{64}$/.test(id) ? id : null;
}

/**
 * @param {string} hex 66-hex compressed point
 * @returns {boolean}
 * @private
 */
function isCurvePoint (hex) {
  try {
    secp256k1.Point.fromHex(hex);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Parse one validator entry. An x-only key is lifted to its even-y (`02…`)
 * point, which BIP340 treats as the same key.
 * @param {*} pubkey
 * @returns {{ id: string, compressed: string }|null} null when not a key on the curve
 * @private
 */
function parseValidator (pubkey) {
  const id = federationValidatorId(pubkey);
  if (!id) return null;
  const s = Buffer.isBuffer(pubkey)
    ? pubkey.toString('hex')
    : String(pubkey).trim().toLowerCase().replace(/^0x/, '');
  const compressed = /^0[23][0-9a-f]{64}$/.test(s) ? s : '02' + id;
  return isCurvePoint(compressed) ? { id, compressed } : null;
}

/**
 * First entry per signing key; entries that are not keys on the curve are dropped.
 * @param {string[]} validatorPubkeys
 * @returns {string[]} entries as given, minus repeats and malformed entries
 */
function uniqueValidatorPubkeys (validatorPubkeys) {
  const seen = new Set();
  const out = [];
  for (const p of (Array.isArray(validatorPubkeys) ? validatorPubkeys : [])) {
    if (typeof p !== 'string' || !p) continue;
    const parsed = parseValidator(p);
    if (!parsed || seen.has(parsed.id)) continue;
    seen.add(parsed.id);
    out.push(p);
  }
  return out;
}

/**
 * Canonical validator list: lowercase compressed hex, one entry per signing key,
 * invalid points dropped, x-only keys lifted to `02…`. Compare members with
 * {@link federationValidatorId}, not string equality.
 * @param {string[]} validatorPubkeys
 * @returns {string[]}
 */
function normalizeFederationValidators (validatorPubkeys) {
  const seen = new Set();
  const out = [];
  for (const p of (Array.isArray(validatorPubkeys) ? validatorPubkeys : [])) {
    const parsed = parseValidator(p);
    if (!parsed || seen.has(parsed.id)) continue;
    seen.add(parsed.id);
    out.push(parsed.compressed);
  }
  return out;
}

/**
 * The listed entry for `pubkey`, matched by signing key rather than spelling.
 * @param {string[]} validatorPubkeys
 * @param {*} pubkey
 * @returns {string|null}
 */
function findValidatorEntry (validatorPubkeys, pubkey) {
  const id = federationValidatorId(pubkey);
  if (!id) return null;
  for (const p of (Array.isArray(validatorPubkeys) ? validatorPubkeys : [])) {
    if (typeof p === 'string' && federationValidatorId(p) === id) return p;
  }
  return null;
}

/**
 * The witness entry signed by `pubkey`, wherever the witness spelled its id.
 * @param {Object} signatures witness `signatures` map keyed by validator id
 * @param {*} pubkey
 * @returns {*} the entry, or undefined
 */
function witnessSignatureFor (signatures, pubkey) {
  if (!signatures || typeof signatures !== 'object') return undefined;
  if (typeof pubkey === 'string' && Object.prototype.hasOwnProperty.call(signatures, pubkey)) {
    return signatures[pubkey];
  }
  const id = federationValidatorId(pubkey);
  if (!id) return undefined;
  for (const k of Object.keys(signatures)) {
    if (federationValidatorId(k) === id) return signatures[k];
  }
  return undefined;
}

/**
 * Explicit threshold as configured (rounded up), or NaN when unset.
 * @param {*} threshold
 * @returns {number}
 * @private
 */
function explicitThreshold (threshold) {
  const t = (threshold == null || threshold === '') ? NaN : Number(threshold);
  return (Number.isFinite(t) && t >= 1) ? Math.ceil(t) : NaN;
}

/**
 * k for a k-of-n federation. An explicit threshold wins (rounded up) but is
 * clamped to the number of distinct validators, so an unsatisfiable k never
 * stalls sealing; when none is set, a strict majority of the distinct
 * validators (1 when empty). Use {@link federationThresholdExceedsValidators}
 * to warn about a clamp.
 * @param {*} threshold configured value (`null` / `''` / non-positive = unset)
 * @param {string[]} validatorPubkeys
 * @returns {number}
 */
function resolveFederationThreshold (threshold, validatorPubkeys) {
  const n = uniqueValidatorPubkeys(validatorPubkeys).length;
  const t = explicitThreshold(threshold);
  if (Number.isFinite(t)) return n > 0 ? Math.min(t, n) : t;
  return Math.floor(n / 2) + 1;
}

/**
 * Whether an explicit threshold asks for more signatures than there are
 * distinct validators (and so is clamped by {@link resolveFederationThreshold}).
 * @param {*} threshold
 * @param {string[]} validatorPubkeys
 * @returns {boolean}
 */
function federationThresholdExceedsValidators (threshold, validatorPubkeys) {
  const n = uniqueValidatorPubkeys(validatorPubkeys).length;
  const t = explicitThreshold(threshold);
  return n > 0 && Number.isFinite(t) && t > n;
}

module.exports = {
  federationValidatorId,
  uniqueValidatorPubkeys,
  normalizeFederationValidators,
  findValidatorEntry,
  witnessSignatureFor,
  resolveFederationThreshold,
  federationThresholdExceedsValidators
};
