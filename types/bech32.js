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

  get content () {
    return this.settings.content;
  }

  get hrp () {
    return this.settings.hrp;
  }

  get words () {
    const buffer = (this.content instanceof Buffer) ? this.content : Buffer.from(this.content, 'hex');
    return bech32.toWords(buffer);
  }

  static decode (input = '') {
    return bech32m.decode(input);
  }

  toString () {
    return bech32m.encode(this.hrp, this.words);
  }
}

module.exports = Bech32;
