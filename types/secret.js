'use strict';

const EncryptedPromise = require('./promise');

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