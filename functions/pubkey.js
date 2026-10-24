'use strict';

/**
 * secp256k1 public key hex forms: compressed (`02`/`03` || x, 66 hex) and
 * BIP-340 x-only (64 hex). Both forms of one key compare equal via
 * {@link pubkeysMatch}.
 *
 * @module functions/pubkey
 */

const { secp256k1 } = require('@noble/curves/secp256k1.js');

/**
 * Normalize to lowercase 64-hex x-only (accepts compressed 02/03||x).
 * @param {*} hex
 * @returns {string|null}
 */
function pubkeyXOnly (hex) {
  const s = String(hex || '').toLowerCase().replace(/^0x/, '');
  if (/^0[23][0-9a-f]{64}$/.test(s)) return s.slice(2);
  if (/^[0-9a-f]{64}$/.test(s)) return s;
  return null;
}

/**
 * Compressed 33-byte pubkey hex from x-only or compressed input.
 * @param {*} hex
 * @returns {string|null}
 */
function pubkeyCompressed (hex) {
  const s = String(hex || '').toLowerCase().replace(/^0x/, '');
  if (/^0[23][0-9a-f]{64}$/.test(s)) return s;
  const x = pubkeyXOnly(s);
  if (!x) return null;
  const Point = secp256k1.ProjectivePoint || secp256k1.Point;
  for (const prefix of ['02', '03']) {
    const cand = prefix + x;
    try {
      if (Point && typeof Point.fromHex === 'function') {
        Point.fromHex(cand);
        return cand;
      }
      if (Point && typeof Point.fromBytes === 'function') {
        Point.fromBytes(Buffer.from(cand, 'hex'));
        return cand;
      }
      // Last resort: ECDH probe with fixed priv (valid curve scalar).
      secp256k1.getSharedSecret(Buffer.alloc(32, 1), Buffer.from(cand, 'hex'), true);
      return cand;
    } catch (_) { /* try other parity */ }
  }
  throw new Error('pubkeyCompressed: x-only does not lift to a curve point');
}

/**
 * Same x-only key, whichever form each side is in.
 * @param {*} a
 * @param {*} b
 * @returns {boolean}
 */
function pubkeysMatch (a, b) {
  const xa = pubkeyXOnly(a);
  const xb = pubkeyXOnly(b);
  return !!(xa && xb && xa === xb);
}

module.exports = {
  pubkeyXOnly,
  pubkeyCompressed,
  pubkeysMatch
};
