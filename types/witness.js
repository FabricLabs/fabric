'use strict';

const crypto = require('crypto');
const EC = require('elliptic').ec;
const Key = require('./key');

class Witness {
  constructor (settings = {}) {
    this.ec = new EC('secp256k1');
    this.settings = Object.assign({
      curve: 'secp256k1',
      data: null,
      keypair: null
    }, settings);

    this.buffer = Buffer.alloc(32 * 256);
    this._state = {
      data: this.settings.data
    };

    if (settings && settings.keypair) {
      if (settings.keypair.private) {
        this._usePrivateKey(settings.keypair.private);
      } else if (settings.keypair.public) {
        this._usePublicKey(settings.keypair.public);
      }
    }

    if (!this.keypair) {
      this.keypair = this.ec.genKeyPair();
    }

    if (settings && settings.data) {
      this._loadData(settings.data);
    }

    Object.defineProperty(this, 'ec', { enumerable: false });
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
    return this.keypair.getPublic().encode('hex');
  }

  get signature () {
    // return this.keypair.sign(this.hash).toDER().toString('hex');
    const sig = this.keypair.sign(this.hash);
    return {
      curve: this.settings.curve,
      r: sig.r.toString('hex'),
      s: sig.s.toString('hex')
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
      private: this.keypair.getPrivate(),
      public: this.keypair.getPublic()
    };
  }

  _usePrivateKey (key) {
    this.keypair = this.ec.keyFromPrivate(key, 'hex');
  }

  _usePublicKey (key) {
    this.keypair = this.ec.keyFromPublic(key, 'hex');
    console.log(`using public key ${key}, generated keypair:`, this.keypair);
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
    const sig = this.signature;
    const R = sig.r;
    const S = sig.s;

    const payload = [
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

    const raw = [
      0x30, // indicates compound structure
      Buffer.from(payload, 'hex').size // payload size
    ].join('') + payload;

    const der = Buffer.from(raw, 'hex');

    return der;
  }

  verify (msg, signature) {
    const hash = this.digest(msg);
    const verifies = this.keypair.verify(hash, signature);
    const verification = {
      msg: msg,
      hash: hash,
      pubkey: this.pubkey,
      signature: signature,
      verifies: verifies
    };

    return verification;
  }
}

module.exports = Witness;
