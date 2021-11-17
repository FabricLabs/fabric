'use strict';

const Actor = require('./actor');
const merge = require('lodash.merge');

class Block extends Actor {
  constructor (input = {}) {
    super(input);

    this._state = merge({
      parent: null,
      transactions: {},
      signatures: []
    }, input);

    return this;
  }

  get transactions () {
    return this._state.transactions;
  }

  sign () {
    const actor = new Actor(this._state);
    const data = actor.toString();
    const array = this.key._sign(data);
    this._state.signature = Buffer.from(array);
    return this._state.signature;
  }

  validate () {
    // TODO: implement validators
  }
}

module.exports = Block;
