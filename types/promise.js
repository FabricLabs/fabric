'use strict';

const crypto = require('crypto');
const SimpleAES = require('simple-aes').default;
const Hash256 = require('./hash256');
const Network = require('./network');
const Witness = require('./witness');
const MAX_MEMORY = Math.pow(2, 21) + (64 * 1000);

class EncryptedPromise {
  constructor (settings = {}) {
    // Assign Settings
    // TODO: make private
    this.settings = Object.assign({
      iv: '',
      ciphertext: '',
      password: '',
      value: '',
      state: 'UNSAFE'
    }, settings);

    this._settings = Object.assign({}, this.settings);

    // Create Internal State
    this._state = {
      blob: Buffer.alloc(MAX_MEMORY),
      data: (settings.value) ? settings.value : JSON.stringify(this._settings, null, '  '),
      state: 'UNSAFE'
    };

    if (!this._settings.iv && this._settings.password) {
      this.settings.iv = Hash256.digest(this._settings.password);
    }

    if (this._state.data.length > this._state.blob.size) {
      throw new Error(`Promise not created, input too large, maximum size is ${MAX_MEMORY}`);
    }

    // Object.defineProperty(this, '_state', { enumerable: false });

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

  async _assignState (state) {
    this.status = 'assigning';
    this._state.data = JSON.stringify(state);
    this.load();
    this.status = 'assigned';
  }

  load () {
    this.status = 'loading';
    this._state.blob.write(this._state.data);

    if (this._settings.iv && this._settings.ciphertext) {

    } else {
      this.encrypt(this._settings.password);
    }

    this.status = 'loaded';
  }

  resolve (msg) {
    return {
      id: this.id,
      msg: msg
    };
  }

  lock () {
    // TODO: encrypt state
  }

  encrypt (password = '') {
    const iv = Hash256.digest(password);
    const aes = new SimpleAES(256, iv);
    const data = (this._state.data instanceof String) ? this._state.data : this._state.data.toString('utf8');
    const enc = aes.encrypt(data);

    this._state.blob.write(enc.ciphertext);
    this._state.state = 'ENCRYPTED';
  }

  decrypt (password = '') {
    const iv = Hash256.digest(password);
    const aes = new SimpleAES(256, iv);
    const data = aes.decrypt(iv, this._state.blob);
    console.log('decrypted:', data);
    this._state.data = data;
    this._state.state = 'DECRYPTED';
    return data;
  }

  unlock () {
    // TODO: recover state
  }

  toString () {
    return JSON.stringify(this._state, null, '  ');
  }
}

module.exports = EncryptedPromise;
