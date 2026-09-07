'use strict';

/**
 * Whether a Key-like object has private material safe for Schnorr / AMP signing.
 * Watch-only Key instances still expose `sign` / `signSchnorr` but throw without `.private`.
 *
 * @module functions/keyHasPrivateSigningMaterial
 * @param {object|null|undefined} signKey
 * @returns {boolean}
 */
function keyHasPrivateSigningMaterial (signKey) {
  if (!signKey || signKey.private == null) return false;
  if (Buffer.isBuffer(signKey.private)) return signKey.private.length > 0;
  if (typeof signKey.private === 'string') return String(signKey.private).trim().length > 0;
  return Boolean(signKey.private);
}

module.exports = keyHasPrivateSigningMaterial;
module.exports.keyHasPrivateSigningMaterial = keyHasPrivateSigningMaterial;
