'use strict';

/**
 * Classify operator key material for Environment / Hub / application loaders.
 *
 * Latest RC1 expectation:
 *   - `FABRIC_XPRV` — BIP32 extended private key (preferred)
 *   - `FABRIC_SEED` — raw BIP32 seed **hex** (16–64 bytes; BIP39 PBKDF2 output is 64)
 *   - `FABRIC_MNEMONIC` — BIP39 word phrase
 *
 * `FABRIC_SEED` still accepts a mnemonic or an `xprv…` string for compatibility.
 *
 * @fileoverview Classify FABRIC_XPRV / FABRIC_SEED / FABRIC_MNEMONIC material.
 * @module functions/fabricKeyMaterial
 */

const bip39 = require('./bip39');

/** BIP32 `fromSeed` minimum length. */
const MIN_SEED_BYTES = 16;
/** BIP32 `fromSeed` maximum length (BIP39 `mnemonicToSeed` is 64). */
const MAX_SEED_BYTES = 64;

/**
 * Parse a raw BIP32 seed from hex (optional `0x` prefix) or a Buffer.
 *
 * @param {*} value
 * @returns {Buffer|null}
 */
function parseRawSeedHex (value) {
  if (value == null) return null;
  if (Buffer.isBuffer(value)) {
    if (value.length < MIN_SEED_BYTES || value.length > MAX_SEED_BYTES) return null;
    return value;
  }
  if (value instanceof Uint8Array) {
    if (value.byteLength < MIN_SEED_BYTES || value.byteLength > MAX_SEED_BYTES) return null;
    return Buffer.from(value);
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  if (!/^(?:0x)?[0-9a-fA-F]+$/i.test(trimmed)) return null;
  const hex = trimmed.slice(0, 2).toLowerCase() === '0x' ? trimmed.slice(2) : trimmed;
  if (hex.length % 2 !== 0) return null;
  const bytes = hex.length / 2;
  if (bytes < MIN_SEED_BYTES || bytes > MAX_SEED_BYTES) return null;
  return Buffer.from(hex, 'hex');
}

/**
 * @param {*} value
 * @returns {{ kind: string|null, xprv?: string, seed?: string, mnemonic?: string }}
 */
function classifyFabricKeyMaterial (value) {
  const trimmed = value == null ? '' : String(value).trim();
  if (!trimmed) return { kind: null };
  if (trimmed.startsWith('xprv') || trimmed.startsWith('tprv')) {
    return { kind: 'xprv', xprv: trimmed };
  }
  const hex = parseRawSeedHex(trimmed);
  if (hex) return { kind: 'seedHex', seed: hex.toString('hex') };
  if (bip39.validateMnemonic(trimmed)) {
    return { kind: 'mnemonic', mnemonic: trimmed };
  }
  return { kind: 'unknown' };
}

/**
 * Key constructor settings from process/env identity variables.
 * Precedence: `FABRIC_XPRV` → `FABRIC_SEED` → `FABRIC_MNEMONIC`.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ xprv?: string, seed?: string, mnemonic?: string }|null}
 */
function keySettingsFromEnv (env = process.env) {
  const xprv = String((env && env.FABRIC_XPRV) || '').trim();
  if (xprv.startsWith('xprv') || xprv.startsWith('tprv')) {
    return { xprv };
  }

  const seedRaw = String((env && env.FABRIC_SEED) || '').trim();
  if (seedRaw) {
    const classified = classifyFabricKeyMaterial(seedRaw);
    if (classified.kind === 'xprv') return { xprv: classified.xprv };
    if (classified.kind === 'seedHex') return { seed: classified.seed };
    if (classified.kind === 'mnemonic') return { mnemonic: classified.mnemonic };
  }

  const mnemonic = String((env && env.FABRIC_MNEMONIC) || '').trim();
  if (mnemonic) {
    const classified = classifyFabricKeyMaterial(mnemonic);
    if (classified.kind === 'mnemonic') return { mnemonic: classified.mnemonic };
    if (classified.kind === 'xprv') return { xprv: classified.xprv };
    if (classified.kind === 'seedHex') return { seed: classified.seed };
  }

  return null;
}

module.exports = {
  MIN_SEED_BYTES,
  MAX_SEED_BYTES,
  parseRawSeedHex,
  classifyFabricKeyMaterial,
  keySettingsFromEnv
};
