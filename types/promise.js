'use strict';

const crypto = require('crypto');
const {
  isSealedEnvelope,
  openSealedJson,
  sealJson
} = require('../functions/sealedBlob');

const MAX_MEMORY = Math.pow(2, 21) + (64 * 1000);
// A restored envelope chooses its own PBKDF2 cost; above this, `decrypt`
// would be a CPU sink for whoever handed us the envelope.
const MAX_PBKDF2_ITERATIONS = 600000;

/**
 * Reject an envelope whose PBKDF2 iteration count exceeds
 * `MAX_PBKDF2_ITERATIONS`.
 * @private
 * @param {Object} seal
 */
function _checkIterations (seal) {
  const iterations = Number(seal && seal.kdf && seal.kdf.iterations);
  if (Number.isFinite(iterations) && iterations > MAX_PBKDF2_ITERATIONS) {
    throw new Error(`Invalid PBKDF2 iteration count; maximum is ${MAX_PBKDF2_ITERATIONS}.`);
  }
}

/**
 * A value that can be sealed with a password.  Sealing uses
 * `functions/sealedBlob` (AES-256-GCM, PBKDF2-SHA256, random salt and IV);
 * {@link EncryptedPromise#state} and {@link EncryptedPromise#toString} only
 * ever expose the sealed envelope, never the plaintext or the password.
 * Sealing drops the plaintext from memory; `decrypt` brings it back.
 */
class EncryptedPromise {
  /**
   * @param {Object} [settings]
   * @param {string|Object} [settings.value] Plaintext to hold; objects are JSON-encoded.  Defaults to the other settings as JSON.
   * @param {string} [settings.password] Seal immediately with this password (at least 8 characters).
   * @param {Object} [settings.seal] Restore from a sealed envelope (see {@link EncryptedPromise#state}); call `decrypt` to read it.  At most `MAX_PBKDF2_ITERATIONS` PBKDF2 iterations.
   */
  constructor (settings = {}) {
    const { password, seal, ...rest } = settings;

    this.settings = Object.assign({ value: '' }, rest);
    this._state = {
      data: null,
      nonce: crypto.randomBytes(32),
      seal: null,
      state: 'UNSAFE'
    };

    if (seal) {
      if (!isSealedEnvelope(seal)) throw new Error('Invalid sealed envelope.');
      _checkIterations(seal);
      this._state.seal = seal;
      this._state.state = 'ENCRYPTED';
    } else {
      this._setData(this.settings.value || JSON.stringify(this.settings, null, '  '));
      if (password) this.encrypt(password);
    }

    this.status = 'loaded';
  }

  /**
   * SHA-256 of the sealed ciphertext.  Before the first seal (or after
   * `_assignState`), a random per-instance id, so the id never reveals a
   * guessable plaintext.
   * @type {string}
   */
  get id () {
    const preimage = this._state.seal ? this._state.seal.ciphertext : this._state.nonce;
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
   * Seal the current plaintext, then drop it (and the settings it came from) from memory.
   * @param {string} password At least 8 characters.
   * @returns {Object} The sealed envelope.
   */
  encrypt (password) {
    if (this._state.data === null) throw new Error('Nothing to encrypt; decrypt the sealed envelope first.');
    this._state.seal = sealJson(this._state.data, password, { type: 'EncryptedPromise' });
    this._state.data = null;
    // The settings are the plaintext too (`value`, or the settings themselves as JSON).
    this.settings = {};
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
    _checkIterations(this._state.seal);
    this._setData(openSealedJson(this._state.seal, password));
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

EncryptedPromise.MAX_PBKDF2_ITERATIONS = MAX_PBKDF2_ITERATIONS;

module.exports = EncryptedPromise;
