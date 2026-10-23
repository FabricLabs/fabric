'use strict';

const crypto = require('crypto');
const {
  isSealedEnvelope,
  openSealedJson,
  sealJson
} = require('../functions/sealedBlob');

const MAX_MEMORY = Math.pow(2, 21) + (64 * 1000);

/**
 * A value that can be sealed with a password.  Sealing uses
 * `functions/sealedBlob` (AES-256-GCM, PBKDF2-SHA256, random salt and IV);
 * {@link EncryptedPromise#state} and {@link EncryptedPromise#toString} only
 * ever expose the sealed envelope, never the plaintext or the password.
 */
class EncryptedPromise {
  /**
   * @param {Object} [settings]
   * @param {string|Object} [settings.value] Plaintext to hold; objects are JSON-encoded.  Defaults to the other settings as JSON.
   * @param {string} [settings.password] Seal immediately with this password (at least 8 characters).
   * @param {Object} [settings.seal] Restore from a sealed envelope (see {@link EncryptedPromise#state}); call `decrypt` to read it.
   */
  constructor (settings = {}) {
    const { password, seal, ...rest } = settings;

    this.settings = Object.assign({ value: '' }, rest);
    this._state = {
      data: null,
      seal: null,
      state: 'UNSAFE'
    };

    if (seal) {
      if (!isSealedEnvelope(seal)) throw new Error('Invalid sealed envelope.');
      this._state.seal = seal;
      this._state.state = 'ENCRYPTED';
    } else {
      this._setData(this.settings.value || JSON.stringify(this.settings, null, '  '));
      if (password) this.encrypt(password);
    }

    this.status = 'loaded';
  }

  /**
   * SHA-256 of the plaintext, or of the sealed ciphertext while only the
   * envelope is known.
   * @type {string}
   */
  get id () {
    const preimage = (this._state.data !== null) ? this._state.data : this._state.seal.ciphertext;
    return crypto.createHash('sha256').update(preimage).digest('hex');
  }

  /**
   * Safe to persist: the sealed envelope (or `null` until sealed).
   * @type {Object}
   */
  get state () {
    return {
      type: 'EncryptedPromise',
      status: this._state.state,
      seal: this._state.seal
    };
  }

  /**
   * Replace the plaintext with `state` and drop the sealed envelope.
   * @private
   * @param {*} state JSON-serializable value
   */
  async _assignState (state) {
    this.status = 'assigning';
    this._setData(JSON.stringify(state));
    this._state.seal = null;
    this._state.state = 'UNSAFE';
    this.status = 'assigned';
  }

  /**
   * Set the plaintext, serializing non-strings as JSON.
   * @private
   * @param {*} value
   * @throws {Error} when the UTF-8 plaintext exceeds `MAX_MEMORY` bytes
   */
  _setData (value) {
    const data = (typeof value === 'string') ? value : JSON.stringify(value);
    if (Buffer.byteLength(data, 'utf8') > MAX_MEMORY) {
      throw new Error(`Promise not created, input too large, maximum size is ${MAX_MEMORY}`);
    }
    this._state.data = data;
  }

  /**
   * Pair a message with this promise's id.
   * @param {*} msg
   * @returns {{ id: string, msg: * }}
   */
  resolve (msg) {
    return {
      id: this.id,
      msg: msg
    };
  }

  /**
   * Not implemented; use {@link EncryptedPromise#encrypt}.
   */
  lock () {
    // TODO: encrypt state
  }

  /**
   * Seal the current plaintext.
   * @param {string} password At least 8 characters.
   * @returns {Object} The sealed envelope.
   */
  encrypt (password) {
    if (this._state.data === null) throw new Error('Nothing to encrypt; decrypt the sealed envelope first.');
    this._state.seal = sealJson(this._state.data, password, { type: 'EncryptedPromise' });
    this._state.state = 'ENCRYPTED';
    return this._state.seal;
  }

  /**
   * Open the sealed envelope.
   * @param {string} password
   * @returns {string} The plaintext.
   */
  decrypt (password) {
    if (!this._state.seal) throw new Error('Nothing to decrypt; this promise has not been sealed.');
    this._state.data = openSealedJson(this._state.seal, password);
    this._state.state = 'DECRYPTED';
    return this._state.data;
  }

  /**
   * Not implemented; use {@link EncryptedPromise#decrypt}.
   */
  unlock () {
    // TODO: recover state
  }

  /**
   * The persistable {@link EncryptedPromise#state} as indented JSON (never the plaintext).
   * @returns {string}
   */
  toString () {
    return JSON.stringify(this.state, null, '  ');
  }
}

module.exports = EncryptedPromise;
