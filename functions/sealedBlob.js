'use strict';

/**
 * Password-sealed JSON blobs (AES-256-GCM + PBKDF2-SHA256).
 *
 * Generic at-rest encryption used by `fabric setup` wallets, and the same
 * scheme as Hub identity backup v2 (`aes-256-gcm-pbkdf2-sha256`, 210000
 * iterations, 12-byte IV, tag appended to ciphertext). Callers keep public
 * fields outside the seal; only secret material goes in the blob.
 *
 * @fileoverview Generic password-sealed JSON (AES-GCM / PBKDF2).
 * @module functions/sealedBlob
 */

const crypto = require('crypto');

const SEAL_SCHEME = 'aes-256-gcm-pbkdf2-sha256';
const SEAL_TYPE = 'FabricSealedBlob';
const SEAL_VERSION = 1;
const KDF_NAME = 'pbkdf2';
const KDF_HASH = 'sha256';
const DEFAULT_ITERATIONS = 210000;
const MIN_ITERATIONS = 100000;
const MAX_ITERATIONS = 5000000;
const PASSWORD_MIN_LENGTH = 8;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const KEY_BYTES = 32;
const TAG_BYTES = 16;

/**
 * @param {string} password
 * @returns {string}
 */
function normalizePassword (password) {
  if (password == null || typeof password !== 'string') {
    throw new Error('Password is required.');
  }
  const pwd = password.normalize('NFKC');
  if (pwd.length < PASSWORD_MIN_LENGTH) {
    const err = new Error(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
    err.code = 'FABRIC_PASSWORD_POLICY';
    throw err;
  }
  return pwd;
}

/**
 * @param {Buffer|Uint8Array} buf
 * @returns {string}
 */
function b64encode (buf) {
  return Buffer.from(buf).toString('base64');
}

/**
 * @param {string} s
 * @returns {Buffer}
 */
function b64decode (s) {
  if (s == null || typeof s !== 'string' || !s.trim()) {
    throw new Error('Invalid sealed blob encoding.');
  }
  return Buffer.from(s.trim(), 'base64');
}

/**
 * @param {string} password
 * @param {Buffer} salt
 * @param {number} iterations
 * @returns {Buffer}
 */
function deriveKey (password, salt, iterations) {
  return crypto.pbkdf2Sync(password, salt, iterations, KEY_BYTES, KDF_HASH);
}

/**
 * @param {*} obj
 * @returns {object|null}
 */
function extractEnvelope (obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (obj.seal && typeof obj.seal === 'object') return obj.seal;
  if (obj.ciphertext && (obj.iv || obj.nonce) && obj.kdf) return obj;
  return null;
}

/**
 * @param {*} obj
 * @returns {boolean}
 */
function isSealedEnvelope (obj) {
  const env = extractEnvelope(obj);
  if (!env || !env.ciphertext || !env.kdf) return false;
  const scheme = String(env.encryption || env.format || '');
  if (scheme && scheme !== SEAL_SCHEME) return false;
  return true;
}

/**
 * True when a persisted wallet/identity JSON is password-sealed.
 *
 * @param {*} parsed
 * @returns {boolean}
 */
function isPasswordProtectedDocument (parsed) {
  if (!parsed || typeof parsed !== 'object') return false;
  if (parsed.passwordProtected === true && isSealedEnvelope(parsed)) return true;
  if (parsed.format === SEAL_SCHEME && isSealedEnvelope(parsed)) return true;
  return isSealedEnvelope(parsed) && !!(parsed.object && (parsed.object.xpub || parsed.object.id));
}

/**
 * Seal a JSON-serializable value with a password.
 *
 * @param {*} plaintext
 * @param {string} password
 * @param {Object} [opts]
 * @param {number} [opts.iterations]
 * @param {string} [opts.type]
 * @param {number} [opts.version]
 * @returns {object} Envelope (safe to persist / JSON.stringify)
 */
function sealJson (plaintext, password, opts = {}) {
  const pwd = normalizePassword(password);
  const iterations = Number.isFinite(opts.iterations)
    ? Math.floor(opts.iterations)
    : DEFAULT_ITERATIONS;
  if (iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) {
    throw new Error('Invalid PBKDF2 iteration count.');
  }

  const salt = crypto.randomBytes(SALT_BYTES);
  const iv = crypto.randomBytes(IV_BYTES);
  const key = deriveKey(pwd, salt, iterations);
  const plain = Buffer.from(JSON.stringify(plaintext), 'utf8');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  const ciphertext = Buffer.concat([body, tag]);

  return {
    type: opts.type || SEAL_TYPE,
    version: opts.version != null ? opts.version : SEAL_VERSION,
    encryption: SEAL_SCHEME,
    kdf: {
      name: KDF_NAME,
      hash: KDF_HASH,
      iterations,
      salt: b64encode(salt)
    },
    iv: b64encode(iv),
    ciphertext: b64encode(ciphertext)
  };
}

/**
 * Open a sealed envelope (core `FabricSealedBlob`, Hub backup v2, or a document
 * with a nested `seal` field).
 *
 * @param {object} document
 * @param {string} password
 * @returns {*} Parsed plaintext
 */
function openSealedJson (document, password) {
  const pwd = normalizePassword(password);
  const env = extractEnvelope(document);
  if (!env) throw new Error('Not a sealed blob.');
  const scheme = String(env.encryption || env.format || SEAL_SCHEME);
  if (scheme !== SEAL_SCHEME) {
    throw new Error(`Unsupported seal scheme: ${scheme}`);
  }

  const iterations = Number(env.kdf && env.kdf.iterations) || DEFAULT_ITERATIONS;
  if (iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) {
    throw new Error('Invalid PBKDF2 iteration count.');
  }
  const salt = b64decode(env.kdf && env.kdf.salt);
  const iv = b64decode(env.iv || env.nonce);
  const raw = b64decode(env.ciphertext);
  if (iv.length !== IV_BYTES) throw new Error('Invalid seal IV.');
  if (raw.length <= TAG_BYTES) throw new Error('Invalid seal ciphertext.');

  const key = deriveKey(pwd, salt, iterations);
  const tag = raw.subarray(raw.length - TAG_BYTES);
  const body = raw.subarray(0, raw.length - TAG_BYTES);
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(body), decipher.final()]);
    return JSON.parse(plain.toString('utf8'));
  } catch (exception) {
    const err = new Error('Decryption failed (wrong password or corrupt blob).');
    err.code = 'FABRIC_SEAL_DECRYPT';
    err.cause = exception;
    throw err;
  }
}

module.exports = {
  SEAL_SCHEME,
  SEAL_TYPE,
  SEAL_VERSION,
  DEFAULT_ITERATIONS,
  PASSWORD_MIN_LENGTH,
  extractEnvelope,
  isPasswordProtectedDocument,
  isSealedEnvelope,
  openSealedJson,
  sealJson
};
