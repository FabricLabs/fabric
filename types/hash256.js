'use strict';

const crypto = require('crypto');

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
    if (!settings.input) settings.input = crypto.randomBytes(32).toString('hex');

    this.settings = Object.assign({
      hash: Hash256.digest(settings.input)
    }, settings);
  }

  /**
   * 
   * @param {String} input 
   * @returns {String} `SHA256(input)` as a hexadecimal string.
   */
  static digest (input) {
    if (typeof input !== 'string') {
      throw new Error(`Input to process must be of type "String" to digest.`);
    }

    // consume and output as string
    return crypto.createHash('sha256').update(input).digest('hex');
  }

  // TODO: document `hash256.value`
  get value () {
    return Hash256.digest(this.settings.input);
  }
}

module.exports = Hash256;