'use strict';

const Actor = require('./actor');
const merge = require('lodash.merge');

class Block extends Actor {
  constructor (input = {}) {
    super(input);

    this._state = merge({
      parent: null,
      transactions: {},
      signature: null
    }, input);

    return this;
  }

  get transactions () {
    return this._state.transactions;
  }

  validate () {
    // TODO: implement validators
  }
}

module.exports = Block;
