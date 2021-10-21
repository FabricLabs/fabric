'use strict';

const crypto = require('crypto');

/**
 * Provides an HMAC-based Extract-and-Expand Key Derivation Function (HKDF), compatible with
 * RFC 5869.  Defaults to 32 byte output, matching Bitcoin's implementaton.
 */
class HKDF {
  /**
   * Create an HKDF instance.
   * @param {Object} settings List of settings.
   * @param {String} settings.initial Input keying material.
   * @param {String} [settings.algorithm=sha256] Name of the hashing algorithm to use.
   * @param {String} [settings.salt] Salt value (a non-secret random value).
   */
  constructor (settings = {}) {
    if (!settings.initial) throw new Error('Requires "initial" value in settings.');

    // Assign Settings
    this.settings = Object.assign({
      algorithm: 'sha256',
      initial: null,
      salt: null
    }, settings);

    // Properties
    this.size = crypto.createHash(this.settings.algorithm).digest().length;
    this.salt = this.settings.salt || this.zeroes(this.size);
    this.prk = crypto.createHmac(this.settings.algorithm, this.salt).update(this.settings.initial).digest();

    // Chainable
    return this;
  }

  zeroes (count) {
    return Buffer.alloc(count, '0').toString();
  }

  /**
   * Derive a new output.
   * @param {Buffer} [info] Context and application specific information.
   * @param {Number} [size] Length of output.
   */
  derive (info = '', size = 32) {
    if (!(info instanceof Buffer)) info = Buffer.from(info);

    const blocks = Math.ceil(size / this.size);
    const buffers = [];

    let previous = Buffer.from('');

    for (let i = 0; i < blocks; i++) {
      const hmac = crypto.createHmac(this.settings.algorithm, this.prk);
      const input = Buffer.concat([
        previous,
        info,
        Buffer.from(String.fromCharCode(i + 1))
      ]);

      previous = hmac.update(input).digest();

      buffers.push(previous);
    }

    return Buffer.concat(buffers, size);
  }
}

module.exports = HKDF;