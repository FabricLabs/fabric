'use strict';

const { sha256 } = require('@noble/hashes/sha256');

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
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(input);
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex;
  }

  reverse (input = this.value) {
    return Hash256.reverse(input);
  }
}

module.exports = Hash256;
