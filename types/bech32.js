'use strict';

const {
  bech32,
  bech32m
} = require('bech32');

class Bech32 {
  constructor (input = {}) {
    this.settings = Object.assign({
      hrp: 'bc',
      separator: '1',
      content: ''
    }, input);

    return this;
  }

  get hrp () {
    return this.settings.hrp;
  }

  get content () {
    return this.settings.hrp;
  }

  decode (input = '') {
    return bech32m.decode(input);
  }

  toString () {
    return bech32m.encode(this.hrp, this.content);
  }
}

module.exports = Bech32;
