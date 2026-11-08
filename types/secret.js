'use strict';

const crypto = require('crypto');
const EncryptedPromise = require('./promise');

/**
 * Secret material held as an {@link EncryptedPromise}: 32 random bytes (hex)
 * unless a value is supplied.
 */
class Secret extends EncryptedPromise {
  /**
   * @param {string|Object} [settings] The secret itself, or settings.
   * @param {string} [settings.value] The secret; defaults to 32 random bytes as hex.
   * @param {string} [settings.password] Seal immediately with this password (at least 8 characters).
   * @param {Object} [settings.seal] Restore from a sealed envelope.
   */
  constructor (settings = {}) {
    if (typeof settings === 'string') settings = { value: settings };
    if (!settings.value && !settings.seal) {
      settings = Object.assign({}, settings, { value: crypto.randomBytes(32).toString('hex') });
    }

    super(settings);
  }

  /**
   * SHA-256 of the secret (hex), or `null` while it is sealed and not yet decrypted.
   * @type {string}
   */
  get hash () {
    return this.data.hash;
  }

  /**
   * @type {Object}
   */
  get data () {
    return {
      hash: (this._state.data === null) ? null : crypto.createHash('sha256').update(this._state.data).digest('hex'),
      content: this._state.data
    };
  }
}

module.exports = Secret;
