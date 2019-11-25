'use strict';

const crypto = require('crypto');
const Network = require('./network');
const Witness = require('./witness');
const MAX_MEMORY = Math.pow(2, 21) + (64 * 1000);

class Secret extends EncryptedPromise {
  constructor (settings = {}) {
    super(settings);

    // assign internal secret
    this._secret = (typeof settings === 'string') ? settings : JSON.stringify(settings);

    // TODO: check and document upstream pattern
    this.load();
  }
}

module.exports = EncryptedPromise;