'use strict';

const { sha256, sha512 } = require('@noble/hashes/sha2.js');
const hkdf = require('@noble/hashes/hkdf.js');

const HASHES = Object.freeze({ sha256, sha512 });

function hashFor (algorithm = 'sha256') {
  const hash = HASHES[String(algorithm).toLowerCase()];
  if (!hash) throw new Error(`Unsupported HKDF hash "${algorithm}" (use ${Object.keys(HASHES).join(' or ')})`);
  return hash;
}

function asBytes (value, name) {
  if (value === undefined || value === null) return Buffer.alloc(0);
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (typeof value === 'string') return Buffer.from(value, 'utf8');
  throw new TypeError(`${name} must be a Buffer, Uint8Array, or string`);
}

/**
 * HMAC-based Extract-and-Expand Key Derivation Function (HKDF, RFC 5869).
 * Defaults to SHA-256 and 32 bytes of output.
 */
class HKDF {
  /**
   * Create an HKDF instance: extracts the pseudorandom key once, then
   * {@link HKDF#derive} expands it for each `info`.
   * @param {Object} settings List of settings.
   * @param {Buffer|String} settings.initial Input keying material (a string is UTF-8).
   * @param {String} [settings.algorithm=sha256] `sha256` or `sha512`.
   * @param {Buffer|String} [settings.salt] Salt; defaults to a hash-length string of zero bytes.
   */
  constructor (settings = {}) {
    if (!settings.initial) throw new Error('Requires "initial" value in settings.');

    this.settings = Object.assign({
      algorithm: 'sha256',
      initial: null,
      salt: null
    }, settings);

    this.size = hashFor(this.settings.algorithm).outputLen;
    this.salt = this.settings.salt ? asBytes(this.settings.salt, 'salt') : Buffer.alloc(this.size);
    this.prk = HKDF.extract(this.settings.initial, this.salt, this.settings.algorithm);

    return this;
  }

  /**
   * HKDF-Extract: `PRK = HMAC-Hash(salt, IKM)`.
   * @param {Buffer|Uint8Array|String} ikm Input keying material (a string is UTF-8).
   * @param {Buffer|Uint8Array|String} [salt] Salt; empty means a hash-length string of zero bytes.
   * @param {String} [algorithm=sha256] `sha256` or `sha512`.
   * @returns {Buffer} Pseudorandom key, one hash length.
   */
  static extract (ikm, salt, algorithm = 'sha256') {
    const hash = hashFor(algorithm);
    const s = asBytes(salt, 'salt');
    return Buffer.from(hkdf.extract(hash, asBytes(ikm, 'ikm'), s.length ? s : Buffer.alloc(hash.outputLen)));
  }

  /**
   * HKDF-Expand: `T(1) ‖ T(2) ‖ …` with `T(i) = HMAC-Hash(PRK, T(i-1) ‖ info ‖ i)`.
   * @param {Buffer|Uint8Array} prk Pseudorandom key, at least one hash length.
   * @param {Buffer|Uint8Array|String} [info] Context and application specific information.
   * @param {Number} [length=32] Output length, at most 255 hash lengths.
   * @param {String} [algorithm=sha256] `sha256` or `sha512`.
   * @returns {Buffer} Output keying material.
   */
  static expand (prk, info, length = 32, algorithm = 'sha256') {
    const hash = hashFor(algorithm);
    const key = asBytes(prk, 'prk');
    if (key.length < hash.outputLen) throw new RangeError(`prk must be at least ${hash.outputLen} bytes`);
    if (!Number.isSafeInteger(length) || length < 1 || length > 255 * hash.outputLen) {
      throw new RangeError(`length must be 1 to ${255 * hash.outputLen}`);
    }
    return Buffer.from(hkdf.expand(hash, key, asBytes(info, 'info'), length));
  }

  /**
   * Derive a new output.
   * @param {Buffer|String} [info] Context and application specific information.
   * @param {Number} [size] Length of output.
   * @returns {Buffer}
   */
  derive (info = '', size = 32) {
    return HKDF.expand(this.prk, info, size, this.settings.algorithm);
  }
}

module.exports = HKDF;
