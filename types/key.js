/**
 * @fabric/core/types/key
 * Cryptographic key generation, derivation, signing, and encryption.
 *
 * @signers
 * - Eric Martindale <eric@ericmartindale.com>
 */
'use strict';

// Constants
const { FABRIC_KEY_DERIVATION_PATH, bitcoinCoinTypeForNetwork } = require('../constants');

// Node Modules
const crypto = require('crypto');
const EventEmitter = require('events').EventEmitter;
const { sha256 } = require('@noble/hashes/sha2.js');

/**
 * Deterministic bit stream for {@link Key#bit}. Replaces the `arbitrary` npm package, whose published
 * `main` is a browserify bundle (`docs/dist/index.js`) that breaks under webpack (nested `require`).
 * Internal helper — omitted from published API / dev docs.
 * @ignore
 */
function createKeyBitGenerator (seedQ) {
  const seed = Buffer.alloc(4);
  seed.writeUInt32BE(seedQ >>> 0, 0);
  let counter = 0;
  let pool = Buffer.from(sha256(Buffer.concat([
    Buffer.from('fabric/key/bitgen/v1', 'utf8'),
    seed
  ])));
  let offset = 0;

  return {
    next: {
      bits (n) {
        let out = 0;
        for (let i = 0; i < n; i++) {
          if ((offset >> 3) >= pool.length) {
            const tail = Buffer.alloc(4);
            tail.writeUInt32BE(counter >>> 0, 0);
            counter = (counter + 1) >>> 0;
            pool = Buffer.from(sha256(Buffer.concat([pool, tail])));
            offset = 0;
          }
          const byteIndex = offset >> 3;
          const bitInByte = offset & 7;
          offset++;
          const bit = (pool[byteIndex] >> (7 - bitInByte)) & 1;
          out = (out << 1) | bit;
        }
        return out;
      }
    }
  };
}

// Dependencies
// TODO: remove all external dependencies
const BN = require('bn.js');
const ecc = require('./ecc');
const { secp256k1, schnorr: nobleSchnorr } = require('@noble/curves/secp256k1.js');
const SecpPoint = secp256k1.ProjectivePoint || secp256k1.Point;

function privateKeyToBuffer (privkey) {
  if (Buffer.isBuffer(privkey)) return privkey;
  if (BN.isBN(privkey)) return Buffer.from(privkey.toString(16).padStart(64, '0'), 'hex');
  if (typeof privkey === 'string') {
    if (!/^[0-9a-fA-F]{1,64}$/.test(privkey)) throw new Error('Invalid private key format');
    return Buffer.from(privkey.padStart(64, '0'), 'hex');
  }
  if (ArrayBuffer.isView(privkey) && !(privkey instanceof DataView) && privkey.byteLength === 32) {
    // Uint8Array and other typed-array views from upgraded deps (bip32/ecpair).
    return Buffer.from(privkey);
  }
  if (Array.isArray(privkey) && privkey.length === 32 && privkey.every((x) => Number.isInteger(x) && x >= 0 && x <= 255)) {
    return Buffer.from(privkey);
  }
  throw new Error('Invalid private key format');
}

function secpPointFromPublicKey (pubkey) {
  const bytes = Buffer.isBuffer(pubkey) ? pubkey : Buffer.from(pubkey);
  // noble-curves v1: ProjectivePoint.fromHex(bytes)
  if (secp256k1.ProjectivePoint && typeof secp256k1.ProjectivePoint.fromHex === 'function') {
    return secp256k1.ProjectivePoint.fromHex(bytes);
  }
  // noble-curves v2: Point.fromBytes(bytes)
  if (SecpPoint && typeof SecpPoint.fromBytes === 'function') {
    return SecpPoint.fromBytes(bytes);
  }
  // Fallback: v2 Point.fromHex expects a hex string
  if (SecpPoint && typeof SecpPoint.fromHex === 'function') {
    return SecpPoint.fromHex(bytes.toString('hex'));
  }
  throw new Error('Unsupported secp256k1 Point API');
}

function secpPointFromPrivateKey (privkey) {
  const bytes = privateKeyToBuffer(privkey);
  // noble-curves v1
  if (secp256k1.ProjectivePoint && typeof secp256k1.ProjectivePoint.fromPrivateKey === 'function') {
    return secp256k1.ProjectivePoint.fromPrivateKey(bytes);
  }
  // noble-curves v2: compute pubkey then parse into Point
  const pub = secp256k1.getPublicKey(bytes, false);
  return secpPointFromPublicKey(pub);
}

function secpPointToRawBytes (point, compressed = true) {
  if (!point) throw new Error('Missing secp256k1 point');
  if (typeof point.toRawBytes === 'function') return point.toRawBytes(compressed);
  if (typeof point.toBytes === 'function') {
    if (compressed) return point.toBytes(); // v2: compressed SEC1 (33 bytes)
    if (typeof point.toAffine !== 'function') throw new Error('Point.toAffine() unavailable for uncompressed encoding');
    const affine = point.toAffine();
    const x = Buffer.from(affine.x.toString(16).padStart(64, '0'), 'hex');
    const y = Buffer.from(affine.y.toString(16).padStart(64, '0'), 'hex');
    return Buffer.concat([Buffer.from([0x04]), x, y]);
  }
  throw new Error('Unsupported secp256k1 Point API');
}

const base58 = require('./key/base58');
const { encodeCheck, decodeCheck } = base58;
const bip39 = require('./key/bip39');
const keyMaterial = require('./key/fabricKeyMaterial');
const { parseRawSeedHex, classifyFabricKeyMaterial } = keyMaterial;
const bip32Module = require('./key/bip32');
const BIP32 = bip32Module.default;
const BIP32_DEFAULT_NETWORK = bip32Module.DEFAULT_NETWORK;
const bip49 = require('./key/bip49');
const bip85 = require('./key/bip85');
const pubkeyHelpers = require('./key/pubkey');
const keyHasPrivateSigningMaterial = require('./key/keyHasPrivateSigningMaterial');
const SIGNING_TAGS = require('./key/signingTags');
const { payments } = require('bitcoinjs-lib');
const { p2shP2wpkhPayment } = bip49;
const { encodeSegwitAddress } = require('./bech32/bech32');

// Fabric Dependencies
const Actor = require('./actor');
const Hash256 = require('./hash256');
const taggedHash = Hash256.tagged;

/** @private Tag for the generic `Key#sign` / `Key#verify` pair. */
const KEY_SIGN_TAG = SIGNING_TAGS.SIGN;
const SCHNORR_TAG_PATTERN = /^Fabric\/[A-Za-z0-9/._-]{1,96}$/;

/**
 * @private
 * BIP340 tagged hash of a message for one purpose. Fabric signs no
 * untagged message: the tag must name a Fabric purpose (`Fabric/…`).
 */
function schnorrMessageHash (msg, tag) {
  if (typeof tag !== 'string' || !SCHNORR_TAG_PATTERN.test(tag)) {
    throw new Error('Schnorr signing tag required (e.g. "Fabric/IdentityCrossSign")');
  }
  let buffer;
  if (Buffer.isBuffer(msg)) buffer = msg;
  else if (msg instanceof Uint8Array) buffer = Buffer.from(msg);
  else if (typeof msg === 'string') buffer = Buffer.from(msg, 'utf8');
  else throw new Error('Message must be a Buffer or string');
  return taggedHash(tag, buffer);
}

// NOTE: see also @fabric/passport
// expect a bech32m identifier using prefix "id"

function bip32NetworkFromKeySettings (settings) {
  const name = settings.network === 'regtest' ? 'regtest' : settings.network;
  const raw = settings.networks[name] || settings.networks.mainnet;
  return {
    messagePrefix: raw.messagePrefix,
    bech32: raw.bech32,
    bip32: raw.bip32,
    pubKeyHash: raw.pubKeyHash,
    scriptHash: raw.scriptHash,
    wif: raw.wif
  };
}

/**
 * Address and WIF parameters for a Key's network. Signet and testnet4 use
 * testnet's, playnet is regtest. An unknown name throws rather than falling
 * back to mainnet.
 * @private
 */
function addressNetworkFromKeySettings (settings) {
  const name = String(settings.network || 'main');
  const nets = settings.networks;
  switch (name) {
    case 'main':
    case 'mainnet':
      return nets.mainnet;
    case 'testnet':
    case 'testnet3':
    case 'testnet4':
    case 'signet':
      return nets.testnet;
    case 'regtest':
    case 'playnet':
      return nets.regtest;
    default:
      throw new Error(`Unsupported network: ${name}`);
  }
}

/**
 * Represents a cryptographic key.
 */
class Key extends EventEmitter {
  /**
   * Create an instance of a Fabric Key, either restoring from some known
   * values or from prior knowledge.  For instance, you can call `new Key()`
   * to create a fresh keypair, or `new Key({ public: 'deadbeef...' })` to
   * create it from a known public key.
   * @param {Object} [settings] Initialization for the key.
   * @param {String} [settings.network] Network string.
   * @param {String} [settings.seed] Raw BIP32 seed hex (16–64 bytes) or a legacy BIP39 mnemonic.
   * @param {String} [settings.mnemonic] BIP39 mnemonic (preferred over putting words in `seed`).
   * @param {String} [settings.public] Public key in hex.
   * @param {String} [settings.private] Private key in hex.
   * @param {String} [settings.wif] WIF-encoded private key.
   * @param {String} [settings.purpose=44] Constrains derivations to this space.
   */
  constructor (input = {}) {
    super(input);

    // Settings
    this.settings = Object.assign({
      debug: false,
      network: 'main',
      curve: 'secp256k1',
      derivation: FABRIC_KEY_DERIVATION_PATH,
      mode: 'aes-256-cbc',
      prefix: '00',
      public: null,
      private: null,
      wif: null,
      purpose: 44,
      account: 0,
      bits: 256,
      hd: true,
      seed: null,
      mnemonic: null,
      passphrase: '',
      password: null,
      index: 0,
      path: null,
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

    this.clock = 0;
    this.master = null;
    this.private = null;
    this.public = null;
    this._pubUncompressed = false; // set true for legacy uncompressed WIF
    this._state = null; // Initialize as null to defer state updates

    if (this.settings.mnemonic) {
      this._mode = 'FROM_MNEMONIC';
    } else if (this.settings.seed) {
      const raw = this.settings.seed;
      if (Buffer.isBuffer(raw) || raw instanceof Uint8Array) {
        this._mode = 'FROM_SEED';
      } else {
        const classified = classifyFabricKeyMaterial(raw);
        if (classified.kind === 'xprv') {
          this._mode = 'FROM_XPRV';
          this.settings.xprv = classified.xprv;
        } else if (classified.kind === 'mnemonic') {
          this._mode = 'FROM_MNEMONIC';
          this.settings.mnemonic = classified.mnemonic;
        } else {
          this._mode = 'FROM_SEED';
        }
      }
    } else if (this.settings.wif) {
      this._mode = 'FROM_WIF';
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

    let seed = null;
    let root = null;

    switch (this._mode) {
      case 'FROM_MNEMONIC':
        seed = bip39.mnemonicToSeedSync(this.settings.mnemonic, this.settings.passphrase);
        root = this.bip32.fromSeed(seed, bip32NetworkFromKeySettings(this.settings));
        this.seed = this.settings.mnemonic;
        this.xprv = root.toBase58();
        this.xpub = root.neutered().toBase58();
        this.master = root;
        this._point = secpPointFromPrivateKey(root.privateKey);
        this.status = 'seeded';
        break;
      case 'FROM_SEED': {
        const rawSeed = parseRawSeedHex(this.settings.seed);
        if (rawSeed) {
          seed = rawSeed;
          this.seed = rawSeed.toString('hex');
        } else if (Buffer.isBuffer(this.settings.seed) || this.settings.seed instanceof Uint8Array) {
          throw new Error('Seed must be 16–64 bytes');
        } else {
          seed = bip39.mnemonicToSeedSync(this.settings.seed, this.settings.passphrase);
          this.seed = this.settings.seed;
        }
        root = this.bip32.fromSeed(seed, bip32NetworkFromKeySettings(this.settings));
        this.xprv = root.toBase58();
        this.xpub = root.neutered().toBase58();
        this.master = root;
        this._point = secpPointFromPrivateKey(root.privateKey);
        this.status = 'seeded';
        break;
      }
      case 'FROM_WIF':
        const decoded = decodeCheck(this.settings.wif);
        const privateKey = decoded.slice(1, 33);
        const isCompressed = decoded.length === 34 && decoded[33] === 0x01;
        this._point = secpPointFromPrivateKey(privateKey);
        this.private = Buffer.isBuffer(privateKey) ? privateKey : Buffer.from(privateKey);
        if (!isCompressed) this._pubUncompressed = true;
        break;
      case 'FROM_XPRV':
        this.master = this.bip32.fromBase58(this.settings.xprv);
        this.xprv = this.master.toBase58();
        this.xpub = this.master.neutered().toBase58();
        this._point = secpPointFromPrivateKey(this.master.privateKey);
        break;
      case 'FROM_XPUB':
        this.master = this.bip32.fromBase58(this.settings.xpub);
        this.xpub = this.master.neutered().toBase58();
        this._point = secpPointFromPublicKey(this.master.publicKey);
        break;
      case 'FROM_PRIVATE_KEY':
        // Key is private
        const provision = (this.settings.private instanceof Buffer) ? this.settings.private : Buffer.from(this.settings.private, 'hex');
        this._point = secpPointFromPrivateKey(provision);
        this.private = provision;
        break;
      case 'FROM_PUBLIC_KEY':
        const pubkey = this.settings.pubkey || this.settings.public;
        // Key is only public
        const pubkeyBuf = (pubkey instanceof Buffer) ? pubkey : Buffer.from(pubkey, 'hex');
        this._point = secpPointFromPublicKey(pubkeyBuf);
        break;
      case 'FROM_RANDOM':
        this.mnemonic = bip39.generateMnemonic();
        // TODO: set property `seed` as the actual derived seed, not the seed phrase
        const interim = bip39.mnemonicToSeedSync(this.mnemonic);
        this.master = this.bip32.fromSeed(interim, bip32NetworkFromKeySettings(this.settings));
        this.xprv = this.master.toBase58();
        this.xpub = this.master.neutered().toBase58();
        this._point = secpPointFromPrivateKey(this.master.privateKey);
        break;
    }

    // Read the pair (for modes that use master, set private from master)
    if (!this.private && this.master && this.master.privateKey) {
      this.private = privateKeyToBuffer(this.master.privateKey);
    }
    // Adapt noble-curves point to the minimal interface used elsewhere.
    this.public = {
      encodeCompressed: (e) => Buffer.from(secpPointToRawBytes(this._point, !this._pubUncompressed)).toString(e || 'hex'),
      encode: (e) => Buffer.from(secpPointToRawBytes(this._point, false)).toString(e || 'hex')
    };
    // Adapter for Session/Token: elliptic-style getPrivate/getPublic
    this.keypair = {
      getPrivate: (enc) => {
        if (!this.private) return null;
        const hex = Buffer.isBuffer(this.private) ? this.private.toString('hex') : String(this.private);
        if (enc === 'bytes') return Buffer.isBuffer(this.private) ? this.private : Buffer.from(hex, 'hex');
        if (enc === 'hex') return hex;
        return new BN(hex, 16);
      },
      getPublic: (compressed, enc) => {
        const bytes = secpPointToRawBytes(this._point, compressed !== false);
        return (enc || 'hex') === 'hex' ? Buffer.from(bytes).toString('hex') : Buffer.from(bytes);
      }
    };

    // TODO: determine if this makes sense / needs to be private
    this.privkey = (this.private) ? this.private.toString() : null;

    // Configure Deterministic Random
    // WARNING: this will currently loop after 2^32 bits
    // TODO: evaluate compression when treating seed phrase as ascii
    // TODO: consider using sha256(masterprivkey) or sha256(sha256(...))?
    this._starseed = Hash256.digest(this.pubkeyhash).toString('hex');
    this.q = parseInt(this._starseed.substring(0, 4), 16);
    this.generator = createKeyBitGenerator(this.q);

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
    Object.defineProperty(this, '_point', { enumerable: false }); // noble ProjectivePoint has BigInt; hide from JSON.stringify
    Object.defineProperty(this, 'keypair', { enumerable: false });
    Object.defineProperty(this, 'private', { enumerable: false });

    return this;
  }

  /**
   * Create a Key instance from a WIF-encoded private key.
   * @param {String} wif - The WIF-encoded private key
   * @param {Object} [options] - Additional options for key creation
   * @returns {Key} A new Key instance
   */
  static fromWIF (wif, options = {}) {
    return new Key({ ...options, wif });
  }

  static Mnemonic (seed) {
    if (!seed) seed = crypto.randomBytes(32);
    const mnemonic = bip39.entropyToMnemonic(seed);
    const seedBuffer = bip39.mnemonicToSeedSync(mnemonic);
    const bip32 = new BIP32(ecc);
    const master = bip32.fromSeed(seedBuffer, BIP32_DEFAULT_NETWORK);
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

  /**
   * @deprecated Per-message IVs are generated in {@link Key#encrypt}. Do not rely on this getter.
   */
  get iv () {
    return crypto.randomBytes(16);
  }

  get path () {
    return this.settings.path;
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
    const network = addressNetworkFromKeySettings(this.settings);

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
      case 'p2sh-p2wpkh':
      case 'p2shp2wpkh': {
        const nested = p2shP2wpkhPayment({
          pubkey: Buffer.from(key.publicKey, 'hex'),
          network: network
        });
        return {
          address: nested.address,
          publicKey: key.publicKey,
          privateKey: key.privateKey
        };
      }
      case 'p2tr': {
        // BIP-341 key-path only (BIP-86): Q = P + int(taggedHash('TapTweak', P_x))·G
        const xOnlyPubkey = Buffer.from(key.publicKey, 'hex').subarray(1, 33);
        const tweakResult = ecc.xOnlyPointAddTweak(xOnlyPubkey, taggedHash('TapTweak', xOnlyPubkey));
        if (!tweakResult) throw new Error('Invalid tweak');

        const address = encodeSegwitAddress(network.bech32, 1, Buffer.from(tweakResult.xOnlyPubkey));
        if (!address) throw new Error('Invalid program');

        return {
          address: address,
          publicKey: key.publicKey,
          privateKey: key.privateKey
        };
      }
      default:
        throw new Error(`Unsupported address type: ${type}`);
    }
  }

  deriveKeyPair (addressID = 0, change = 0) {
    const coin = bitcoinCoinTypeForNetwork(this.settings.network);
    const path = `m/${this.purpose}'/${coin}'/${this.account}'/${change}/${addressID}`;
    const derived = this.master.derivePath(path);
    const pubBytes = secp256k1.getPublicKey(derived.privateKey, true);
    return {
      privateKey: derived.privateKey.toString('hex'),
      publicKey: Buffer.from(pubBytes).toString('hex')
    };
  }

  encrypt (value) {
    if (!this.private) {
      if (this.settings.debug) console.error('[FABRIC:KEY]', 'Cannot encrypt without private key');
      return null;
    }

    try {
      const ivbuff = crypto.randomBytes(16);
      // Derive a 32-byte key from the private key using SHA-256
      const key = crypto.createHash('sha256')
        .update(this.private.toString('hex'))
        .digest();
      const cipher = crypto.createCipheriv(this.settings.mode, key, ivbuff);
      let encrypted = cipher.update(value, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      return ivbuff.toString('hex') + ':' + encrypted;
    } catch {
      if (this.settings.debug) console.error('[FABRIC:KEY]', 'Encryption failed');
      return null;
    }
  }

  decrypt (text) {
    if (!text) return null;
    if (!this.private) {
      if (this.settings.debug) console.error('[FABRIC:KEY]', 'Cannot decrypt without private key');
      return null;
    }
    if (text instanceof Buffer) text = text.toString('utf8');

    try {
      if (typeof text !== 'string' || !text.includes(':')) return null;
      const parts = text.split(':');
      const ivHex = parts.shift();
      if (!/^[0-9a-fA-F]{32}$/.test(ivHex || '')) return null;
      const blobHex = parts.join(':');
      if (!blobHex || !/^[0-9a-fA-F]+$/.test(blobHex)) return null;

      const iv = Buffer.from(ivHex, 'hex');
      const blob = Buffer.from(parts.join(':'), 'hex');
      // Use the same key derivation as encrypt
      const key = crypto.createHash('sha256')
        .update(this.private.toString('hex'))
        .digest();
      const decipher = crypto.createDecipheriv(this.settings.mode, key, iv);
      let decrypted = decipher.update(blob, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch {
      if (this.settings.debug) console.error('[FABRIC:KEY]', 'Decryption failed');
      return null;
    }
  }

  _sign (msg, tag = KEY_SIGN_TAG) {
    if (typeof msg !== 'string' && !Buffer.isBuffer(msg)) msg = JSON.stringify(msg);
    return this.signSchnorr(msg, tag);
  }

  _verify (msg, sig, tag = KEY_SIGN_TAG) {
    if (typeof msg !== 'string' && !Buffer.isBuffer(msg)) msg = JSON.stringify(msg);
    return this.verifySchnorr(msg, sig, tag);
  }

  /**
   * Verify a message's signature.
   * @param {Buffer|String} msg - The message that was signed
   * @param {Buffer|String} sig - The signature to verify
   * @param {String} [tag] Purpose tag (default `Fabric/Sign`)
   * @returns {Boolean} Whether the signature is valid
   */
  verify (msg, sig, tag) {
    return this._verify(msg, sig, tag);
  }

  /**
   * Signs a message using Schnorr signatures (BIP340) over
   * `taggedHash(tag, msg)`. Every purpose has its own tag, so a signature
   * made for one purpose never verifies for another (or as a Taproot
   * sighash, or as a Nostr event).
   * @param {Buffer|String} msg - The message to sign
   * @param {String} tag - Purpose tag, e.g. `Fabric/IdentityCrossSign`
   * @returns {Buffer} The signature
   */
  signSchnorr (msg, tag) {
    if (!this.private) throw new Error('Cannot sign without private key');
    return this.signSchnorrHash(schnorrMessageHash(msg, tag));
  }

  /**
   * Signs a pre-computed hash using Schnorr signatures (BIP340).
   * This is useful when the message has already been hashed (e.g., with a tagged hash).
   * @param {Buffer} messageHash - The pre-computed message hash (32 bytes)
   * @returns {Buffer} The signature (64 bytes)
   */
  signSchnorrHash (messageHash) {
    if (!this.private) throw new Error('Cannot sign without private key');
    // bitcoinjs-lib 7 crypto helpers return Uint8Array; accept Buffer or Uint8Array.
    const hash = Buffer.isBuffer(messageHash)
      ? messageHash
      : (messageHash instanceof Uint8Array ? Buffer.from(messageHash) : null);
    if (!hash || hash.length !== 32) {
      throw new Error('Message hash must be a 32-byte Buffer');
    }

    // Get private key as 32-byte buffer
    const privateKeyBuffer = privateKeyToBuffer(this.private);

    // Sign using noble-curves Schnorr (BIP340). Zero auxRand for deterministic signatures.
    const signature = nobleSchnorr.sign(hash, privateKeyBuffer, Buffer.alloc(32));

    // Ensure we return a Buffer
    return Buffer.isBuffer(signature) ? signature : Buffer.from(signature);
  }

  /**
   * Verifies a BIP340 Schnorr signature over `taggedHash(tag, msg)`.
   * @param {Buffer|String} msg - The message that was signed
   * @param {Buffer} sig - The signature to verify
   * @param {String} tag - Purpose tag the signer used
   * @returns {Boolean} Whether the signature is valid
   */
  verifySchnorr (msg, sig, tag) {
    return this.verifySchnorrHash(schnorrMessageHash(msg, tag), sig);
  }

  /**
   * Verifies a Schnorr signature with a pre-computed hash (BIP340).
   * This is useful when the message has already been hashed (e.g., with a tagged hash).
   * @param {Buffer} messageHash - The pre-computed message hash (32 bytes)
   * @param {Buffer} sig - The signature to verify (64 bytes)
   * @returns {Boolean} Whether the signature is valid
   */
  verifySchnorrHash (messageHash, sig) {
    const hash = Buffer.isBuffer(messageHash)
      ? messageHash
      : (messageHash instanceof Uint8Array ? Buffer.from(messageHash) : null);
    if (!hash || hash.length !== 32) {
      throw new Error('Message hash must be a 32-byte Buffer');
    }

    // Get x-only public key (32 bytes) from compressed public key (33 bytes)
    const compressedPubkey = Buffer.from(this.public.encodeCompressed('hex'), 'hex');
    const xOnlyPubkey = compressedPubkey.slice(1); // Remove the prefix byte

    // Ensure signature is a Buffer
    const sigBuffer = Buffer.isBuffer(sig) ? sig : Buffer.from(sig);

    // Verify using noble-curves Schnorr (BIP340)
    return nobleSchnorr.verify(sigBuffer, hash, xOnlyPubkey);
  }

  commit () {
    const reference = { ...this.state };
    const state = new Actor(reference);
    const commit = {
      type: 'KeyCommit',
      hash: state.id,
      signatures: []
    };

    // Store current state's hash
    this._state.hash = state.id;

    // Sign the commit message using the configured key
    const signature = this.sign(commit);
    commit.signatures.push(signature);

    this.emit('commit', commit);
  }

  /**
   * Sign a buffer of data using BIP 340: https://github.com/bitcoin/bips/blob/master/bip-0340.mediawiki
   * @param {Buffer} data Buffer of data to sign.
   * @returns {Buffer} Resulting signature (64 bytes).
   */
  sign (msg, tag) {
    return this._sign(msg, tag);
  }

  derive (path = this.settings.derivation) {
    if (!this.master) throw new Error('You cannot derive without a master key.  Provide a seed phrase or an xprv.');

    const derived = this.master.derivePath(path);
    // Prefer extended keys so Key initializes as FROM_XPRV/FROM_XPUB (keeps .xpub for
    // Fabric protocol identity login / watch-only). Raw private+public alone loses xpub.
    if (derived.privateKey && typeof derived.toBase58 === 'function') {
      return new Key({ xprv: derived.toBase58() });
    }
    if (typeof derived.neutered === 'function') {
      return new Key({ xpub: derived.neutered().toBase58() });
    }
    return new Key({
      private: derived.privateKey.toString('hex'),
      public: derived.publicKey.toString('hex')
    });
  }

  /**
   * Secures the key by clearing sensitive information from memory.
   * This method should be called when the key is no longer needed
   * to prevent sensitive data from remaining in memory.
   */
  secure () {
    // Update state before clearing key material, so commit can still be signed.
    this._state.status = 'secured';
    this.commit();

    // Clear sensitive key material
    if (Buffer.isBuffer(this.private)) {
      this.private.fill(0);
    }

    // Null out sensitive properties
    this.private = null;
    this.privkey = null;
    this.seed = null;
    this.master = null;

    // Clear any derived keys
    this.xprv = null;

    return this;
  }

  get pubkeyhash () {
    const input = Buffer.from(this.pubkey, 'hex');
    return Hash256.digest(input);
  }

  get pubkey () {
    return this.public.encodeCompressed('hex');
  }

  /**
   * Exports the private key in Wallet Import Format (WIF)
   * @returns {String} The private key encoded in WIF format
   * @throws {Error} If the key doesn't have a private component
   */
  toWIF () {
    if (!this.private) throw new Error('Cannot export WIF without private key');
    const privateKeyBuffer = privateKeyToBuffer(this.private);

    const network = addressNetworkFromKeySettings(this.settings);

    const prefix = Buffer.from([network.wif]);
    const payload = Buffer.concat([
      prefix,
      privateKeyBuffer,
      Buffer.from([0x01])
    ]);

    return encodeCheck(payload);
  }

  toBitcoinAddress () {
    if (!this.public) throw new Error('Cannot derive Bitcoin address without public key');
    const network = addressNetworkFromKeySettings(this.settings);

    const p2pkh = payments.p2pkh({
      pubkey: Buffer.from(this.public.encode('hex'), 'hex'),
      network: network
    });

    return p2pkh.address;
  }
}

Key.SIGN_TAG = KEY_SIGN_TAG;
Key.TAGS = SIGNING_TAGS;
Key.schnorrMessageHash = schnorrMessageHash;

// BIP-32 HD keys (`fromSeed`, `fromBase58`, `HDNode`, `DEFAULT_NETWORK`; `default` is the bip32-style factory).
Key.BIP32 = bip32Module;
Key.HDNode = bip32Module.HDNode;

// BIP-39 mnemonics, on the `Key.Mnemonic(entropy)` factory.
Key.Mnemonic.WORD_COUNTS = bip39.MNEMONIC_WORD_COUNTS;
Key.Mnemonic.wordlist = bip39.defaultWordlist;
Key.Mnemonic.generate = bip39.generateMnemonic;
Key.Mnemonic.validate = bip39.validateMnemonic;
Key.Mnemonic.fromEntropy = bip39.entropyToMnemonic;
Key.Mnemonic.toEntropy = bip39.mnemonicToEntropy;
Key.Mnemonic.toSeed = bip39.mnemonicToSeed;
Key.Mnemonic.toSeedSync = bip39.mnemonicToSeedSync;

Key.BIP49 = bip49;
Key.BIP85 = bip85;
Key.Base58 = base58;

// FABRIC_XPRV / FABRIC_SEED / FABRIC_MNEMONIC classification.
Key.Material = keyMaterial;

Key.pubkeyXOnly = pubkeyHelpers.pubkeyXOnly;
Key.pubkeyCompressed = pubkeyHelpers.pubkeyCompressed;
Key.pubkeysMatch = pubkeyHelpers.pubkeysMatch;
Key.normalizePeerPubkeyHex = pubkeyHelpers.normalizePeerPubkeyHex;
Key.hasPrivateSigningMaterial = keyHasPrivateSigningMaterial;

module.exports = Key;
