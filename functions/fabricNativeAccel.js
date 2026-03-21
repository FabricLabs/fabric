'use strict';

/**
 * Optional native acceleration for a **small, explicit** set of primitives.
 * If `build/Release/fabric.node` is missing or fails to load, all helpers fall
 * back to pure JavaScript (@noble/hashes / existing types).
 *
 * **Double-SHA256 (body hash):** the native `doubleSha256` path is **opt-in**
 * (`FABRIC_NATIVE_DOUBLE_SHA256=1`) so a broken or ABI-mismatched `fabric.node`
 * cannot segfault the process during normal tests or `Message` construction.
 * Default is pure JS (same output as libwally when the addon works).
 *
 * **Browser / webpack:** do not `require('fs')` at module scope — bundlers execute
 * that at load time and fail. Node-only requires live inside `tryLoadAddon` after
 * an `isNode()` guard (see Hub `webpack` `resolve.fallback.fs`).
 *
 * Supported methods (C addon must export these names):
 *   - `doubleSha256(Buffer)` → Buffer(32) — Bitcoin-style SHA256(SHA256(data))
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

const SUPPORTED_ADDON_EXPORTS = Object.freeze(['doubleSha256']);

function nativeDoubleSha256Enabled () {
  const v = typeof process !== 'undefined' && process.env ? process.env.FABRIC_NATIVE_DOUBLE_SHA256 : undefined;
  return v === '1' || v === 'true';
}

function addonPathCandidates (pathMod) {
  const env = typeof process !== 'undefined' && process.env ? process.env.FABRIC_ADDON_PATH : undefined;
  const list = [];
  if (env) list.push(env);
  list.push(pathMod.join(__dirname, '..', 'build', 'Release', 'fabric.node'));
  return list;
}

function tryLoadAddon () {
  if (loadAttempted) return;
  loadAttempted = true;
  // Never `require()` fabric.node unless opted in — a bad binary can segfault on load.
  if (!nativeDoubleSha256Enabled()) {
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

/**
 * @returns {{ available: boolean, methods: string[], path: string|null, error?: string }}
 */
function status () {
  tryLoadAddon();
  const methods = [];
  const canUseNative = nativeDoubleSha256Enabled() && addon && typeof addon.doubleSha256 === 'function';
  if (canUseNative) methods.push('doubleSha256');
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
    path: pathStr,
    error: !addon && loadError ? loadError.message : undefined
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

module.exports = {
  SUPPORTED_ADDON_EXPORTS,
  status,
  doubleSha256Buffer,
  doubleSha256Hex
};
