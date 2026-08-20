/**
 * BIP-49 nested SegWit: P2WPKH redeem script wrapped in P2SH (`3…` / `2…`).
 *
 * Path templates live in `constants.js` (`m/49'/0'/account'/{0|1}/index`).
 * This module is the **payment** helper those paths are meant to feed.
 * Fabric’s default funds path remains BIP-44 `m/44'/0'/0'/0/0`.
 *
 * @fileoverview BIP-49 P2WPKH-nested-in-P2SH addresses.
 * @module functions/bip49
 */
'use strict';

const { payments, networks } = require('bitcoinjs-lib');

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
      throw new Error('BIP49 pubkey must be 33-byte compressed hex');
    }
    buf = Buffer.from(hex, 'hex');
  } else {
    throw new TypeError('BIP49 pubkey must be Buffer, Uint8Array, or hex string');
  }
  if (buf.length !== 33 || (buf[0] !== 0x02 && buf[0] !== 0x03)) {
    throw new Error('BIP49 pubkey must be a 33-byte compressed secp256k1 key');
  }
  return buf;
}

/**
 * bitcoinjs `payments.p2sh({ redeem: p2wpkh })` for a compressed pubkey.
 *
 * @param {Object} opts
 * @param {Buffer|Uint8Array|string} opts.pubkey compressed secp256k1 public key
 * @param {Object} [opts.network] bitcoinjs network (default mainnet)
 * @returns {Object} bitcoinjs payment (`address`, `output`, `redeem`, …)
 */
function p2shP2wpkhPayment (opts = {}) {
  const pubkey = asCompressedPubkey(opts.pubkey);
  const network = opts.network || networks.bitcoin;
  const redeem = payments.p2wpkh({ pubkey, network });
  return payments.p2sh({ redeem, network });
}

/**
 * BIP-49 nested-SegWit address for a compressed pubkey.
 *
 * @param {Object} opts
 * @param {Buffer|Uint8Array|string} opts.pubkey
 * @param {Object} [opts.network]
 * @returns {string}
 */
function p2shP2wpkhAddress (opts = {}) {
  const pay = p2shP2wpkhPayment(opts);
  if (!pay.address) throw new Error('BIP49 address derivation failed');
  return pay.address;
}

module.exports = {
  p2shP2wpkhPayment,
  p2shP2wpkhAddress
};
