/**
 * Bech32 (BIP 173) and Bech32m (BIP 350) — human-readable encoding for witness programs.
 *
 * **Node.js (priority):**
 * 1. **`FABRIC_NATIVE_BECH32=1`** and `fabric.node` built with `native/sipa/segwit_addr.c`
 *    → Pieter Wuille’s **C** reference ([sipa/bech32](https://github.com/sipa/bech32) `ref/c/`) via {@link ./fabricNativeAccel.js}.
 * 2. Else Wuille’s **JavaScript** reference in {@link ./sipa/bech32.js}.
 * 3. Else, or when **`FABRIC_PURE_BECH32=1`**, the bundled pure-JS codec in this file.
 *
 * @module functions/bech32
 */
'use strict';

const fabricNativeAccel = require('./fabricNativeAccel');
const { u32be } = require('./bytes');

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

const CHARSET_REV = (() => {
  const m = new Map();
  for (let i = 0; i < CHARSET.length; i++) m.set(CHARSET.charCodeAt(i), i);
  return m;
})();

const BECH32_CONST = 1;
const BECH32M_CONST = u32be(43, 200, 48, 163);

function isNodeRuntime () {
  return typeof process !== 'undefined' && process.versions && typeof process.versions.node === 'string';
}

function useNativeCBech32 () {
  return fabricNativeAccel.isNativeBech32Callable();
}

function useSipaReferenceOnNode () {
  if (!isNodeRuntime()) return false;
  if (typeof process.env === 'object' && process.env && process.env.FABRIC_PURE_BECH32 === '1') {
    return false;
  }
  return true;
}

function loadSipaBech32 () {
  return require('./sipa/bech32');
}

function loadSipaSegwit () {
  return require('./sipa/segwit_addr');
}

function polymod (values) {
  const GEN = [
    u32be(59, 106, 87, 178),
    u32be(38, 80, 142, 109),
    u32be(30, 161, 25, 250),
    u32be(61, 66, 51, 221),
    u32be(42, 20, 98, 179)
  ];
  const mask25 = (1 << 25) - 1;
  let chk = 1;
  for (let i = 0; i < values.length; ++i) {
    const top = chk >> 25;
    chk = ((chk & mask25) << 5) ^ values[i];
    for (let j = 0; j < 5; ++j) {
      if ((top >> j) & 1) chk ^= GEN[j];
    }
  }
  return chk;
}

function hrpExpand (hrp) {
  const ret = [];
  for (let i = 0; i < hrp.length; i++) ret.push(hrp.charCodeAt(i) >> 5);
  ret.push(0);
  for (let i = 0; i < hrp.length; i++) ret.push(hrp.charCodeAt(i) & 31);
  return ret;
}

function createChecksum (hrp, data, constValue) {
  const values = hrpExpand(hrp).concat(data).concat([0, 0, 0, 0, 0, 0]);
  const mod = polymod(values) ^ constValue;
  const ret = [];
  for (let i = 0; i < 6; ++i) {
    ret.push((mod >> (5 * (5 - i))) & 31);
  }
  return ret;
}

function verifyChecksum (hrp, data) {
  return polymod(hrpExpand(hrp).concat(data));
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

function encodePure (hrp, words, spec) {
  assertEncodeHrp(hrp);
  assertEncodeWords(words);
  assertEncodeSpec(spec);
  const c = spec === 'bech32m' ? BECH32M_CONST : BECH32_CONST;
  const chk = createChecksum(hrp, words, c);
  const combined = words.concat(chk);
  let out = hrp + '1';
  for (let i = 0; i < combined.length; i++) {
    out += CHARSET[combined[i]];
  }
  return out;
}

function encodeSipa (hrp, words, spec) {
  const sipa = loadSipaBech32();
  const enc = spec === 'bech32m' ? sipa.encodings.BECH32M : sipa.encodings.BECH32;
  return sipa.encode(hrp, words, enc);
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
  if (useSipaReferenceOnNode()) return encodeSipa(hrp, words, spec);
  return encodePure(hrp, words, spec);
}

function decodePure (str) {
  if (typeof str !== 'string' || str.length < 8) throw new Error('Invalid bech32 string');
  const lower = str.toLowerCase();
  const upper = str.toUpperCase();
  if (str !== lower && str !== upper) throw new Error('Mixed-case bech32');
  const s = lower;
  const pos = s.lastIndexOf('1');
  if (pos === -1 || pos === 0) throw new Error('Missing separator');
  const hrp = s.slice(0, pos);
  const dataPart = s.slice(pos + 1);
  if (dataPart.length < 6) throw new Error('Checksum too short');
  const data = [];
  for (let i = 0; i < dataPart.length; i++) {
    const c = dataPart.charCodeAt(i);
    const v = CHARSET_REV.get(c);
    if (v === undefined) throw new Error(`Invalid bech32 character: ${dataPart[i]}`);
    data.push(v);
  }
  const chk = verifyChecksum(hrp, data);
  if (chk === BECH32_CONST) return { hrp, words: data.slice(0, -6), spec: 'bech32' };
  if (chk === BECH32M_CONST) return { hrp, words: data.slice(0, -6), spec: 'bech32m' };
  throw new Error('Invalid bech32 checksum');
}

function decodeSipa (str) {
  const sipa = loadSipaBech32();
  let d = sipa.decode(str, sipa.encodings.BECH32);
  let spec = 'bech32';
  if (d === null) {
    d = sipa.decode(str, sipa.encodings.BECH32M);
    spec = 'bech32m';
  }
  if (d === null) throw new Error('Invalid bech32 checksum');
  return { hrp: d.hrp, words: d.data, spec };
}

/**
 * @param {string} str
 * @returns {{ hrp: string, words: number[], spec: 'bech32'|'bech32m' }}
 */
function decode (str) {
  if (useNativeCBech32()) {
    const out = fabricNativeAccel.bech32Decode(str);
    if (out != null) return out;
  }
  if (useSipaReferenceOnNode()) return decodeSipa(str);
  return decodePure(str);
}

/**
 * Encode a native segwit address (BIP 173 / 350), e.g. `bc` + v0 + 20/32-byte program.
 * On Node, uses {@link ./sipa/segwit_addr.js}; otherwise the same rules via {@link #encode}.
 * @param {string} hrp — e.g. `'bc'`, `'tb'`, `'bcrt'`
 * @param {number} version — witness version 0–16
 * @param {Buffer|Uint8Array|number[]} program — witness program bytes
 * @returns {string|null} address or null if invalid (sipa reference behavior on Node)
 */
function encodeSegwitAddress (hrp, version, program) {
  try {
    assertEncodeHrp(hrp);
  } catch {
    return null;
  }
  if (!Number.isInteger(version) || version < 0 || version > 16) return null;
  let buf;
  try {
    if (Buffer.isBuffer(program)) {
      buf = program;
    } else if (program instanceof Uint8Array) {
      buf = Buffer.from(program);
    } else if (Array.isArray(program)) {
      const arr = [];
      for (let i = 0; i < program.length; i++) {
        const v = program[i];
        if (!Number.isInteger(v) || v < 0 || v > 255) return null;
        arr.push(v);
      }
      buf = Buffer.from(arr);
    } else {
      return null;
    }
  } catch {
    return null;
  }
  if (buf.length < 2 || buf.length > 40) return null;
  if (version === 0 && buf.length !== 20 && buf.length !== 32) return null;
  if (useNativeCBech32()) {
    const out = fabricNativeAccel.segwitAddrEncode(hrp, version, buf);
    if (out == null) return null;
    return out;
  }
  if (useSipaReferenceOnNode()) {
    const out = loadSipaSegwit().encode(hrp, version, Array.from(buf));
    if (out == null) return null;
    return out;
  }
  const enc = version > 0 ? 'bech32m' : 'bech32';
  const conv = convertBits(Array.from(buf), 8, 5, true);
  if (!conv) return null;
  return encodePure(hrp, [version].concat(conv), enc);
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
  if (useSipaReferenceOnNode()) {
    const d = loadSipaSegwit().decode(hrp, addr);
    if (!d) return null;
    return { version: d.version, program: Buffer.from(d.program) };
  }
  let inner;
  try {
    inner = decodePure(addr);
  } catch {
    return null;
  }
  if (inner.hrp !== hrp || inner.words.length < 1 || inner.words[0] > 16) return null;
  const witver = inner.words[0];
  const bech32m = inner.spec === 'bech32m';
  if (witver === 0 && bech32m) return null;
  if (witver !== 0 && !bech32m) return null;
  const res = convertBits(inner.words.slice(1), 5, 8, false);
  if (!res || res.length < 2 || res.length > 40) return null;
  if (witver === 0 && res.length !== 20 && res.length !== 32) return null;
  return { version: witver, program: Buffer.from(res) };
}

module.exports = {
  CHARSET,
  encode,
  decode,
  toWords,
  fromWords,
  convertBits,
  polymod,
  hrpExpand,
  BECH32_CONST,
  BECH32M_CONST,
  encodeSegwitAddress,
  decodeSegwitAddress
};
