/**
 * BIP-69 lexicographical ordering of transaction inputs and outputs.
 *
 * Inputs: previous output hash in **display** (reversed-from-wire) byte order,
 * then previous output index. Outputs: amount (uint64) then scriptPubKey bytes.
 *
 * Does not mutate the input arrays. Does not change signature hash types;
 * callers still sign after sorting.
 *
 * @fileoverview BIP-69 vin/vout lexicographic sort.
 * @module functions/bip69
 */
'use strict';

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
function prevoutIndex (input) {
  const v = input.vout != null ? input.vout : input.index;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) {
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

module.exports = {
  compareInputs,
  compareOutputs,
  prevoutHashDisplay,
  sortInputs,
  sortOutputs,
  sortTransaction
};
