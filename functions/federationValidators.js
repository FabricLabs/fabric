'use strict';

/**
 * Federation validator sets: one entry per signing key, and the default
 * k-of-n threshold when none is configured.
 *
 * @fileoverview Federation validator set helpers.
 * @module functions/federationValidators
 */

const { normalizePeerPubkeyHex } = require('./contractPublishAuthority');

/**
 * First entry per signing key. BIP340 verifies over the x coordinate only, so
 * `02…` / `03…` / x-only / mixed-case spellings of one key count once.
 * @param {string[]} validatorPubkeys
 * @returns {string[]} entries as given, minus repeats
 */
function uniqueValidatorPubkeys (validatorPubkeys) {
  const seen = new Set();
  const out = [];
  for (const p of (Array.isArray(validatorPubkeys) ? validatorPubkeys : [])) {
    if (typeof p !== 'string' || !p) continue;
    const id = normalizePeerPubkeyHex(p);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(p);
  }
  return out;
}

/**
 * k for a k-of-n federation. An explicit threshold wins (rounded up); when
 * none is set, a strict majority of the distinct validators (1 when empty).
 * @param {*} threshold configured value (`null` / `''` / non-positive = unset)
 * @param {string[]} validatorPubkeys
 * @returns {number}
 */
function resolveFederationThreshold (threshold, validatorPubkeys) {
  const t = (threshold == null || threshold === '') ? NaN : Number(threshold);
  if (Number.isFinite(t) && t >= 1) return Math.ceil(t);
  const n = uniqueValidatorPubkeys(validatorPubkeys).length;
  return Math.floor(n / 2) + 1;
}

module.exports = {
  uniqueValidatorPubkeys,
  resolveFederationThreshold
};
