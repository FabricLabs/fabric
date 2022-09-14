'use strict';

const merge = require('lodash.merge');

const Actor = require('./actor');
const Tree = require('./tree');

class Block extends Actor {
  constructor (input = {}) {
    super(input);

    this._state = merge({
      parent: null,
      transactions: {},
      signatures: [],
      content: {
        ...super.state
      }
    }, input);

    Object.defineProperty(this, '_events', { enumerable: false });
    Object.defineProperty(this, '_eventCount', { enumerable: false });
    Object.defineProperty(this, 'observer', { enumerable: false });

    return this;
  }

  get tree () {
    return new Tree({
      leaves: Object.keys(this.transactions)
    });
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
