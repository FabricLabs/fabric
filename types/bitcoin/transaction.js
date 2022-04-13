'use strict';

class BitcoinTransaction {
  constructor (settings = {}) {
    this.settings = Object.assign({}, settings);
  }
}

module.exports = BitcoinTransaction;
