/**
 * @fabric/core/types/key
 * A cryptographic key management system for the Fabric protocol.
 * Provides functionality for key generation, derivation, signing and encryption.
 * 
 * @signers
 * - Eric Martindale <eric@ericmartindale.com>
 */
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
      state: {
        status: 'sensitive'
      },
      witness: true,
      networks: {
        mainnet: {
          messagePrefix: '\x18Bitcoin Signed Message:\n',
          bech32: 'bc',
          bip32: {
            public: 0x0488b21e,
            private: 0x0488ade4
          },
          pubKeyHash: 0x00,
          scriptHash: 0x05,
          wif: 0x80
        },
        testnet: {
          messagePrefix: '\x18Bitcoin Signed Message:\n',
          bech32: 'tb',
          bip32: {
            public: 0x043587cf,
            private: 0x04358394
          },
          pubKeyHash: 0x6f,
          scriptHash: 0xc4,
          wif: 0xef
        },
        regtest: {
          messagePrefix: '\x18Bitcoin Signed Message:\n',
          bech32: 'bcrt',
          bip32: {
            public: 0x043587cf,
            private: 0x04358394
          },
          pubKeyHash: 0x6f,
          scriptHash: 0xc4,
          wif: 0xef
        }
      }
    }, input);

    this.bip32 = new BIP32(ecc);
    this._bech32mCharset = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';


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
        const root = this.bip32.fromSeed(seed);
        this.seed = this.settings.seed;
        this.xprv = root.toBase58();
        this.xpub = root.neutered().toBase58();
        this.master = root;
        this.keypair = ec.keyFromPrivate(root.privateKey);
        this.status = 'seeded';
        break;
      case 'FROM_XPRV':
        this.master = this.bip32.fromBase58(this.settings.xprv);
        this.xprv = this.master.toBase58();
        this.xpub = this.master.neutered().toBase58();
        this.keypair = ec.keyFromPrivate(this.master.privateKey);
        break;
      case 'FROM_XPUB':
        const xpub = this.bip32.fromBase58(this.settings.xpub);
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
        this.master = this.bip32.fromSeed(interim);
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
    ) + '').toString('hex');

    if (!this._starseed) this._starseed = '0000000000000000000000000000000000000000000000000000000000000000';

    this.q = parseInt(this._starseed.substring(0, 4), 16);
    this.generator = new Generator(this.q);

    this['@data'] = {
      type: 'Key',
      public: this.pubkey,
      address: this.address
    };

    this._state = {
      pubkey: this.pubkey,
      content: this.settings.state
    };

    // Object.defineProperty(this, 'keyring', { enumerable: false });
    Object.defineProperty(this, 'keypair', { enumerable: false });
    Object.defineProperty(this, 'private', { enumerable: false });

    return this;
  }

  static Mnemonic (seed) {
    if (!seed) {
      seed = crypto.randomBytes(32);
    }
    const mnemonic = bip39.entropyToMnemonic(seed);
    const seedBuffer = bip39.mnemonicToSeedSync(mnemonic);
    const bip32 = new BIP32(ecc);
    const master = bip32.fromSeed(seedBuffer);
    const key = new Key();
    key.seed = mnemonic;
    key.private = master.privateKey.toString('hex');
    key.public = master.publicKey.toString('hex');
    key.chainCode = master.chainCode.toString('hex');
    key.depth = master.depth;
    key.index = master.index;
    key.parentFingerprint = master.parentFingerprint;
    key.fingerprint = master.fingerprint;
    key.keypair = master;
    return key;
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

  deriveAddress (index = 0, change = 0, type = 'p2pkh') {
    const key = this.deriveKeyPair(index, change);
    const network = this.settings.network === 'regtest' ? this.settings.networks.testnet : this.settings.networks[this.settings.network];

    switch (type) {
      case 'p2pkh':
        return {
          address: payments.p2pkh({
            pubkey: Buffer.from(key.publicKey, 'hex'),
            network: network
          }).address,
          publicKey: key.publicKey,
          privateKey: key.privateKey
        };
      case 'p2wpkh':
        return {
          address: payments.p2wpkh({
            pubkey: Buffer.from(key.publicKey, 'hex'),
            network: network
          }).address,
          publicKey: key.publicKey,
          privateKey: key.privateKey
        };
      case 'p2tr':
        // For p2tr, we need to use the x-only pubkey (first 32 bytes after the prefix)
        const pubkeyBuffer = Buffer.from(key.publicKey, 'hex');
        const xOnlyPubkey = pubkeyBuffer.slice(1, 33); // Remove prefix byte and take next 32 bytes

        // Generate taproot address using bech32m encoding
        const commitHash = crypto.createHash('sha256')
          .update(Buffer.concat([xOnlyPubkey, Buffer.alloc(32)]))
          .digest();
        const tweakResult = ecc.xOnlyPointAddTweak(xOnlyPubkey, commitHash);
        if (!tweakResult) throw new Error('Invalid tweak');

        // Use the correct network prefix for bech32m
        let hrp;
        switch (this.settings.network) {
          case 'main':
            hrp = 'bc';
            break;
          case 'testnet':
            hrp = 'tb';
            break;
          case 'regtest':
            hrp = 'bcrt';
            break;
          default:
            throw new Error(`Unsupported network: ${this.settings.network}`);
        }

        const address = this._encodeBech32m(tweakResult.xOnlyPubkey, hrp);

        return {
          address: address,
          publicKey: key.publicKey,
          privateKey: key.privateKey
        };
      default:
        throw new Error(`Unsupported address type: ${type}`);
    }
  }

  _encodeBech32m (data, hrp) {
    // Witness version 1 for P2TR
    const version = [1];
    // Convert witness program to 5-bit words
    const program = this._convertBits(Array.from(data), 8, 5, true);
    if (!program) throw new Error('Invalid program');

    // Combine version and program
    const words = version.concat(program);

    // Generate checksum
    const chk = this._bech32mCreateChecksum(hrp, words);

    // Return final address
    return hrp + '1' + words.map(x => this._bech32mCharset[x]).join('') + chk;
  }

  _convertBits (data, fromBits, toBits, pad) {
    let acc = 0;
    let bits = 0;
    const maxv = (1 << toBits) - 1;
    const result = [];

    for (let i = 0; i < data.length; i++) {
      const value = data[i];
      if (value < 0 || value >> fromBits !== 0) {
        return null;
      }
      acc = (acc << fromBits) | value;
      bits += fromBits;
      while (bits >= toBits) {
        bits -= toBits;
        result.push((acc >> bits) & maxv);
      }
    }

    if (pad) {
      if (bits > 0) {
        result.push((acc << (toBits - bits)) & maxv);
      }
    } else if (bits >= fromBits || ((acc << (toBits - bits)) & maxv)) {
      return null;
    }

    return result;
  }

  _bech32mCreateChecksum (hrp, data) {
    const values = this._bech32mExpandHrp(hrp).concat(data).concat([0, 0, 0, 0, 0, 0]);
    const polymod = this._bech32mPolymod(values) ^ 0x2bc830a3;
    const ret = [];
    for (let i = 0; i < 6; i++) {
      ret.push((polymod >> 5 * (5 - i)) & 31);
    }
    return ret.map(x => this._bech32mCharset[x]).join('');
  }

  _bech32mExpandHrp (hrp) {
    const ret = [];
    for (let i = 0; i < hrp.length; i++) {
      ret.push(hrp.charCodeAt(i) >> 5);
    }
    ret.push(0);
    for (let i = 0; i < hrp.length; i++) {
      ret.push(hrp.charCodeAt(i) & 31);
    }
    return ret;
  }

  _bech32mPolymod (values) {
    const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
    let chk = 1;
    for (let i = 0; i < values.length; i++) {
      const top = chk >> 25;
      chk = ((chk & 0x1ffffff) << 5) ^ values[i];
      for (let j = 0; j < 5; j++) {
        if ((top >> j) & 1) {
          chk ^= GEN[j];
        }
      }
    }
    return chk;
  }

  deriveKeyPair (addressID = 0, change = 0) {
    const path = `m/${this.purpose}'/0'/${this.account}'/${change}/${addressID}`;
    const derived = this.master.derivePath(path);
    const pair = ec.keyFromPrivate(derived.privateKey);

    return {
      privateKey: pair.getPrivate('hex'),
      publicKey: pair.getPublic(true, 'hex')
    };
  }

  encrypt (value) {
    try {
      const ivbuff = Buffer.from(this.iv, 'hex');
      // Derive a 32-byte key from the private key using SHA-256
      const key = crypto.createHash('sha256')
        .update(this.private.toString('hex'))
        .digest();
      const cipher = crypto.createCipheriv(this.settings.mode, key, ivbuff);
      let encrypted = cipher.update(value, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      return ivbuff.toString('hex') + ':' + encrypted;
    } catch (exception) {
      console.error('err:', exception);
      return null;
    }
  }

  decrypt (text) {
    if (!text) return null;
    if (text instanceof Buffer) text = text.toString('utf8');

    try {
      const parts = text.split(':');
      const iv = Buffer.from(parts.shift(), 'hex');
      const blob = Buffer.from(parts.join(':'), 'hex');
      // Use the same key derivation as encrypt
      const key = crypto.createHash('sha256')
        .update(this.private.toString('hex'))
        .digest();
      const decipher = crypto.createDecipheriv(this.settings.mode, key, iv);
      let decrypted = decipher.update(blob, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch (exception) {
      console.error('err:', exception);
      return null;
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

  /**
   * Signs a message using Schnorr signatures (BIP340).
   * @param {Buffer|String} msg - The message to sign
   * @returns {Buffer} The signature
   */
  signSchnorr (msg) {
    if (!this.private) throw new Error('Cannot sign without private key');

    // Convert message to Buffer if it's a string
    const messageBuffer = Buffer.isBuffer(msg) ? msg : Buffer.from(msg);

    // Create message hash
    const messageHash = crypto.createHash('sha256').update(messageBuffer).digest();

    // Get private key as 32-byte buffer
    let privateKeyBuffer;
    if (Buffer.isBuffer(this.private)) {
      privateKeyBuffer = this.private;
    } else if (BN.isBN(this.private)) {
      privateKeyBuffer = Buffer.from(this.private.toString(16).padStart(64, '0'), 'hex');
    } else if (typeof this.private === 'string') {
      privateKeyBuffer = Buffer.from(this.private.padStart(64, '0'), 'hex');
    } else {
      throw new Error('Invalid private key format');
    }

    // Sign using tiny-secp256k1's Schnorr implementation
    const signature = ecc.signSchnorr(messageHash, privateKeyBuffer);

    // Ensure we return a Buffer
    return Buffer.isBuffer(signature) ? signature : Buffer.from(signature);
  }

  /**
   * Verifies a Schnorr signature (BIP340).
   * @param {Buffer|String} msg - The message that was signed
   * @param {Buffer} sig - The signature to verify
   * @returns {Boolean} Whether the signature is valid
   */
  verifySchnorr (msg, sig) {
    // Convert message to Buffer if it's a string
    const messageBuffer = Buffer.isBuffer(msg) ? msg : Buffer.from(msg);

    // Create message hash
    const messageHash = crypto.createHash('sha256').update(messageBuffer).digest();

    // Get x-only public key (32 bytes) from compressed public key (33 bytes)
    // For Schnorr, we only need the x coordinate (first 32 bytes after the prefix)
    const compressedPubkey = Buffer.from(this.public.encodeCompressed('hex'), 'hex');
    const xOnlyPubkey = compressedPubkey.slice(1); // Remove the prefix byte

    // Ensure signature is a Buffer
    const sigBuffer = Buffer.isBuffer(sig) ? sig : Buffer.from(sig);

    // Verify using tiny-secp256k1's Schnorr implementation
    return ecc.verifySchnorr(messageHash, xOnlyPubkey, sigBuffer);
  }

  /**
   * Signs a message using the key's private key.
   * @param {Buffer|String} msg - The message to sign
   * @returns {Buffer} The signature
   */
  sign (msg) {
    return this._sign(msg);
  }

  derive (path = this.settings.derivation) {
    if (!this.master) throw new Error('You cannot derive without a master key.  Provide a seed phrase or an xprv.');

    const derived = this.master.derivePath(path);
    const options = {
      private: derived.privateKey.toString('hex'),
      public: derived.publicKey.toString('hex')
    };

    return new Key(options);
  }

  /**
   * Secures the key by clearing sensitive information from memory.
   * This method should be called when the key is no longer needed
   * to prevent sensitive data from remaining in memory.
   */
  secure () {
    // Clear sensitive key material
    this.private = null;
    this.privkey = null;
    this.seed = null;
    this.master = null;
    this.keypair = null;

    // Clear any derived keys
    this.xprv = null;

    // Update state
    this._state.status = 'secured';

    this.commit();

    return this;
  }
}

module.exports = Key;
