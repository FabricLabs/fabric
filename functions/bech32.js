/**
 * Bech32 (BIP 173) and Bech32m (BIP 350) — human-readable encoding for witness programs.
 *
 * 1. **`FABRIC_NATIVE_BECH32=1`** and `fabric.node` built with `native/sipa/segwit_addr.c`
 *    → Pieter Wuille’s **C** reference ([sipa/bech32](https://github.com/sipa/bech32) `ref/c/`) via {@link ./fabricNativeAccel.js}.
 * 2. Else Wuille’s **JavaScript** reference in {@link ./sipa/bech32.js} and {@link ./sipa/segwit_addr.js}
 *    (Node and browser bundles alike; strings over 90 characters are refused).
 *
 * @module functions/bech32
 */
'use strict';

const fabricNativeAccel = require('./fabricNativeAccel');
const sipa = require('./sipa/bech32');
const sipaSegwit = require('./sipa/segwit_addr');

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

function useNativeCBech32 () {
  return fabricNativeAccel.isNativeBech32Callable();
}

/**
 * Convert bits (BIP 173 convertBits).
 * @param {number[]} data
 * @param {number} fromBits
 * @param {number} toBits
 * @param {boolean} pad
 * @returns {number[]|null}
 */
function convertBits (data, fromBits, toBits, pad) {
  let acc = 0;
  let bits = 0;
  const maxv = (1 << toBits) - 1;
  const result = [];
  for (let i = 0; i < data.length; i++) {
    const value = data[i];
    if (value < 0 || (value >> fromBits) !== 0) return null;
    acc = (acc << fromBits) | value;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      result.push((acc >> bits) & maxv);
    }
  }
  if (pad) {
    if (bits > 0) result.push((acc << (toBits - bits)) & maxv);
  } else if (bits >= fromBits || ((acc << (toBits - bits)) & maxv) !== 0) {
    return null;
  }
  return result;
}

/**
 * @param {Buffer|Uint8Array} bytes
 * @returns {number[]}
 */
function toWords (bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const w = convertBits(Array.from(u8), 8, 5, true);
  if (!w) throw new Error('bech32.toWords: invalid data');
  return w;
}

/**
 * @param {number[]} words
 * @returns {Buffer}
 */
function fromWords (words) {
  const res = convertBits(words, 5, 8, false);
  if (!res) throw new Error('bech32.fromWords: invalid padding');
  return Buffer.from(res);
}

function assertEncodeSpec (spec) {
  if (spec !== 'bech32' && spec !== 'bech32m') {
    throw new TypeError('bech32.encode: spec must be "bech32" or "bech32m"');
  }
}

function assertEncodeHrp (hrp) {
  if (typeof hrp !== 'string' || hrp.length < 1 || hrp.length > 83) {
    throw new TypeError('bech32.encode: hrp must be a non-empty string (1..83 chars)');
  }
  for (let i = 0; i < hrp.length; i++) {
    const c = hrp.charCodeAt(i);
    if (c < 33 || c > 126) {
      throw new TypeError('bech32.encode: hrp must contain printable ASCII only');
    }
  }
}

function assertEncodeWords (words) {
  if (!Array.isArray(words)) {
    throw new TypeError('bech32.encode: words must be an array of 5-bit integers');
  }
  for (let i = 0; i < words.length; i++) {
    const v = words[i];
    if (!Number.isInteger(v) || v < 0 || v > 31) {
      throw new TypeError(`bech32.encode: invalid word at index ${i}`);
    }
  }
}

/**
 * @param {string} hrp
 * @param {number[]} words — 5-bit groups (0–31)
 * @param {'bech32'|'bech32m'} spec
 * @returns {string}
 */
function encode (hrp, words, spec) {
  assertEncodeHrp(hrp);
  assertEncodeWords(words);
  assertEncodeSpec(spec);
  if (useNativeCBech32()) {
    const out = fabricNativeAccel.bech32Encode(hrp, words, spec);
    if (out != null) return out;
  }
  const enc = spec === 'bech32m' ? sipa.encodings.BECH32M : sipa.encodings.BECH32;
  return sipa.encode(hrp, words, enc);
}

/**
 * @param {string} str
 * @returns {{ hrp: string, words: number[], spec: 'bech32'|'bech32m' }}
 */
function decode (str) {
  if (typeof str !== 'string') throw new Error('Invalid bech32 string');
  if (useNativeCBech32()) {
    const out = fabricNativeAccel.bech32Decode(str);
    if (out != null) return out;
  }
  let d = sipa.decode(str, sipa.encodings.BECH32);
  let spec = 'bech32';
  if (d === null) {
    d = sipa.decode(str, sipa.encodings.BECH32M);
    spec = 'bech32m';
  }
  if (d === null) throw new Error('Invalid bech32 string');
  return { hrp: d.hrp, words: d.data, spec };
}

/**
 * Encode a native segwit address (BIP 173 / 350), e.g. `bc` + v0 + 20/32-byte program.
 * @param {string} hrp — e.g. `'bc'`, `'tb'`, `'bcrt'`
 * @param {number} version — witness version 0–16
 * @param {Buffer|Uint8Array|number[]} program — witness program bytes
 * @returns {string|null} address or null if invalid
 */
function encodeSegwitAddress (hrp, version, program) {
  try {
    assertEncodeHrp(hrp);
  } catch {
    return null;
  }
  if (!Number.isInteger(version) || version < 0 || version > 16) return null;
  let buf;
  if (Buffer.isBuffer(program)) {
    buf = program;
  } else if (program instanceof Uint8Array) {
    buf = Buffer.from(program);
  } else if (Array.isArray(program)) {
    if (!program.every((v) => Number.isInteger(v) && v >= 0 && v <= 255)) return null;
    buf = Buffer.from(program);
  } else {
    return null;
  }
  if (buf.length < 2 || buf.length > 40) return null;
  if (version === 0 && buf.length !== 20 && buf.length !== 32) return null;
  if (useNativeCBech32()) {
    return fabricNativeAccel.segwitAddrEncode(hrp, version, buf) || null;
  }
  return sipaSegwit.encode(hrp, version, Array.from(buf)) || null;
}

/**
 * Decode a native segwit address; returns null if invalid.
 * @param {string} hrp
 * @param {string} addr
 * @returns {{ version: number, program: Buffer }|null}
 */
function decodeSegwitAddress (hrp, addr) {
  if (useNativeCBech32()) {
    return fabricNativeAccel.segwitAddrDecode(hrp, addr);
  }
  const d = sipaSegwit.decode(hrp, addr);
  if (!d) return null;
  return { version: d.version, program: Buffer.from(d.program) };
}

module.exports = {
  CHARSET,
  encode,
  decode,
  toWords,
  fromWords,
  convertBits,
  encodeSegwitAddress,
  decodeSegwitAddress
};
