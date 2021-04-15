'use strict';

// TODO: replace with bcoin
const Base58Check = require('base58check');

// Dependencies
const crypto = require('crypto');
const EC = require('elliptic').ec;
const ec = new EC('secp256k1');

// External Dependencies
// TODO: remove all external dependencies
const bcoin = require('bcoin');
const {
  KeyRing,
  Mnemonic
} = require('bcoin');

// Fabric Types
const Entity = require('./entity');

/**
 * Represents a cryptographic key.
 */
class Key extends Entity {
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
  constructor (init = {}) {
    super(init);

    this.settings = this.config = Object.assign({
      network: 'main',
      curve: 'secp256k1',
      mode: 'aes-256-cbc',
      prefix: '00',
      public: null,
      private: null,
      bits: 256,
      hd: true,
      password: null,
      cipher: {
        iv: {
          size: 16
        }
      }
    }, init);

    this.master = null;
    this.private = null;
    this.public = null;

    if (this.config.seed) {
      // Seed provided, compute keys
      let mnemonic = new bcoin.Mnemonic(this.config.seed);
      let master = bcoin.hd.fromMnemonic(mnemonic);
      let ring = new bcoin.KeyRing(master, this.config.network);

      // Assign keys
      this.master = master;
      this.keypair = ec.keyFromPrivate(ring.getPrivateKey('hex'));
      this.status = 'seeded';
    } else if (this.config.private) {
      // Key is private
      this.keypair = ec.keyFromPrivate(this.config.private, 16);
    } else if (this.config.pubkey || this.config.public) {
      // Key is only public
      let pubkey = this.config.pubkey || this.config.public;
      this.keypair = ec.keyFromPublic(pubkey, 'hex');
    } else {
      // Generate new keys
      this.keypair = ec.genKeyPair();
    }

    this.private = this.keypair.getPrivate();
    this.public = this.keypair.getPublic(true);

    // STANDARD BEGINS HERE
    this.pubkey = this.public.encodeCompressed('hex');

    // BELOW THIS NON-STANDARD
    // DO NOT USE IN PRODUCTION
    this.pubkeyhash = crypto.createHash('sha256').update(this.pubkey).digest('hex');

    let input = `${this.config.prefix}${this.pubkeyhash}`;
    let hash = crypto.createHash('sha256').update(input).digest('hex');
    let safe = crypto.createHash('sha256').update(hash).digest('hex');
    let checksum = safe.substring(0, 8);
    let address = `${input}${checksum}`;

    this.ripe = crypto.createHash('ripemd160').update(input).digest('hex');
    this.address = Base58Check.encode(this.ripe);

    this['@data'] = {
      'type': 'Key',
      'public': this.pubkey,
      'address': this.address
    };

    this._state = {
      pubkey: this.pubkey
    };

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
    return crypto.randomBytes(this.settings.cipher.iv.size);
  }

  encrypt (value) {
    try {
      const iv = Buffer.from(this.iv, 'hex');
      const cipher = crypto.createCipheriv(this.settings.mode, this.private.toBuffer(), iv);
      let encrypted = cipher.update(value);
      encrypted = Buffer.concat([ encrypted, cipher.final() ]);
      return iv.toString('hex') + ':' + encrypted.toString('hex');
    } catch (exception) {
      console.error('err:', exception);
    }
  }

  decrypt (text) {
    try {
      const parts = text.split(':');
      const iv = Buffer.from(parts.shift(), 'hex');
      const blob = Buffer.from(parts.join(':'), 'hex');
      const decipher = crypto.createDecipheriv('aes-256-cbc', this.private.toBuffer(), iv);
      let decrypted = decipher.update(blob);
      decrypted = Buffer.concat([ decrypted, decipher.final() ]);
      return decrypted.toString();
    } catch (exception) {
      console.error('err:', exception);
    }
  }

  _sign (msg) {
    // console.log(`[KEY] signing: ${msg}...`);
    if (typeof msg !== 'string') msg = JSON.stringify(msg);
    let hmac = crypto.createHash('sha256').update(msg).digest('hex');
    let signature = this.keypair.sign(hmac);
    // console.log(`[KEY] signature:`, signature);
    return signature.toDER();
  }

  _verify (msg, sig) {
    let hmac = crypto.createHash('sha256').update(msg).digest('hex');
    let valid = this.keypair.verify(hmac, sig);
    return valid;
  }

  derive (path = `m/44'/0'/0'/0/0`) {
    if (!this.master) throw new Error('You cannot derive without a master key.  Provide a seed phrase.');
    return this.master.derivePath(path);
  }
}

module.exports = Key;
