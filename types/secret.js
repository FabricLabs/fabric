'use strict';

const crypto = require('crypto');
const EncryptedPromise = require('./promise');

class Secret extends EncryptedPromise {
  constructor (settings = {}) {
    super(settings);

    // assign internal secret
    this._secret = (typeof settings === 'string') ? settings : JSON.stringify(settings);

    // TODO: check and document upstream pattern
    this.load();
  }

  get hash () {
    return crypto.createHash('sha256').update(this.data.content).digest('hex');
  }

  get data () {
    return {
      hash: this._state.blob,
      content: this._state.blob.toString()
    };
  }
}

module.exports = Secret;
