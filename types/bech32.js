'use strict';

const codec = require('./bech32/bech32');
const payment = require('./bech32/fabricPaymentBech32');

const { encode, decode, toWords, fromWords } = codec;

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

// The raw codec's `decode` returns `{ hrp, words }`, unlike `Bech32.decode`.
Bech32.Codec = codec;
Bech32.CHARSET = codec.CHARSET;
Bech32.toWords = toWords;
Bech32.fromWords = fromWords;
Bech32.convertBits = codec.convertBits;
Bech32.encodeSegwitAddress = codec.encodeSegwitAddress;
Bech32.decodeSegwitAddress = codec.decodeSegwitAddress;
// Fabric routed payment strings (`fa1…`).
Bech32.Payment = payment;

module.exports = Bech32;
