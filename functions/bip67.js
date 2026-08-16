/**
 * BIP-67 lexicographic compressed-pubkey ordering for deterministic multisig
 * redeem scripts (and the same byte order used by Fabric Taproot k-of-n leaves).
 *
 * @fileoverview BIP-67 pubkey sort.
 * @module functions/bip67
 */
'use strict';

/**
 * @param {Buffer|Uint8Array|string} key
 * @returns {Buffer}
 * @private
 */
function asCompressedPubkey (key) {
  let buf;
  if (Buffer.isBuffer(key)) buf = key;
  else if (key instanceof Uint8Array) buf = Buffer.from(key);
  else if (typeof key === 'string') {
    const hex = String(key).trim().toLowerCase().replace(/^0x/, '');
    if (!/^(02|03)[0-9a-f]{64}$/.test(hex)) {
      throw new Error('BIP67 pubkey must be 33-byte compressed hex');
    }
    buf = Buffer.from(hex, 'hex');
  } else {
    throw new TypeError('BIP67 pubkey must be Buffer, Uint8Array, or hex string');
  }
  if (buf.length !== 33 || (buf[0] !== 0x02 && buf[0] !== 0x03)) {
    throw new Error('BIP67 pubkey must be a 33-byte compressed secp256k1 key');
  }
  return buf;
}

/**
 * @param {Buffer|Uint8Array|string} a
 * @param {Buffer|Uint8Array|string} b
 * @returns {number}
 */
function comparePubkeysBip67 (a, b) {
  return Buffer.compare(asCompressedPubkey(a), asCompressedPubkey(b));
}

/**
 * Return a new array of compressed pubkey Buffers in BIP-67 order.
 *
 * @param {Array<Buffer|Uint8Array|string>} keys
 * @returns {Array<Buffer>}
 */
function sortPubkeysBip67 (keys) {
  if (!Array.isArray(keys)) throw new TypeError('keys must be an array');
  return keys.map(asCompressedPubkey).sort(comparePubkeysBip67);
}

module.exports = {
  comparePubkeysBip67,
  sortPubkeysBip67
};
