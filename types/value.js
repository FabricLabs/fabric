'use strict';

const MAX = Math.pow(2, 64);
const BN = require('bn.js');

/**
 * {@link Number}-like type.
 */
class Value {
  /**
   * Use the {@link Value} type to interact with {@link Number}-like objects.
   * @param {Mixed} data Input value.
   */
  constructor (data = {}) {
    this._state = {
      input: data,
      output: null
    };
  }

  /**
   * Compute the numeric representation of this input.
   * @param {String} input Input string to seek for value.
   */
  value (input) {
    return new BN(input);
  }
}

module.exports = Value;
