'use strict';

// Constants
const {
  FABRIC_KEY_DERIVATION_PATH
} = require('../constants');

// Node Modules
const crypto = require('crypto');

// Deterministic Random
// TODO: remove
const Generator = require('arbitrary').default.Generator;

// Dependencies
// TODO: remove all external dependencies
const BN = require('bn.js');
const EC = require('elliptic').ec;
const ec = new EC('secp256k1');
const ecc = require('tiny-secp256k1');
const payments = require('bitcoinjs-lib/src/payments');

// Fabric Dependencies
const Hash256 = require('./hash256');

// Simple Key Management
const BIP32 = require('bip32').default;
const bip32 = new BIP32(ecc);
const bip39 = require('bip39');

// NOTE: see also @fabric/passport
// expect a bech32m identifier using prefix "id"

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
   * @param {String} [settings.purpose=44] Constrains derivations to this space.
   */
  constructor (input = {}) {
    this.settings = Object.assign({
      debug: false,
      network: 'main',
      curve: 'secp256k1',
      derivation: FABRIC_KEY_DERIVATION_PATH,
      mode: 'aes-256-cbc',
      prefix: '00',
      public: null,
      private: null,
      purpose: 44,
      account: 0,
      bits: 256,
      hd: true,
      seed: null,
      passphrase: '',
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

    // TODO: design state machine for input (configuration)
    if (this.settings.seed) {
      this._mode = 'FROM_SEED';
    } else if (this.settings.private) {
      this._mode = 'FROM_PRIVATE_KEY';
    } else if (this.settings.xprv) {
      this._mode = 'FROM_XPRV';
    } else if (this.settings.xpub) {
      this._mode = 'FROM_XPUB';
    } else if (this.settings.pubkey || this.settings.public) {
      this._mode = 'FROM_PUBLIC_KEY';
    } else {
      this._mode = 'FROM_RANDOM';
    }

    switch (this._mode) {
      case 'FROM_SEED':
        const seed = bip39.mnemonicToSeedSync(this.settings.seed, this.settings.passphrase);
        const root = bip32.fromSeed(seed);

        this.seed = this.settings.seed;

        this.xprv = root.toBase58();
        this.xpub = root.neutered().toBase58();
        this.master = root;
        this.keypair = ec.keyFromPrivate(root.privateKey);
        // this.address = this.keyring.getAddress().toString();
        this.status = 'seeded';
        break;
      case 'FROM_XPRV':
        this.master = bip32.fromBase58(this.settings.xprv);
        this.xprv = this.master.toBase58();
        this.xpub = this.master.neutered().toBase58();
        this.keypair = ec.keyFromPrivate(this.master.privateKey);
        break;
      case 'FROM_XPUB':
        const xpub = bip32.fromBase58(this.settings.xpub);
        this.keypair = ec.keyFromPublic(xpub.publicKey);
        break;
      case 'FROM_PRIVATE_KEY':
        // Key is private
        const provision = (this.settings.private instanceof Buffer) ? this.settings.private : Buffer.from(this.settings.private, 'hex');
        this.keypair = ec.keyFromPrivate(provision);
        break;
      case 'FROM_PUBLIC_KEY':
        const pubkey = this.settings.pubkey || this.settings.public;
        // Key is only public
        this.keypair = ec.keyFromPublic((pubkey instanceof Buffer) ? pubkey : Buffer.from(pubkey, 'hex'));
        break;
      case 'FROM_RANDOM':
        const mnemonic = bip39.generateMnemonic();
        const interim = bip39.mnemonicToSeedSync(mnemonic);
        this.master = bip32.fromSeed(interim);
        this.keypair = ec.keyFromPrivate(this.master.privateKey);
        break;
    }

    // Read the pair
    this.private = (
      !this.settings.seed &&
      !this.settings.private &&
      !this.settings.xprv
    ) ? false : this.keypair.getPrivate();

    this.public = this.keypair.getPublic(true);

    // TODO: determine if this makes sense / needs to be private
    this.privkey = (this.private) ? this.private.toString() : null;

    // STANDARD BEGINS HERE
    this.pubkey = this.public.encodeCompressed('hex');

    // BELOW THIS NON-STANDARD
    // DO NOT USE IN PRODUCTION
    // this.pubkeyhash = this.keyring.getKeyHash('hex');
    this.pubkeyhash = '';

    // Configure Deterministic Random
    // WARNING: this will currently loop after 2^32 bits
    // TODO: evaluate compression when treating seed phrase as ascii
    // TODO: consider using sha256(masterprivkey) or sha256(sha256(...))?

    this._starseed = Hash256.digest((
      this.settings.seed ||
      this.settings.xprv ||
      this.settings.private
    ) + '');

    this.q = parseInt(this._starseed.substring(0, 4), 16);
    this.generator = new Generator(this.q);

    this['@data'] = {
      type: 'Key',
      public: this.pubkey,
      address: this.address
    };

    this._state = {
      pubkey: this.pubkey
    };

    // Object.defineProperty(this, 'keyring', { enumerable: false });
    Object.defineProperty(this, 'keypair', { enumerable: false });
    Object.defineProperty(this, 'private', { enumerable: false });

    return this;
  }

  static Mnemonic (seed) {
    return new Key({ seed });
  }

  get account () {
    return this.settings.account;
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

  get purpose () {
    return this.settings.purpose;
  }

  bit () {
    return this.generator.next.bits(1);
  }

  /* export () {
    return {
      addresses: {
        p2wkh: null,
        p2tr: null
      },
      private: this.keypair.private,
      public: this.keypair.public
    };
  } */

  deriveAccountReceive (index) {
    return this.deriveAddress(index);
  }

  deriveAddress (index = 0, change = 0) {
    const pair = this.deriveKeyPair(this.account, index, change);
    return payments.p2pkh({
      pubkey: Buffer.from(pair.public, 'hex')
    });
  }

  deriveKeyPair (addressID = 0, change = 0) {
    const path = `m/${this.purpose}'/0'/${this.account}'/${change}/${addressID}`;
    const derived = this.master.derivePath(path);
    const pair = ec.keyFromPrivate(derived.privateKey);
    return {
      private: pair.getPrivate('hex'),
      public: pair.getPublic(true, 'hex')
    };
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
    if (!this.master) throw new Error('You cannot derive without a master key.  Provide a seed phrase or an xprv.');
    const derived = this.master.derivePath(path);
    const options = {
      private: derived.privateKey.encodeCompressed('hex'),
      public: derived.publicKey.encodeCompressed('hex')
    };

    return new Key(options);
  }
}

module.exports = Key;
