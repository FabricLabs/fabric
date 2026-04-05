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
 * **`FABRIC_SKIP_NATIVE_ADDON=1`:** do not `require()` the default **`build/Release/fabric.node`**
 * candidate (avoids a stale binary that might SIGSEGV). **`FABRIC_ADDON_PATH`** is still loaded
 * when set, so tests and tooling can pin a safe JS mock or known-good addon.
 *
 * **`FABRIC_ADDON_PATH_STRICT=1`:** with **`FABRIC_ADDON_PATH`** set, try **only** that path
 * (do not fall back to `build/Release/fabric.node`). If STRICT is set without a path, it is ignored
 * so native accel can still load `build/Release/fabric.node`. Used by tests and tooling.
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
/** @type {string|null} Absolute path passed to `require()` when the addon loaded successfully */
let loadedAddonPath = null;

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

function addonPathCandidates (pathMod, skipBuiltinRelease = false) {
  const raw = typeof process !== 'undefined' && process.env ? process.env.FABRIC_ADDON_PATH : undefined;
  const env = raw != null ? String(raw).trim() : '';
  const strictFlag = typeof process !== 'undefined' && process.env &&
    (process.env.FABRIC_ADDON_PATH_STRICT === '1' || process.env.FABRIC_ADDON_PATH_STRICT === 'true');
  // Strict mode only applies when an explicit override path is set; otherwise STRICT alone would
  // skip build/Release and silently disable native accel (no candidates).
  const strict = strictFlag && env.length > 0;
  const list = [];
  if (env) list.push(env);
  if (!strict && !skipBuiltinRelease) {
    list.push(pathMod.join(__dirname, '..', 'build', 'Release', 'fabric.node'));
  }
  return list;
}

/**
 * @param {unknown} err
 * @returns {string|undefined}
 */
function formatAddonLoadError (err) {
  if (err == null) return undefined;
  if (err instanceof Error) {
    const msg = typeof err.message === 'string' ? err.message.trim() : '';
    if (msg.length) return err.message;
    const asString = String(err).trim();
    if (asString.length) return String(err);
    return err.name && err.name !== 'Error' ? err.name : 'Native addon failed to load';
  }
  const s = String(err);
  return s.length ? s : 'Native addon failed to load';
}

function tryLoadAddon () {
  if (loadAttempted) return;
  if (!nativeAddonLoadRequested()) {
    return;
  }
  loadAttempted = true;
  if (!isNode()) {
    return;
  }
  const skipBuiltinRelease = envEnabled('FABRIC_SKIP_NATIVE_ADDON');
  const fs = require('fs');
  const pathMod = require('path');
  let lastLoadError = null;
  loadedAddonPath = null;
  for (const p of addonPathCandidates(pathMod, skipBuiltinRelease)) {
    try {
      if (!p) continue;
      if (!fs.existsSync(p)) {
        lastLoadError = new Error(`Native addon not found: ${p}`);
        continue;
      }
      addon = require(p);
      loadedAddonPath = p;
      loadError = null;
      return;
    } catch (err) {
      lastLoadError = err;
      addon = null;
      loadedAddonPath = null;
    }
  }
  addon = null;
  loadedAddonPath = null;
  loadError = lastLoadError;
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
  return {
    available: methods.length > 0,
    methods,
    nativeDoubleSha256OptIn: nativeDoubleSha256Enabled(),
    nativeBech32OptIn: nativeBech32Enabled(),
    path: addon && isNode() ? loadedAddonPath : null,
    error: !addon && loadError ? formatAddonLoadError(loadError) : undefined
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
 * @returns {string|null}
 */
function bech32Encode (hrp, words, spec) {
  // Null when native is off or the addon call fails — {@link functions/bech32} falls back to JS.
  if (!isNativeBech32Callable()) return null;
  const enc = spec === 'bech32m' ? 1 : 0;
  const buf = Buffer.isBuffer(words) ? words : Buffer.from(words);
  try {
    const out = addon.bech32Encode(hrp, buf, enc);
    return out != null && typeof out === 'string' ? out : null;
  } catch {
    return null;
  }
}

/**
 * @param {string} str
 * @returns {{ hrp: string, words: number[], spec: 'bech32'|'bech32m' }|null}
 */
function bech32Decode (str) {
  if (!isNativeBech32Callable()) return null;
  if (typeof str !== 'string') return null;
  try {
    const r = addon.bech32Decode(str);
    if (r == null || typeof r !== 'object') return null;
    const raw = r.words;
    let words;
    if (Array.isArray(raw)) {
      words = raw;
    } else if (raw != null && typeof raw === 'object' && typeof raw.length === 'number') {
      words = Array.from(raw);
    } else {
      return null;
    }
    const spec = r.spec;
    if (spec !== 'bech32' && spec !== 'bech32m') return null;
    return {
      hrp: r.hrp,
      words,
      spec
    };
  } catch {
    return null;
  }
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
  try {
    const out = addon.segwitAddrEncode(hrp, version, buf);
    return typeof out === 'string' ? out : null;
  } catch {
    return null;
  }
}

/**
 * @param {string} hrp
 * @param {string} addr
 * @returns {{ version: number, program: Buffer }|null}
 */
function segwitAddrDecode (hrp, addr) {
  // Mirrors segwitAddrEncode: null means “use JS reference implementation.”
  if (!isNativeBech32Callable()) return null;
  try {
    const r = addon.segwitAddrDecode(hrp, addr);
    if (r == null || typeof r !== 'object' || typeof r.version !== 'number' || r.program == null) return null;
    return { version: r.version, program: Buffer.from(r.program) };
  } catch {
    return null;
  }
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
