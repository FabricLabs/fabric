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
  Address,
  KeyRing,
  Mnemonic
} = require('bcoin');

// Fabric Types
const Entity = require('./entity');
const Machine = require('./machine');

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

    this.settings = Object.assign({
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
      },
      witness: true
    }, init);

    this.master = null;
    this.private = null;
    this.public = null;

    this.machine = new Machine(this.settings);

    if (this.settings.seed) {
      // Seed provided, compute keys
      const mnemonic = new Mnemonic(this.settings.seed);
      const master = bcoin.hd.fromMnemonic(mnemonic);

      // Assign keys
      this.master = master;
      this.keyring = new KeyRing(master, this.settings.network);
      this.keyring.witness = this.settings.witness;
      this.keypair = ec.keyFromPrivate(this.keyring.getPrivateKey('hex'));
      this.address = this.keyring.getAddress().toString();
      this.status = 'seeded';
    } else if (this.settings.private) {
      const input = this.settings.private;
      // Key is private
      this.keyring = KeyRing.fromPrivate((input instanceof Buffer) ? input : Buffer.from(input, 'hex'), true);
      this.keyring.witness = this.settings.witness;
      this.keypair = ec.keyFromPrivate(this.settings.private);
      this.address = this.keyring.getAddress();
    } else if (this.settings.pubkey || this.settings.public) {
      const input = this.settings.pubkey || this.settings.public;
      // Key is only public
      this.keyring = KeyRing.fromKey((input instanceof Buffer) ? input : Buffer.from(input, 'hex'), true);
      this.keyring.witness = this.settings.witness;
      this.keypair = ec.keyFromPublic(this.keyring.getPublic(true, 'hex'));
      this.address = this.keyring.getAddress();
    } else {
      // Generate new keys
      this.keypair = ec.genKeyPair();
      this.keyring = KeyRing.fromPrivate(this.keypair.getPrivate().toBuffer(), true);
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
    return this.machine.slurp(32).slice(0, 32);
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
