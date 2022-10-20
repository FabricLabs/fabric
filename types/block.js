'use strict';

const merge = require('lodash.merge');

const Actor = require('./actor');
const Transaction = require('./transaction');
const Tree = require('./tree');

class Block extends Actor {
  constructor (input = {}) {
    super(input);

    this.settings = merge({
      type: 'Block'
    }, input);

    this._state = {
      parent: null,
      transactions: {},
      signatures: [],
      content: this.state || input
    };

    Object.defineProperty(this, '_events', { enumerable: false });
    Object.defineProperty(this, '_eventCount', { enumerable: false });
    Object.defineProperty(this, 'observer', { enumerable: false });

    for (const [id, template] of Object.entries(this.transactions)) {
      const tx = new Transaction(template);
      if (id !== tx.id) throw new Error(`Transaction hash mismatch! ${id} != ${tx.id}`);
    }

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

  get transactionIDs () {
    return (this.transactions && this.transactions.length)
      ? Object.keys(this.transactions)
      : [];
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
