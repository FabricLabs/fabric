/**
 * BIP-85 deterministic entropy from a BIP-32 root key.
 *
 * HMAC-SHA512(key = "bip-entropy-from-k", msg = derived private key k) yields
 * 64 bytes of entropy. Application paths are fully hardened under purpose
 * `m/83696968'`.
 *
 * @fileoverview BIP-85 entropy from BIP-32.
 * @module functions/bip85
 */
'use strict';

const { hmac } = require('@noble/hashes/hmac.js');
const { sha512 } = require('@noble/hashes/sha2.js');
const { secp256k1 } = require('@noble/curves/secp256k1.js');
const { fromBase58, HDNode, DEFAULT_NETWORK } = require('./bip32');
const { entropyToMnemonic } = require('./bip39');
const { encodeCheck } = require('./base58');
const { toUint8Strict } = require('./bytes');

/** BIP-85 purpose index (`"BIPS"`-era constant from the specification). */
const BIP85_PURPOSE = 83696968;
/** HMAC key required by BIP-85. */
const BIP85_HMAC_KEY = Buffer.from('bip-entropy-from-k', 'utf8');

const APP_BIP39 = 39;
const APP_HDSEED_WIF = 2;
const APP_XPRV = 32;
const APP_HEX = 128169;

const MNEMONIC_WORD_COUNTS = Object.freeze([12, 15, 18, 21, 24]);

/**
 * @param {HDNode|string} root
 * @returns {HDNode}
 * @private
 */
function asRoot (root) {
  if (root && typeof root.derivePath === 'function') return root;
  if (typeof root === 'string') return fromBase58(root);
  throw new TypeError('BIP85 root must be an HDNode or xprv string');
}

/**
 * @param {number} n
 * @param {string} label
 * @returns {number}
 * @private
 */
function assertHardenedIndex (n, label) {
  const v = Number(n);
  if (!Number.isInteger(v) || v < 0 || v > 0x7fffffff) {
    throw new RangeError(`BIP85 ${label} must be an integer in [0, 0x7fffffff]`);
  }
  return v;
}

/**
 * Fully-hardened BIP-85 path `m/83696968'/{app}'/{segments}'…`.
 *
 * @param {number} application
 * @param {Array<number>} segments remaining hardened indexes (including the
 *   application index when that is the last component)
 * @returns {string}
 */
function bip85Path (application, segments) {
  const app = assertHardenedIndex(application, 'application');
  const parts = [`m/${BIP85_PURPOSE}'`, `${app}'`];
  const rest = Array.isArray(segments) ? segments : [segments];
  for (let i = 0; i < rest.length; i++) {
    parts.push(`${assertHardenedIndex(rest[i], 'path[' + i + ']')}'`);
  }
  return parts.join('/');
}

/**
 * 64-byte BIP-85 entropy for an already-derived child private key.
 *
 * @param {Buffer|Uint8Array} privateKey32
 * @returns {Buffer}
 */
function entropyFromPrivateKey (privateKey32) {
  const k = Buffer.from(toUint8Strict(privateKey32));
  if (k.length !== 32) throw new Error('BIP85 private key must be 32 bytes');
  return Buffer.from(hmac(sha512, toUint8Strict(BIP85_HMAC_KEY), toUint8Strict(k)));
}

/**
 * Derive 64 bytes of BIP-85 entropy from a BIP-32 root and hardened path.
 *
 * @param {HDNode|string} root
 * @param {string} path absolute path beginning with `m/`
 * @returns {{ path: string, derivedKeyHex: string, entropy: Buffer }}
 */
function deriveBip85Entropy (root, path) {
  const p = String(path || '');
  if (!p.startsWith('m/')) throw new Error('BIP85 path must be absolute (m/…)');
  const nodeRoot = asRoot(root);
  if (!nodeRoot.privateKey) throw new Error('BIP85 requires a private (xprv) root');
  const node = nodeRoot.derivePath(p);
  const entropy = entropyFromPrivateKey(node.privateKey);
  return {
    path: p,
    derivedKeyHex: Buffer.from(node.privateKey).toString('hex'),
    entropy
  };
}

/**
 * Truncate trailing (least-significant) bytes of the 64-byte HMAC output.
 *
 * @param {Buffer} entropy
 * @param {number} numBytes
 * @returns {Buffer}
 */
function truncateEntropy (entropy, numBytes) {
  const n = Number(numBytes);
  if (!Number.isInteger(n) || n < 1 || n > 64) {
    throw new RangeError('BIP85 entropy length must be 1–64 bytes');
  }
  return Buffer.from(entropy.subarray(0, n));
}

/**
 * BIP-39 mnemonic application (`39'`).
 *
 * @param {HDNode|string} root
 * @param {Object} [opts]
 * @param {number} [opts.language=0] BIP-85 language code (0 = English)
 * @param {number} [opts.words=12] 12, 15, 18, 21, or 24
 * @param {number} [opts.index=0]
 * @returns {{ path: string, entropy: Buffer, mnemonic: string }}
 */
function deriveBip85Mnemonic (root, opts = {}) {
  const language = opts.language == null ? 0 : opts.language;
  const words = opts.words == null ? 12 : opts.words;
  const index = opts.index == null ? 0 : opts.index;
  if (!MNEMONIC_WORD_COUNTS.includes(Number(words))) {
    throw new RangeError('BIP85 mnemonic words must be 12, 15, 18, 21, or 24');
  }
  const path = bip85Path(APP_BIP39, [language, words, index]);
  const derived = deriveBip85Entropy(root, path);
  const bits = Number(words) * 11 * 32 / 33;
  const entropy = truncateEntropy(derived.entropy, bits / 8);
  return {
    path,
    entropy,
    mnemonic: entropyToMnemonic(entropy)
  };
}

/**
 * Raw hex entropy application (`128169'`), 16–64 bytes.
 *
 * @param {HDNode|string} root
 * @param {Object} [opts]
 * @param {number} [opts.numBytes=64]
 * @param {number} [opts.index=0]
 * @returns {{ path: string, entropy: Buffer }}
 */
function deriveBip85Hex (root, opts = {}) {
  const numBytes = opts.numBytes == null ? 64 : opts.numBytes;
  const index = opts.index == null ? 0 : opts.index;
  if (!Number.isInteger(numBytes) || numBytes < 16 || numBytes > 64) {
    throw new RangeError('BIP85 HEX numBytes must be 16–64');
  }
  const path = bip85Path(APP_HEX, [numBytes, index]);
  const derived = deriveBip85Entropy(root, path);
  return { path, entropy: truncateEntropy(derived.entropy, numBytes) };
}

/**
 * BIP-32 master xprv application (`32'`). Chain code is the first 32 HMAC
 * bytes; private key is the second 32 (the reverse of BIP-32 HMAC layout).
 *
 * @param {HDNode|string} root
 * @param {Object} [opts]
 * @param {number} [opts.index=0]
 * @returns {{ path: string, entropy: Buffer, xprv: string }}
 */
function deriveBip85Xprv (root, opts = {}) {
  const index = opts.index == null ? 0 : opts.index;
  const path = bip85Path(APP_XPRV, [index]);
  const derived = deriveBip85Entropy(root, path);
  const chainCode = derived.entropy.subarray(0, 32);
  const privateKey = derived.entropy.subarray(32, 64);
  let publicKey;
  try {
    publicKey = Buffer.from(secp256k1.getPublicKey(toUint8Strict(privateKey), true));
  } catch (_) {
    throw new Error('BIP85 derived xprv key is invalid; try the next index');
  }
  const node = new HDNode(DEFAULT_NETWORK, 0, 0, 0, Buffer.from(chainCode), Buffer.from(privateKey), publicKey);
  return {
    path,
    entropy: derived.entropy,
    xprv: node.toBase58()
  };
}

/**
 * Bitcoin Core hdseed WIF application (`2'`): first 32 HMAC bytes as a
 * compressed mainnet WIF.
 *
 * @param {HDNode|string} root
 * @param {Object} [opts]
 * @param {number} [opts.index=0]
 * @returns {{ path: string, entropy: Buffer, wif: string }}
 */
function deriveBip85Wif (root, opts = {}) {
  const index = opts.index == null ? 0 : opts.index;
  const path = bip85Path(APP_HDSEED_WIF, [index]);
  const derived = deriveBip85Entropy(root, path);
  const privateKey = truncateEntropy(derived.entropy, 32);
  try {
    secp256k1.getPublicKey(toUint8Strict(privateKey), true);
  } catch (_) {
    throw new Error('BIP85 derived WIF key is invalid; try the next index');
  }
  const payload = Buffer.concat([
    Buffer.from([0x80]),
    privateKey,
    Buffer.from([0x01])
  ]);
  return {
    path,
    entropy: privateKey,
    wif: encodeCheck(payload)
  };
}

module.exports = {
  BIP85_PURPOSE,
  BIP85_HMAC_KEY,
  APP_BIP39,
  APP_HDSEED_WIF,
  APP_XPRV,
  APP_HEX,
  bip85Path,
  entropyFromPrivateKey,
  deriveBip85Entropy,
  truncateEntropy,
  deriveBip85Mnemonic,
  deriveBip85Hex,
  deriveBip85Xprv,
  deriveBip85Wif
};
