'use strict';

const bech32 = require('bech32-buffer');
const {
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
    return bech32m.toWords(buffer);
  }

  static decode (input = '') {
    const decoded = bech32.decode(input);
    return {
      prefix: decoded.prefix,
      content: decoded.data
    };
  }

  toString () {
    return bech32m.encode(this.hrp, this.words);
  }
}

module.exports = Bech32;
