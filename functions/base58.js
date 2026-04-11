/**
 * Bitcoin Base58 (no checksum) and Base58Check (double-SHA256 4-byte suffix).
 *
 * Raw alphabet matches Bitcoin Core / BIP-0173 base58 (no 0, O, I, l).
 * Check uses @noble/hashes (same as BIP-340 paths).
 *
 * @module functions/base58
 */
'use strict';

const { sha256 } = require('@noble/hashes/sha2.js');
const { toUint8Strict } = require('./bytes');

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

const DECODE_MAP = (() => {
  const m = new Map();
  for (let i = 0; i < ALPHABET.length; i++) m.set(ALPHABET.charCodeAt(i), i);
  return m;
})();

/**
 * @param {Buffer|Uint8Array} source
 * @returns {string}
 */
function encode (source) {
  const bytes = toUint8Strict(source);
  if (bytes.length === 0) return '';

  const digits = [0];
  for (let i = 0; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }

  let out = '';
  for (let k = 0; k < bytes.length - 1 && bytes[k] === 0; k++) {
    out += ALPHABET[0];
  }
  for (let q = digits.length - 1; q >= 0; q--) {
    out += ALPHABET[digits[q]];
  }
  return out;
}

/**
 * @param {string} str
 * @returns {Buffer}
 */
function decode (str) {
  if (typeof str !== 'string') throw new TypeError('base58.decode expects a string');
  if (str.length === 0) return Buffer.alloc(0);

  const bytes = [0];
  for (let i = 0; i < str.length; i++) {
    const val = DECODE_MAP.get(str.charCodeAt(i));
    if (val === undefined) throw new Error(`Invalid base58 character: ${str[i]}`);

    let carry = val;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  // Leading `1` characters map to leading zero bytes (same rule as bitcoinjs/bs58).
  for (let k = 0; k < str.length - 1 && str.charCodeAt(k) === 49 /* '1' */; k++) {
    bytes.push(0);
  }

  return Buffer.from(bytes.reverse());
}

function checksum (payload) {
  const h = sha256(sha256(payload));
  return h.subarray(0, 4);
}

/**
 * @param {Buffer|Uint8Array} payload — version byte(s) + data (checksum appended)
 * @returns {string}
 */
function encodeCheck (payload) {
  const p = toUint8Strict(payload);
  const cs = checksum(p);
  const combined = new Uint8Array(p.length + 4);
  combined.set(p, 0);
  combined.set(cs, p.length);
  return encode(combined);
}

/**
 * @param {string} str
 * @returns {Buffer} payload only (no checksum bytes)
 */
function decodeCheck (str) {
  const buf = decode(str);
  if (buf.length < 4) throw new Error('base58check data too short');

  const payload = buf.subarray(0, buf.length - 4);
  const cs = buf.subarray(buf.length - 4);
  const expect = Buffer.from(checksum(payload));
  if (cs.length !== expect.length || !cs.equals(expect)) {
    throw new Error('Invalid base58 checksum');
  }
  return Buffer.from(payload);
}

module.exports = {
  encode,
  decode,
  encodeCheck,
  decodeCheck,
  ALPHABET,
  /** @deprecated Use {@link module:functions/bytes.toUint8Strict} — alias kept for compatibility */
  toU8: toUint8Strict
};
