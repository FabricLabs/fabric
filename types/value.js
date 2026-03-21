'use strict';

const MAX = Math.pow(2, 64);
const BN = require('bn.js');

class Value {
  constructor (data = {}) {
    this._state = {
      input: data,
      output: null
    };
  }

  value (input) {
    return new BN(input);
  }
}

module.exports = Value;
