'use strict';

// Constants
const {
  FABRIC_KEY_DERIVATION_PATH
} = require('../constants');

// Dependencies
const Generator = require('arbitrary').default.Generator;
const crypto = require('crypto');
const BN = require('bn.js');
const EC = require('elliptic').ec;
const ec = new EC('secp256k1');

// External Dependencies
// TODO: remove all external dependencies
const bcoin = require('bcoin/lib/bcoin-browser');
const HD = bcoin.hd;
const KeyRing = bcoin.KeyRing;
const Mnemonic = bcoin.hd.Mnemonic;

// Fabric Types
// const Entity = require('./entity');
// const Machine = require('./machine');

/**
 * Represents a cryptographic key.
 */
class Key {
  /**
   * Create an instance of a Fabric Key, either restoring from some known
   * values or from prior knowledge.  For instance, you can call `new Key()`
   * to create a fresh keypair, or `new Key({ public: 'deadbeef...' })` to
   * create it from a known public key.
   * @param {Object} [settings] Initialization for the key.
   * @param {String} [settings.network] Network string.
   * @param {String} [settings.seed] Mnemonic seed for initializing the key.
   * @param {String} [settings.public] Public key in hex.
   * @param {String} [settings.private] Private key in hex.
   */
  constructor (input = {}) {
    this.settings = Object.assign({
      network: 'main',
      curve: 'secp256k1',
      derivation: FABRIC_KEY_DERIVATION_PATH,
      mode: 'aes-256-cbc',
      prefix: '00',
      public: null,
      private: null,
      bits: 256,
      hd: true,
      seed: null,
      password: null,
      index: 0,
      cipher: {
        iv: {
          size: 16
        }
      },
      witness: true
    }, input);

    this.clock = 0;
    this.master = null;
    this.private = null;
    this.public = null;

    this._starseed = this.settings.seed || crypto.randomBytes(4).toString('ascii');
    this.generator = new Generator(parseFloat(this._starseed));

    // TODO: design state machine for input (configuration)
    if (this.settings.seed) {
      // Seed provided, compute keys
      const mnemonic = new Mnemonic(this.settings.seed);
      const master = HD.fromMnemonic(mnemonic);

      // Assign keys
      this.master = master;
      this.keyring = new KeyRing(master, this.settings.network);
      this.keyring.witness = this.settings.witness;
      this.keypair = ec.keyFromPrivate(this.keyring.getPrivateKey('hex'));
      this.address = this.keyring.getAddress().toString();
      this.status = 'seeded';
    } else if (this.settings.private) {
      const input = this.settings.private;
      const provision = (input instanceof Buffer) ? input : Buffer.from(input, 'hex');
      // Key is private
      this.keyring = KeyRing.fromPrivate(provision, true);
      this.keyring.witness = this.settings.witness;
      this.keypair = ec.keyFromPrivate(this.settings.private);
      this.address = this.keyring.getAddress();
    } else if (this.settings.pubkey || this.settings.public) {
      const input = this.settings.pubkey || this.settings.public;
      // Key is only public
      this.keyring = KeyRing.fromKey((input instanceof Buffer) ? input : Buffer.from(input, 'hex'), true);
      this.keypair = ec.keyFromPublic(this.keyring.getPublicKey(true, 'hex'));
      this.address = this.keyring.getAddress();
    } else {
      // Generate new keys
      this.keypair = ec.genKeyPair();
      const input = this.keypair.getPrivate().toBuffer(null, 32);
      this.keyring = KeyRing.fromPrivate(input, true);
      this.keyring.witness = this.settings.witness;
      this.address = this.keyring.getAddress();
    }

    this.private = this.keypair.getPrivate();
    this.public = this.keypair.getPublic(true);

    // TODO: determine if this makes sense / needs to be private
    this.privkey = (this.private) ? this.private.toString() : null;

    // STANDARD BEGINS HERE
    this.pubkey = this.public.encodeCompressed('hex');

    // BELOW THIS NON-STANDARD
    // DO NOT USE IN PRODUCTION
    this.pubkeyhash = this.keyring.getKeyHash('hex');


    this['@data'] = {
      type: 'Key',
      public: this.pubkey,
      address: this.address
    };

    this._state = {
      pubkey: this.pubkey
    };

    Object.defineProperty(this, 'keyring', {
      enumerable: false
    });

    Object.defineProperty(this, 'keypair', {
      enumerable: false
    });

    Object.defineProperty(this, 'private', {
      enumerable: false
    });

    return this;
  }

  static Mnemonic (seed) {
    return new Mnemonic(seed);
  }

  get id () {
    return this.pubkeyhash;
  }

  get iv () {
    const self = this;
    const bits = new BN([...Array(128)].map(() => {
      return self.bit().toString();
    }).join(''), 2).toString(16);
    return Buffer.from(bits.toString(16), 'hex');
  }

  bit () {
    return this.generator.next.bits(1);
  }

  encrypt (value) {
    try {
      const ivbuff = Buffer.from(this.iv, 'hex');
      const cipher = crypto.createCipheriv(this.settings.mode, this.private.toBuffer(), ivbuff);
      let encrypted = cipher.update(value);
      encrypted = Buffer.concat([
        encrypted,
        cipher.final()
      ]);
      return ivbuff.toString('hex') + ':' + encrypted.toString('hex');
    } catch (exception) {
      console.error('err:', exception);
    }
  }

  decrypt (text) {
    if (text instanceof Buffer) text = text.toString('utf8');

    try {
      const parts = text.split(':');
      const iv = Buffer.from(parts.shift(), 'hex');
      const blob = Buffer.from(parts.join(':'), 'hex');
      const decipher = crypto.createDecipheriv(this.settings.mode, this.private.toBuffer(), iv);
      let decrypted = decipher.update(blob);
      decrypted = Buffer.concat([
        decrypted,
        decipher.final()
      ]);
      return decrypted.toString();
    } catch (exception) {
      console.error('err:', exception);
    }
  }

  _sign (msg) {
    if (typeof msg !== 'string') msg = JSON.stringify(msg);
    const hmac = crypto.createHash('sha256').update(msg).digest('hex');
    return this.keypair.sign(hmac).toDER();
  }

  _verify (msg, sig) {
    const hmac = crypto.createHash('sha256').update(msg).digest('hex');
    const valid = this.keypair.verify(hmac, sig);
    return valid;
  }

  derive (path = this.settings.derivation) {
    if (!this.master) throw new Error('You cannot derive without a master key.  Provide a seed phrase.');
    return this.master.derivePath(path);
  }
}

module.exports = Key;
