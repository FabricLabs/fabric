'use strict';

/**
 * Optional native acceleration for a **small, explicit** set of primitives.
 * If `build/Release/fabric.node` is missing or fails to load, all helpers fall
 * back to pure JavaScript (@noble/hashes / existing types).
 *
 * Supported methods (C addon must export these names):
 *   - `doubleSha256(Buffer)` → Buffer(32) — Bitcoin-style SHA256(SHA256(data))
 *
 * @module @fabric/core/functions/fabricNativeAccel
 */

const fs = require('fs');
const path = require('path');

const { sha256 } = require('@noble/hashes/sha2.js');

let addon = null;
let loadAttempted = false;
let loadError = null;

const SUPPORTED_ADDON_EXPORTS = Object.freeze(['doubleSha256']);

function addonPathCandidates () {
  const env = process.env.FABRIC_ADDON_PATH;
  const list = [];
  if (env) list.push(env);
  list.push(path.join(__dirname, '..', 'build', 'Release', 'fabric.node'));
  return list;
}

function tryLoadAddon () {
  if (loadAttempted) return;
  loadAttempted = true;
  for (const p of addonPathCandidates()) {
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
  if (addon && typeof addon.doubleSha256 === 'function') methods.push('doubleSha256');
  return {
    available: methods.length > 0,
    methods,
    path: addon ? (process.env.FABRIC_ADDON_PATH || path.join(__dirname, '..', 'build', 'Release', 'fabric.node')) : null,
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
  if (addon && typeof addon.doubleSha256 === 'function') {
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
