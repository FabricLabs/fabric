/**
 * BIP-69 lexicographical ordering of transaction inputs and outputs.
 *
 * Inputs: previous output hash in **display** (reversed-from-wire) byte order,
 * then previous output index. Outputs: amount (uint64) then scriptPubKey bytes.
 *
 * Does not mutate the input arrays. Does not change signature hash types;
 * callers still sign after sorting.
 *
 * Also hosts BIP-49 nested-SegWit payment helpers (`p2shP2wpkhPayment`) so
 * that slice does not add a PR file. Path templates stay in `constants.js`;
 * default funds path remains BIP-44 `m/44'/0'/0'/0/0`.
 *
 * @fileoverview BIP-69 vin/vout lexicographic sort + BIP-49 P2WPKH-in-P2SH.
 * @module functions/bip69
 */
'use strict';

const { payments, networks } = require('bitcoinjs-lib');

/**
 * @param {Buffer|Uint8Array|string} value
 * @param {string} [encoding]
 * @returns {Buffer}
 * @private
 */
function asBuffer (value, encoding) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === 'string') return Buffer.from(value, encoding || 'hex');
  throw new TypeError('expected Buffer, Uint8Array, or hex string');
}

/**
 * 32-byte previous-output hash in BIP-69 comparison order (display txid bytes).
 *
 * - `txid` / `txId`: 64-char display hex (the form used in BIP-69 examples).
 * - `hash` Buffer: bitcoinjs-lib wire/internal hash (little-endian on the wire);
 *   reversed to display order unless `hashIsDisplay` is true.
 *
 * @param {Object} input
 * @returns {Buffer}
 */
function prevoutHashDisplay (input) {
  if (!input || typeof input !== 'object') throw new TypeError('input is required');
  const txid = input.txid != null ? input.txid : input.txId;
  if (txid != null && String(txid).length) {
    const hex = String(txid).trim().toLowerCase().replace(/^0x/, '');
    if (!/^[0-9a-f]{64}$/.test(hex)) {
      throw new Error('txid must be 32-byte hex (display order)');
    }
    return Buffer.from(hex, 'hex');
  }
  if (input.hash == null) throw new Error('input requires txid or hash');
  const hash = asBuffer(input.hash);
  if (hash.length !== 32) throw new Error('prevout hash must be 32 bytes');
  if (input.hashIsDisplay) return Buffer.from(hash);
  return Buffer.from(hash).reverse();
}

/**
 * Previous output index (`vout` or bitcoinjs `index`).
 *
 * @param {Object} input
 * @returns {number}
 */
/** Bitcoin prevout index is a 32-bit unsigned integer (Codacy no-loss-of-precision). */
const UINT32_MAX = Number('4294967295');

function prevoutIndex (input) {
  const v = input.vout != null ? input.vout : input.index;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > UINT32_MAX) {
    throw new RangeError('prevout index must be a uint32');
  }
  return n;
}

/**
 * @param {Object} a
 * @param {Object} b
 * @returns {number}
 */
function compareInputs (a, b) {
  const ha = prevoutHashDisplay(a);
  const hb = prevoutHashDisplay(b);
  const cmp = Buffer.compare(ha, hb);
  if (cmp !== 0) return cmp;
  return prevoutIndex(a) - prevoutIndex(b);
}

/**
 * @param {Object} output
 * @returns {number}
 * @private
 */
function outputValue (output) {
  const raw = output.value != null ? output.value : output.amount;
  if (typeof raw === 'bigint') {
    if (raw < 0n || raw > 0xffffffffffffffffn) {
      throw new RangeError('output value must fit in uint64');
    }
    return Number(raw);
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > Number.MAX_SAFE_INTEGER) {
    throw new RangeError('output value must be a non-negative integer');
  }
  return n;
}

/**
 * @param {Object} output
 * @returns {Buffer}
 * @private
 */
function outputScript (output) {
  const s = output.script != null
    ? output.script
    : (output.scriptPubKey != null ? output.scriptPubKey : output.scriptpubkey);
  if (s == null) throw new Error('output requires script / scriptPubKey');
  return asBuffer(s);
}

/**
 * @param {Object} a
 * @param {Object} b
 * @returns {number}
 */
function compareOutputs (a, b) {
  const va = outputValue(a);
  const vb = outputValue(b);
  if (va !== vb) return va < vb ? -1 : 1;
  return Buffer.compare(outputScript(a), outputScript(b));
}

/**
 * @param {Array<Object>} inputs
 * @returns {Array<Object>}
 */
function sortInputs (inputs) {
  if (!Array.isArray(inputs)) throw new TypeError('inputs must be an array');
  const copy = inputs.slice();
  for (let i = 0; i < copy.length; i++) {
    prevoutHashDisplay(copy[i]);
    prevoutIndex(copy[i]);
  }
  return copy.sort(compareInputs);
}

/**
 * @param {Array<Object>} outputs
 * @returns {Array<Object>}
 */
function sortOutputs (outputs) {
  if (!Array.isArray(outputs)) throw new TypeError('outputs must be an array');
  const copy = outputs.slice();
  for (let i = 0; i < copy.length; i++) {
    outputValue(copy[i]);
    outputScript(copy[i]);
  }
  return copy.sort(compareOutputs);
}

/**
 * Sort a bitcoinjs-lib-like `{ ins, outs }` transaction in place on copies.
 *
 * @param {Object} tx
 * @param {Array<Object>} [tx.ins]
 * @param {Array<Object>} [tx.outs]
 * @returns {{ ins: Array<Object>, outs: Array<Object> }}
 */
function sortTransaction (tx) {
  const ins = sortInputs((tx && tx.ins) || []);
  const outs = sortOutputs((tx && (tx.outs || tx.outputs)) || []);
  return { ins, outs };
}

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
  compareInputs,
  compareOutputs,
  prevoutHashDisplay,
  sortInputs,
  sortOutputs,
  sortTransaction,
  p2shP2wpkhPayment,
  p2shP2wpkhAddress
};
