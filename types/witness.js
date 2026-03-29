'use strict';

const crypto = require('crypto');
const { secp256k1 } = require('@noble/curves/secp256k1.js');
const Key = require('./key');

class Witness {
  constructor (settings = {}) {
    this.settings = Object.assign({
      curve: 'secp256k1',
      data: null,
      keypair: null
    }, settings);

    this.buffer = Buffer.alloc(32 * 256);
    this._state = {
      data: this.settings.data
    }

    if (settings && settings.keypair) {
      if (settings.keypair.private) {
        this._usePrivateKey(settings.keypair.private);
      } else if (settings.keypair.public) {
        this._usePublicKey(settings.keypair.public);
      }
    }

    if (!this.keypair) {
      const privateKey = crypto.randomBytes(32);
      const publicKey = Buffer.from(secp256k1.getPublicKey(privateKey, false));
      this.keypair = { privateKey, publicKey };
    }

    if (settings && settings.data) {
      this._loadData(settings.data);
    }

    Object.defineProperty(this, 'buffer', { enumerable: false });
    Object.defineProperty(this, 'keypair', { enumerable: false });

    return this;
  }

  get data () {
    return this._state.data;
  }

  get hash () {
    return this.digest(this._state.data || '');
  }

  get pubkey () {
    return Buffer.from(this.keypair.publicKey).toString('hex');
  }

  get signature () {
    const digest = Buffer.from(this.hash, 'hex');
    const sig = secp256k1.sign(digest, this.keypair.privateKey, { prehash: false });
    const compact = (sig && typeof sig.toCompactRawBytes === 'function')
      ? Buffer.from(sig.toCompactRawBytes())
      : Buffer.from(sig);

    return {
      curve: this.settings.curve,
      r: compact.slice(0, 32).toString('hex'),
      s: compact.slice(32, 64).toString('hex')
    };
  }

  digest (data) {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  lock () {
    return Object.freeze(this);
  }

  _dumpKeypair () {
    return {
      private: this.keypair.privateKey,
      public: this.keypair.publicKey
    }
  }

  _usePrivateKey (key) {
    const privateKey = Buffer.isBuffer(key) ? key : Buffer.from(key, 'hex');
    const publicKey = Buffer.from(secp256k1.getPublicKey(privateKey, false));
    this.keypair = { privateKey, publicKey };
  }

  _usePublicKey (key) {
    const publicKey = Buffer.isBuffer(key) ? key : Buffer.from(key, 'hex');
    this.keypair = { publicKey };
  }

  _loadData (data) {
    if (data && typeof data !== 'string') data = JSON.stringify(data);
    if (this.buffer.size < data.length) return new Error(`Insufficient storage (needed ${data.length} bytes)`);

    try {
      // set internal state and write buffer...
      this._state.data = data;
      this.buffer.write(data);
    } catch (E) {
      console.error('Could not write data for Witness:', E);
    }

    return this;
  }

  _fromBitcoinSignature (signature = {}) {

  }

  /**
   * Converts the Witness to a Compact DER format.
   */
  toCompactDER () {
    let sig = this.signature;
    let R = sig.r;
    let S = sig.s;

    let payload = [
      0x02, // a header byte indicating an integer.
      32, // A 1-byte length descriptor for the R value
      // TODO: assign R coordinate
      R, // The R coordinate, as a big-endian integer.
      0x02, // a header byte indicating an integer.
      32, // A 1-byte length descriptor for the S value.
      // TODO: assign S coordinate
      S // The S coordinate, as a big-endian integer.
    ].map(x => x.toString(16)).join('');

    console.log('payload:', payload);

    let raw = [
      0x30, // indicates compound structure
      Buffer.from(payload, 'hex').size, // payload size
    ].join('') + payload;

    let der = Buffer.from(raw, 'hex');

    return der;
  }

  verify (msg, signature) {
    const hash = Buffer.from(this.digest(msg), 'hex');
    const publicKey = Buffer.from(this.keypair.publicKey);
    const compact = Buffer.concat([
      Buffer.from(signature.r, 'hex'),
      Buffer.from(signature.s, 'hex')
    ]);
    const verifies = secp256k1.verify(compact, hash, publicKey, { prehash: false });
    let verification = {
      msg: msg,
      hash: hash.toString('hex'),
      pubkey: this.pubkey,
      signature: signature,
      verifies: verifies
    };

    return verification;
  }
}

module.exports = Witness;