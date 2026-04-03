'use strict';

/**
 * Optional native acceleration for a **small, explicit** set of primitives.
 * If `build/Release/fabric.node` is missing or fails to load, all helpers fall
 * back to pure JavaScript (@noble/hashes / existing types).
 *
 * **Double-SHA256 (body hash):** opt-in **`FABRIC_NATIVE_DOUBLE_SHA256=1`**
 *
 * **Bech32 / Bech32m / native segwit (Pieter Wuille `ref/c/segwit_addr`):** opt-in
 * **`FABRIC_NATIVE_BECH32=1`** — uses the same C reference as [sipa/bech32](https://github.com/sipa/bech32).
 * Requires a `fabric.node` built with `native/sipa/segwit_addr.c`. If the binary is
 * older and lacks these exports, {@link #isNativeBech32Callable} is false and
 * `functions/bech32` falls back to the JS reference.
 *
 * **`FABRIC_SKIP_NATIVE_ADDON=1`:** never `require()` the addon (used when a stale
 * `fabric.node` would SIGSEGV on load).
 *
 * **`FABRIC_ADDON_PATH_STRICT=1`:** when **`FABRIC_ADDON_PATH`** is set, try **only** that path
 * (do not fall back to `build/Release/fabric.node`). Used by tests and tooling so a mock or
 * intentionally broken addon is not overridden by a real build artifact.
 *
 * **Browser / webpack:** Node-only requires live inside `tryLoadAddon` after an
 * `isNode()` guard.
 *
 * Supported addon exports (current binding):
 *   - `doubleSha256(Buffer)` → Buffer(32)
 *   - `bech32Encode(hrp, wordsBuffer, enc0or1)` → string
 *   - `bech32Decode(string)` → `{ hrp, words, spec }` or null
 *   - `segwitAddrEncode(hrp, version, programBuffer)` → string or null
 *   - `segwitAddrDecode(hrp, addr)` → `{ version, program }` or null
 *
 * @module @fabric/core/functions/fabricNativeAccel
 */

const { sha256 } = require('@noble/hashes/sha2.js');

function isNode () {
  return typeof process !== 'undefined' && process.versions && typeof process.versions.node === 'string';
}

let addon = null;
let loadAttempted = false;
let loadError = null;

const SUPPORTED_ADDON_EXPORTS = Object.freeze([
  'doubleSha256',
  'bech32Encode',
  'bech32Decode',
  'segwitAddrEncode',
  'segwitAddrDecode'
]);

function envEnabled (key) {
  const v = typeof process !== 'undefined' && process.env ? process.env[key] : undefined;
  return v === '1' || v === 'true';
}

function nativeDoubleSha256Enabled () {
  return envEnabled('FABRIC_NATIVE_DOUBLE_SHA256');
}

function nativeBech32Enabled () {
  return envEnabled('FABRIC_NATIVE_BECH32');
}

function nativeAddonLoadRequested () {
  return nativeDoubleSha256Enabled() || nativeBech32Enabled();
}

function addonPathCandidates (pathMod) {
  const env = typeof process !== 'undefined' && process.env ? process.env.FABRIC_ADDON_PATH : undefined;
  const strict = typeof process !== 'undefined' && process.env &&
    (process.env.FABRIC_ADDON_PATH_STRICT === '1' || process.env.FABRIC_ADDON_PATH_STRICT === 'true');
  const list = [];
  if (env) list.push(env);
  if (!strict) {
    list.push(pathMod.join(__dirname, '..', 'build', 'Release', 'fabric.node'));
  }
  return list;
}

function tryLoadAddon () {
  if (loadAttempted) return;
  loadAttempted = true;
  if (!nativeAddonLoadRequested()) {
    return;
  }
  if (typeof process !== 'undefined' && process.env && process.env.FABRIC_SKIP_NATIVE_ADDON === '1') {
    return;
  }
  if (!isNode()) {
    return;
  }
  const fs = require('fs');
  const pathMod = require('path');
  for (const p of addonPathCandidates(pathMod)) {
    try {
      if (!p || !fs.existsSync(p)) continue;
      addon = require(p);
      loadError = null;
      return;
    } catch (err) {
      loadError = err;
      addon = null;
    }
  }
}

function isNativeBech32Callable () {
  if (!nativeBech32Enabled()) return false;
  tryLoadAddon();
  return !!(
    addon &&
    typeof addon.bech32Encode === 'function' &&
    typeof addon.bech32Decode === 'function' &&
    typeof addon.segwitAddrEncode === 'function' &&
    typeof addon.segwitAddrDecode === 'function'
  );
}

/**
 * @returns {{ available: boolean, methods: string[], path: string|null, error?: string, nativeDoubleSha256OptIn: boolean, nativeBech32OptIn: boolean }}
 */
function status () {
  tryLoadAddon();
  const methods = [];
  if (nativeDoubleSha256Enabled() && addon && typeof addon.doubleSha256 === 'function') {
    methods.push('doubleSha256');
  }
  if (isNativeBech32Callable()) {
    methods.push('bech32Encode', 'bech32Decode', 'segwitAddrEncode', 'segwitAddrDecode');
  }
  let pathStr = null;
  if (addon && isNode()) {
    const pathMod = require('path');
    pathStr = (typeof process !== 'undefined' && process.env && process.env.FABRIC_ADDON_PATH) ||
      pathMod.join(__dirname, '..', 'build', 'Release', 'fabric.node');
  }
  return {
    available: methods.length > 0,
    methods,
    nativeDoubleSha256OptIn: nativeDoubleSha256Enabled(),
    nativeBech32OptIn: nativeBech32Enabled(),
    path: pathStr,
    error: !addon && loadError
      ? (loadError instanceof Error && loadError.message
        ? loadError.message
        : String(loadError))
      : undefined
  };
}

/**
 * @param {Buffer} buf
 * @returns {Buffer}
 */
function doubleSha256Buffer (buf) {
  if (!Buffer.isBuffer(buf)) throw new Error('doubleSha256Buffer expects Buffer');
  tryLoadAddon();
  if (nativeDoubleSha256Enabled() && addon && typeof addon.doubleSha256 === 'function') {
    const out = addon.doubleSha256(buf);
    if (Buffer.isBuffer(out) && out.length === 32) return out;
  }
  const first = sha256(new Uint8Array(buf));
  const second = sha256(first);
  return Buffer.from(second);
}

/**
 * Hex digest — matches {@link ../types/hash256} doubleDigest wire field.
 * @param {Buffer} buf
 * @returns {string}
 */
function doubleSha256Hex (buf) {
  return doubleSha256Buffer(buf).toString('hex');
}

/**
 * @param {string} hrp
 * @param {Buffer|number[]} words — each value 0–31
 * @param {'bech32'|'bech32m'} spec
 * @returns {string}
 */
function bech32Encode (hrp, words, spec) {
  // Throws when native is off so {@link functions/bech32} can catch and use pure-JS encode.
  if (!isNativeBech32Callable()) {
    throw new Error('native bech32 not available (set FABRIC_NATIVE_BECH32=1 and build fabric.node with sipa segwit_addr.c)');
  }
  const enc = spec === 'bech32m' ? 1 : 0;
  const buf = Buffer.isBuffer(words) ? words : Buffer.from(words);
  return addon.bech32Encode(hrp, buf, enc);
}

/**
 * @param {string} str
 * @returns {{ hrp: string, words: number[], spec: 'bech32'|'bech32m' }}
 */
function bech32Decode (str) {
  // Same throw-vs-fallback contract as {@link bech32Encode}.
  if (!isNativeBech32Callable()) {
    throw new Error('native bech32 not available');
  }
  const r = addon.bech32Decode(str);
  if (r == null) {
    throw new Error('Invalid bech32 checksum');
  }
  return {
    hrp: r.hrp,
    words: Array.from(r.words),
    spec: r.spec
  };
}

/**
 * @param {string} hrp
 * @param {number} version
 * @param {Buffer|Uint8Array|number[]} program
 * @returns {string|null}
 */
function segwitAddrEncode (hrp, version, program) {
  // Returns null without native — no JS segwit in this module; callers use {@link functions/sipa/segwit_addr}.
  if (!isNativeBech32Callable()) return null;
  const buf = Buffer.isBuffer(program) ? program : Buffer.from(program);
  return addon.segwitAddrEncode(hrp, version, buf);
}

/**
 * @param {string} hrp
 * @param {string} addr
 * @returns {{ version: number, program: Buffer }|null}
 */
function segwitAddrDecode (hrp, addr) {
  // Mirrors segwitAddrEncode: null means “use JS reference implementation.”
  if (!isNativeBech32Callable()) return null;
  const r = addon.segwitAddrDecode(hrp, addr);
  if (!r) return null;
  return { version: r.version, program: Buffer.from(r.program) };
}

module.exports = {
  SUPPORTED_ADDON_EXPORTS,
  status,
  nativeBech32Enabled,
  isNativeBech32Callable,
  doubleSha256Buffer,
  doubleSha256Hex,
  bech32Encode,
  bech32Decode,
  segwitAddrEncode,
  segwitAddrDecode
};
