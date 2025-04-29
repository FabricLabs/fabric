'use strict';

const crypto = require('crypto');

const Actor = require('../actor');
const Key = require('../key');
// TODO: PSBTs

class BitcoinTransaction extends Actor {
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      raw: null
    }, settings);

    this.holder = new Key(this.settings.key);

    this.inputs = [];
    this.outputs = [];
    this.script = null;
    this.signature = null;

    this._state = {
      content: {
        raw: null
      },
      status: 'PAUSED'
    };

    return this;
  }

  get hash () {
    return '<hash>'; // TODO: real hash
  }

  get id () {
    return '<fabricID>'; // TODO: Fabric ID
  }

  get txid () {
    return '<txID>'; // TODO: bitcoin txid
  }

  signAsHolder () {
    const hash = crypto.createHash('sha256').update('').digest('hex');
    this.signature = this.holder.sign(hash);
    return this;
  }
}

module.exports = BitcoinTransaction;
