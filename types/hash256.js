'use strict';

const { sha256 } = require('@noble/hashes/sha2.js');
const { hmac } = require('@noble/hashes/hmac.js');
const fabricNativeAccel = require('../functions/fabricNativeAccel');

const TAG_PREFIX_CACHE_LIMIT = 256;
const tagPrefixes = new Map();
const KEYSTREAM_MAX_BLOCKS = 0x100000000;

function asBytes (value, name) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (typeof value === 'string') return Buffer.from(value, 'utf8');
  throw new TypeError(`${name} must be a Buffer, Uint8Array, or string`);
}

function tagPrefix (tag) {
  const id = tag.toString('hex');
  let prefix = tagPrefixes.get(id);
  if (!prefix) {
    const tagHash = Buffer.from(sha256(tag));
    prefix = Buffer.concat([tagHash, tagHash]);
    if (tagPrefixes.size >= TAG_PREFIX_CACHE_LIMIT) tagPrefixes.delete(tagPrefixes.keys().next().value);
    tagPrefixes.set(id, prefix);
  }
  return prefix;
}

/**
 * Simple interaction with 256-bit spaces.
 */
class Hash256 {
  /**
   * Create an instance of a `Hash256` object by calling `new Hash256()`,
   * where `settings` can be provided to supply a particular input object.
   *
   * If the `settings` is not a string, `input` must be provided.
   * @param {Object} settings
   * @param {String} settings.input Input string to map as 256-bit hash.
   */
  constructor (settings = {}) {
    if (typeof settings === 'string') settings = { input: settings };
    if (!settings.input) {
      if (typeof window !== 'undefined' && window.crypto && window.crypto.getRandomValues) {
        settings.input = window.crypto.getRandomValues(new Uint8Array(32)).join('');
      } else {
        settings.input = require('crypto').randomBytes(32).toString('hex');
      }
    }

    // Ensure the input can be cast to a buffer
    const buffer = Buffer.from(settings.input, 'utf8');

    // Settings
    this.settings = Object.assign({
      hash: Hash256.digest(buffer)
    }, settings);

    return this;
  }

  static compute (input) {
    if (typeof input === 'string') input = Buffer.from(input, 'utf8');
    const buffer = sha256(input);
    return Buffer.from(buffer).toString('hex');
  }

  /**
   * Double-SHA256 digest (Bitcoin-style). Matches C message body hash.
   * @param {String|Buffer} input Content to digest.
   * @returns {String} SHA256(SHA256(input)) as hexadecimal string.
   */
  static doubleDigest (input) {
    if (typeof input === 'string') input = Buffer.from(input, 'utf8');
    return fabricNativeAccel.doubleSha256Hex(input);
  }

  /**
   * Produce a SHA256 digest of some input data.
   * @param {String|Buffer} input Content to digest.
   * @returns {String} `SHA256(input)` as a hexadecimal string.
   */
  static digest (input) {
    if (typeof input !== 'string' && !(input instanceof Buffer)) {
      throw new Error(`Input to process must be of type "String" or "Buffer" to digest.`);
    }

    return Hash256.compute(input);
  }

  /**
   * BIP-340 tagged hash: `SHA256(SHA256(tag) ‖ SHA256(tag) ‖ data)`.
   * @param {String|Buffer} tag Tag (a string is UTF-8), e.g. `Fabric/Message`.
   * @param {Buffer} data Data to hash.
   * @returns {Buffer} 32-byte digest.
   */
  static tagged (tag, data) {
    if (!tag) throw new Error('Tag is required');
    if (!data) throw new Error('Data is required');
    if (typeof tag === 'string') tag = Buffer.from(tag, 'utf8');
    if (!Buffer.isBuffer(tag)) throw new Error('Tag must be a string or Buffer');
    if (!Buffer.isBuffer(data)) throw new Error('Data must be a Buffer');
    return Buffer.from(sha256(Buffer.concat([tagPrefix(tag), data])));
  }

  /**
   * HMAC-SHA256 (RFC 2104).
   * @param {Buffer|Uint8Array|String} key Key (a string is UTF-8).
   * @param {Buffer|Uint8Array|String} data Message (a string is UTF-8).
   * @returns {Buffer} 32-byte MAC.
   */
  static hmac (key, data) {
    return Buffer.from(hmac(sha256, asBytes(key, 'key'), asBytes(data, 'data')));
  }

  /**
   * `n` bytes of HMAC-SHA256 counter-mode keystream: block `j` is
   * `HMAC-SHA256(key, prefix ‖ uint32be(j))`, from `j = 0`, truncated to `n`.
   * XOR with a plaintext to encrypt; a key must never encrypt two plaintexts.
   * @param {Buffer|Uint8Array|String} key Key (a string is UTF-8).
   * @param {Number} n Number of bytes.
   * @param {Buffer|Uint8Array|String} [prefix] Domain label ahead of the counter.
   * @returns {Buffer} `n` bytes.
   */
  static keystream (key, n, prefix = Buffer.alloc(0)) {
    if (!Number.isSafeInteger(n) || n < 0) throw new RangeError('n must be a non-negative integer');
    const blocks = Math.ceil(n / 32);
    if (blocks > KEYSTREAM_MAX_BLOCKS) throw new RangeError('n exceeds the 32-bit block counter');
    const k = asBytes(key, 'key');
    const label = asBytes(prefix, 'prefix');
    const input = Buffer.alloc(label.length + 4);
    label.copy(input, 0);
    const out = Buffer.alloc(blocks * 32);
    for (let j = 0; j < blocks; j++) {
      input.writeUInt32BE(j, label.length);
      out.set(hmac(sha256, k, input), j * 32);
    }
    return out.subarray(0, n);
  }

  get hash () {
    return this.value;
  }

  // TODO: document `hash256.value`
  get value () {
    return Hash256.digest(this.settings.input);
  }

  /**
   * Reverses the bytes of the digest.
   */
  static reverse (input = '') {
    return Buffer.from(input, 'hex').reverse().toString('hex');
  }

  static async hash (input) {
    // Use @noble/hashes for browser compatibility (crypto.subtle is undefined in non-secure context)
    const data = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
    return Hash256.compute(data);
  }

  reverse (input = this.value) {
    return Hash256.reverse(input);
  }
}

module.exports = Hash256;
