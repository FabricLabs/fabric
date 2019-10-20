'use strict';

const crypto = require('crypto');
const Network = require('./network');
const MAX_MEMORY = Math.pow(2, 21) + (64 * 1000);

class EncryptedPromise {
  constructor (settings = {}) {
    // Assign Settings
    // TODO: make private
    this.settings = Object.assign({}, settings);

    // Create Internal State
    this._state = {
      blob: Buffer.alloc(MAX_MEMORY),
      data: JSON.stringify(this._settings)
    };

    if (this._state.data.length > this._state.blob.size) {
      throw new Error(`Promise not created, input too large, maximum size is ${MAX_MEMORY}`);
    }

    Object.defineProperty(this, '_state', { enumerable: false });

    this.load();
  }

  get id () {
    return crypto.createHash('sha256').update(this._state.data).digest('hex');
  }

  get state () {
    this.load();

    // TODO: formalize type
    return {
      type: 'EncryptedPromise',
      blob: this._state.blob
    };
  }

  set settings (map) {
    this._settings = map;
  }

  load () {
    this._state.blob.write(this._state.data);
  }

  resolve (msg) {
    return {
      id: this.id,
      msg: msg
    };
  }

  decrypt () {
    
  }
}

module.exports = EncryptedPromise;