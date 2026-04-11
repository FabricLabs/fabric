'use strict';

const { encode, decode, toWords, fromWords } = require('../functions/bech32');

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
    return toWords(buffer);
  }

  static decode (input = '') {
    const d = decode(input);
    return {
      prefix: d.hrp,
      content: fromWords(d.words)
    };
  }

  toString () {
    return encode(this.hrp, this.words, 'bech32m');
  }
}

module.exports = Bech32;
