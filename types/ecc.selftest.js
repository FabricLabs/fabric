'use strict';

/**
 * Lightweight ECC sanity check for real browsers (see types/ecc.js).
 * @param {object} ecc — exports from types/ecc.js
 */
module.exports = function runFabricEccSelftest (ecc) {
  try {
    const priv = Buffer.alloc(32, 0);
    priv[31] = 1;
    if (!ecc.isPrivate(priv)) {
      console.error('[fabric/ecc] self-test: isPrivate(1) expected true');
      return;
    }
    const pub = ecc.pointFromScalar(priv, true);
    if (!pub || pub.length < 33) {
      console.error('[fabric/ecc] self-test: pointFromScalar failed');
      return;
    }
    const msg = Buffer.alloc(32, 7);
    const sig = ecc.sign(msg, priv);
    if (!ecc.verify(msg, pub, sig)) {
      console.error('[fabric/ecc] self-test: verify failed');
    }
  } catch (e) {
    console.error('[fabric/ecc] self-test failed:', e && e.message ? e.message : e);
  }
};
