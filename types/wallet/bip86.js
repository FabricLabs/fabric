'use strict';

/**
 * @fileoverview BIP-86 single-key Taproot outputs: key path only, with the
 * output key `Q = P + int(taggedHash('TapTweak', P_x))·G` (no script tree).
 * Wallet keys live on `m/86'/B'/n'/<change>/<index>`, B = 0 on mainnet and 1
 * elsewhere.
 *
 * @module types/wallet/bip86
 */

const ecc = require('../ecc');
const Hash256 = require('../hash256');
const { encodeSegwitAddress } = require('../bech32/bech32');
const { bitcoinPurposeDerivationPath } = require('../../constants');

const BIP86_PURPOSE = 86;

/**
 * x-only internal key of a compressed or x-only public key.
 * @param {Buffer|Uint8Array|string} pubkey 33-byte compressed or 32-byte x-only (hex allowed).
 * @returns {Buffer} 32 bytes.
 */
function internalKey (pubkey) {
  const bytes = typeof pubkey === 'string' ? Buffer.from(pubkey, 'hex') : Buffer.from(pubkey);
  if (bytes.length === 32) return bytes;
  if (bytes.length === 33 && (bytes[0] === 0x02 || bytes[0] === 0x03)) return bytes.subarray(1);
  throw new TypeError('pubkey must be 33-byte compressed or 32-byte x-only');
}

/**
 * BIP-86 output key: the internal key tweaked by `taggedHash('TapTweak', P_x)`.
 * @param {Buffer|Uint8Array|string} pubkey Internal public key.
 * @returns {Buffer} 32-byte x-only output key.
 */
function outputKey (pubkey) {
  const p = internalKey(pubkey);
  const tweaked = ecc.xOnlyPointAddTweak(p, Hash256.tagged('TapTweak', p));
  if (!tweaked) throw new Error('invalid Taproot tweak');
  return Buffer.from(tweaked.xOnlyPubkey);
}

/**
 * Segwit v1 (bech32m) address of a BIP-86 internal key.
 * @param {Buffer|Uint8Array|string} pubkey Internal public key.
 * @param {{ bech32: string }} network bitcoinjs-lib network parameters.
 * @returns {string}
 */
function address (pubkey, network) {
  if (!network || typeof network.bech32 !== 'string') throw new TypeError('network with a bech32 prefix required');
  const encoded = encodeSegwitAddress(network.bech32, 1, outputKey(pubkey));
  if (!encoded) throw new Error('invalid Taproot program');
  return encoded;
}

/**
 * BIP-86 derivation path `m/86'/B'/account'/change/index`.
 * @param {number} [account=0]
 * @param {number} [change=0]
 * @param {number} [index=0]
 * @param {string|number} [network] Network name or coin type.
 * @returns {string}
 */
function path (account = 0, change = 0, index = 0, network) {
  return bitcoinPurposeDerivationPath(BIP86_PURPOSE, account, change, index, network);
}

module.exports = {
  BIP86_PURPOSE,
  internalKey,
  outputKey,
  address,
  path
};
