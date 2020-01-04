'use strict';

class BitcoinBlock {
  constructor (settings = {}) {
    this.settings = Object.assign({}, settings);
    this._state = {
      transactions: []
    };
  }

  get data () {
    return this.settings;
  }
}

module.exports = BitcoinBlock;
