'use strict';

class Block {
  constructor (settings = {}) {
    this.settings = Object.assign({}, settings);
    this._state = {
      transactions: [],
      confirmations: 0
    };
  }
}

module.exports = Block;