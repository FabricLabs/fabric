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

const base58 = require('../functions/base58');
const { encodeCheck, decodeCheck } = base58;
const bip39 = require('../functions/bip39');
/**
 * Classify operator key material for Environment / Hub / application loaders.
 *
 * Latest RC1 expectation:
 *   - `FABRIC_XPRV` — BIP32 extended private key (preferred)
 *   - `FABRIC_SEED` — raw BIP32 seed **hex** (16–64 bytes; BIP39 PBKDF2 output is 64)
 *   - `FABRIC_MNEMONIC` — BIP39 word phrase
 *
 * `FABRIC_SEED` still accepts a mnemonic or an `xprv…` string for compatibility.
 *
 * @fileoverview Classify FABRIC_XPRV / FABRIC_SEED / FABRIC_MNEMONIC material.
 */

/**
 * BIP32 `fromSeed` minimum length.
 * @private
 */
const MIN_SEED_BYTES = 16;
/**
 * BIP32 `fromSeed` maximum length (BIP39 `mnemonicToSeed` is 64).
 * @private
 */
const MAX_SEED_BYTES = 64;

/**
 * Parse a raw BIP32 seed from hex (optional `0x` prefix) or a Buffer.
 *
 * @param {*} value
 * @returns {Buffer|null}
 * @private
 */
function parseRawSeedHex (value) {
  if (value == null) return null;
  if (Buffer.isBuffer(value)) {
    if (value.length < MIN_SEED_BYTES || value.length > MAX_SEED_BYTES) return null;
    return value;
  }
  if (value instanceof Uint8Array) {
    if (value.byteLength < MIN_SEED_BYTES || value.byteLength > MAX_SEED_BYTES) return null;
    return Buffer.from(value);
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  if (!/^(?:0x)?[0-9a-fA-F]+$/i.test(trimmed)) return null;
  const hex = trimmed.slice(0, 2).toLowerCase() === '0x' ? trimmed.slice(2) : trimmed;
  if (hex.length % 2 !== 0) return null;
  const bytes = hex.length / 2;
  if (bytes < MIN_SEED_BYTES || bytes > MAX_SEED_BYTES) return null;
  return Buffer.from(hex, 'hex');
}

/**
 * @param {*} value
 * @returns {Object} `kind` plus at most one of `xprv`, `seed`, `mnemonic`
 * @private
 */
function classifyFabricKeyMaterial (value) {
  const trimmed = value == null ? '' : String(value).trim();
  if (!trimmed) return { kind: null };
  if (trimmed.startsWith('xprv') || trimmed.startsWith('tprv')) {
    return { kind: 'xprv', xprv: trimmed };
  }
  const hex = parseRawSeedHex(trimmed);
  if (hex) return { kind: 'seedHex', seed: hex.toString('hex') };
  if (bip39.validateMnemonic(trimmed)) {
    return { kind: 'mnemonic', mnemonic: trimmed };
  }
  return { kind: 'unknown' };
}

/**
 * Values accepted in `FABRIC_XPRV` (and related identity slots).
 * Private: BIP32 `xprv`/`tprv`. Public / combined: `xpub`/`tpub` or a
 * compressed/uncompressed secp256k1 pubkey hex (watch-only Hub / MuSig aggregate).
 *
 * @param {*} value
 * @returns {Object} `kind` plus `xprv`, `xpub`, or `public`
 * @private
 */
function classifyFabricIdentityEnvValue (value) {
  const trimmed = value == null ? '' : String(value).trim();
  if (!trimmed) return { kind: null };
  if (trimmed.startsWith('xprv') || trimmed.startsWith('tprv')) {
    return { kind: 'xprv', xprv: trimmed };
  }
  if (trimmed.startsWith('xpub') || trimmed.startsWith('tpub')) {
    return { kind: 'xpub', xpub: trimmed };
  }
  if (/^(02|03)[0-9a-fA-F]{64}$/.test(trimmed)) {
    return { kind: 'pubkey', public: trimmed.toLowerCase() };
  }
  if (/^04[0-9a-fA-F]{128}$/.test(trimmed)) {
    return { kind: 'pubkey', public: trimmed.toLowerCase() };
  }
  return { kind: 'unknown' };
}

/**
 * Key constructor settings from process/env identity variables.
 * Precedence: `FABRIC_XPRV` → `FABRIC_SEED` → `FABRIC_MNEMONIC`.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Object|null} Key settings with `xprv`, `seed`, or `mnemonic`
 * @private
 */
function keySettingsFromEnv (env = process.env) {
  const identitySlot = classifyFabricIdentityEnvValue((env && env.FABRIC_XPRV) || '');
  if (identitySlot.kind === 'xprv') return { xprv: identitySlot.xprv };
  if (identitySlot.kind === 'xpub') return { xpub: identitySlot.xpub };
  if (identitySlot.kind === 'pubkey') return { public: identitySlot.public };

  const seedRaw = String((env && env.FABRIC_SEED) || '').trim();
  if (seedRaw) {
    const classified = classifyFabricKeyMaterial(seedRaw);
    if (classified.kind === 'xprv') return { xprv: classified.xprv };
    if (classified.kind === 'seedHex') return { seed: classified.seed };
    if (classified.kind === 'mnemonic') return { mnemonic: classified.mnemonic };
  }

  const mnemonic = String((env && env.FABRIC_MNEMONIC) || '').trim();
  if (mnemonic) {
    const classified = classifyFabricKeyMaterial(mnemonic);
    if (classified.kind === 'mnemonic') return { mnemonic: classified.mnemonic };
    if (classified.kind === 'xprv') return { xprv: classified.xprv };
    if (classified.kind === 'seedHex') return { seed: classified.seed };
  }

  const xpub = String((env && env.FABRIC_XPUB) || '').trim();
  if (xpub.startsWith('xpub') || xpub.startsWith('tpub')) return { xpub };
  const pubkey = String((env && env.FABRIC_PUBKEY) || '').trim();
  const pubClassified = classifyFabricIdentityEnvValue(pubkey);
  if (pubClassified.kind === 'pubkey') return { public: pubClassified.public };

  return null;
}



const keyMaterial = {
  MIN_SEED_BYTES,
  MAX_SEED_BYTES,
  parseRawSeedHex,
  classifyFabricKeyMaterial,
  classifyFabricIdentityEnvValue,
  keySettingsFromEnv
};
const bip32Module = require('../functions/bip32');
const BIP32 = bip32Module.default;
const BIP32_DEFAULT_NETWORK = bip32Module.DEFAULT_NETWORK;
const bip49 = require('../functions/bip49');
const bip85 = require('../functions/bip85');
/**
 * secp256k1 public key hex forms: compressed (`02`/`03` || x, 66 hex) and
 * BIP-340 x-only (64 hex). Both forms of one key compare equal via
 * {@link pubkeysMatch}.
 *
 */

/**
 * Normalize to lowercase 64-hex x-only (accepts compressed 02/03||x).
 * @param {*} hex
 * @returns {string|null}
 * @private
 */
function pubkeyXOnly (hex) {
  const s = String(hex || '').toLowerCase().replace(/^0x/, '');
  if (/^0[23][0-9a-f]{64}$/.test(s)) return s.slice(2);
  if (/^[0-9a-f]{64}$/.test(s)) return s;
  return null;
}

/**
 * Compressed 33-byte pubkey hex from x-only or compressed input.
 * @param {*} hex
 * @returns {string|null}
 * @private
 */
function pubkeyCompressed (hex) {
  const s = String(hex || '').toLowerCase().replace(/^0x/, '');
  if (/^0[23][0-9a-f]{64}$/.test(s)) return s;
  const x = pubkeyXOnly(s);
  if (!x) return null;
  const Point = secp256k1.ProjectivePoint || secp256k1.Point;
  for (const prefix of ['02', '03']) {
    const cand = prefix + x;
    try {
      if (Point && typeof Point.fromHex === 'function') {
        Point.fromHex(cand);
        return cand;
      }
      if (Point && typeof Point.fromBytes === 'function') {
        Point.fromBytes(Buffer.from(cand, 'hex'));
        return cand;
      }
      // Last resort: ECDH probe with fixed priv (valid curve scalar).
      secp256k1.getSharedSecret(Buffer.alloc(32, 1), Buffer.from(cand, 'hex'), true);
      return cand;
    } catch (_) { /* try other parity */ }
  }
  throw new Error('pubkeyCompressed: x-only does not lift to a curve point');
}

/**
 * Same x-only key, whichever form each side is in.
 * @param {*} a
 * @param {*} b
 * @returns {boolean}
 * @private
 */
function pubkeysMatch (a, b) {
  const xa = pubkeyXOnly(a);
  const xb = pubkeyXOnly(b);
  return !!(xa && xb && xa === xb);
}

/**
 * Lowercase hex for a peer pubkey, dropping a compressed 02/03 prefix.
 * Unlike {@link pubkeyXOnly}, also takes a Buffer and passes other strings
 * through lowercased, so it never returns null (`''` for none).
 * @param {string|Buffer|null|undefined} pk
 * @returns {string}
 * @private
 */
function normalizePeerPubkeyHex (pk) {
  if (pk == null) return '';
  if (Buffer.isBuffer(pk)) {
    const h = pk.toString('hex').toLowerCase();
    if (pk.length === 32) return h;
    if (pk.length === 33 && (h.startsWith('02') || h.startsWith('03'))) return h.slice(2);
    return h;
  }
  const s = String(pk).trim();
  const h = (s.startsWith('0x') || s.startsWith('0X')) ? s.slice(2) : s;
  const lo = h.toLowerCase();
  if (lo.length === 66 && (lo.startsWith('02') || lo.startsWith('03'))) return lo.slice(2);
  return lo;
}



const pubkeyHelpers = {
  pubkeyXOnly,
  pubkeyCompressed,
  pubkeysMatch,
  normalizePeerPubkeyHex
};
/**
 * Whether a Key-like object has private material safe for Schnorr / AMP signing.
 * Watch-only Key instances still expose `sign` / `signSchnorr` but throw without `.private`.
 *
 * @param {object|null|undefined} signKey
 * @returns {boolean}
 * @private
 */
function keyHasPrivateSigningMaterial (signKey) {
  if (!signKey || signKey.private == null) return false;
  if (Buffer.isBuffer(signKey.private)) return signKey.private.length > 0;
  if (typeof signKey.private === 'string') return String(signKey.private).trim().length > 0;
  return Boolean(signKey.private);
}
const SIGNING_TAGS = Object.freeze({
  // Generic `Key#sign` / `Key#verify`.
  SIGN: 'Fabric/Sign',
  // Threshold witnesses over canonical JSON naming its `kind` (Beacon epochs,
  // federation blocks, execution runs, `Federation#sign`).
  FEDERATION_WITNESS: 'Fabric/FederationWitness',
  CONTRACT_STATE: 'Fabric/ContractState',
  SIDECHAIN_STATE: 'Fabric/SidechainState',
  BLOCK_AUTHOR: 'Fabric/BlockAuthor',
  BLS_BINDING: 'Fabric/BLSBinding',
  SESSION_KEY: 'Fabric/SessionKey',
  MESSAGE_RECEIPT: 'Fabric/MessageReceipt',
  CONTRACT_WITHDRAWAL_WITNESS: 'Fabric/ContractWithdrawalWitness',
  CIRCUIT_DECISION: 'Fabric/CircuitDecision',
  GROUP_CHANGE: 'Fabric/GroupChange',
  // A cosigner key vouches for the identity it belongs to, within one scope
  // (a Passport sign-in, a delegation grant, a group contract).
  PASSPORT_COSIGNER: 'Fabric/PassportCosigner',
  ORACLE_ATTESTATION: 'Fabric/OracleAttestation',
  FEDERATION_INVITE: 'Fabric/FederationInvite'
});
const { payments } = require('bitcoinjs-lib');
const { p2shP2wpkhPayment } = bip49;
const { encodeSegwitAddress } = require('../functions/bech32');

// Fabric Dependencies
const Actor = require('./actor');
const Hash256 = require('./hash256');
const taggedHash = Hash256.tagged;

/**
 * Tag for the generic `Key#sign` / `Key#verify` pair.
 * @private
 */
const KEY_SIGN_TAG = SIGNING_TAGS.SIGN;
const SCHNORR_TAG_PATTERN = /^Fabric\/[A-Za-z0-9/._-]{1,96}$/;

/**
 * BIP340 tagged hash of a message for one purpose. Fabric signs no
 * untagged message: the tag must name a Fabric purpose (`Fabric/…`).
 * @private
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
 * Address and WIF parameters for a Key's network. Signet, testnet4, and
 * testnet5 use testnet's, playnet is regtest. An unknown name throws rather
 * than falling back to mainnet.
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
    case 'testnet5':
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
    if (typeof msg !== 'string' && !(msg instanceof Uint8Array)) msg = JSON.stringify(msg);
    return this.signSchnorr(msg, tag);
  }

  _verify (msg, sig, tag = KEY_SIGN_TAG) {
    if (typeof msg !== 'string' && !(msg instanceof Uint8Array)) msg = JSON.stringify(msg);
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

const accountKeys = (function () {
  const { networks, payments } = require('bitcoinjs-lib');
  function bip86 () {
    return require('./wallet').BIP86;
  }
  const bip39Accounts = require('../functions/bip39');
  const { encodeCheck: encodeCheckAccount, decodeCheck: decodeCheckAccount } = require('../functions/base58');
  const { sealJson, openSealedJson } = require('../functions/sealedBlob');
  const signingTags = SIGNING_TAGS;
  const {
    assertBip32ChildIndex,
    isMainnetNetwork,
    fabricIdentityDerivationPath,
    bitcoinAccountDerivationPath,
    bitcoinCosignerDerivationPath
  } = require('../constants');
  const bip39 = bip39Accounts;
  const encodeCheck = encodeCheckAccount;
  const decodeCheck = decodeCheckAccount;
/** Networks an account may be derived for. */
const ACCOUNT_NETWORKS = Object.freeze(['mainnet', 'testnet', 'testnet4', 'testnet5', 'signet', 'regtest']);
/** Addresses scanned past the last used one, on each chain of each wallet account. */
const WALLET_GAP_LIMIT = 20;
/** Stored record type for a sealed master plus its public account cache. */
const ACCOUNT_VAULT_TYPE = 'FabricAccountVault';
const ACCOUNT_VAULT_VERSION = 2;

/**
 * bitcoinjs-lib address parameters per network.
 * @private
 */
const ADDRESS_NETWORKS = Object.freeze({
  mainnet: networks.bitcoin,
  testnet: networks.testnet,
  regtest: networks.regtest
});

/**
 * BIP32 serialization versions (xprv/xpub, tprv/tpub).
 * @private
 */
const VERSIONS = Object.freeze({
  mainnet: networks.bitcoin.bip32,
  testnet: networks.testnet.bip32
});

/**
 * Canonical network name for account derivation.
 * @param {string} network
 * @returns {string} One of {@link ACCOUNT_NETWORKS}.
 */
function normalizeAccountNetwork (network) {
  if (isMainnetNetwork(network)) return 'mainnet';
  const n = String(network == null ? '' : network).trim().toLowerCase();
  if (n === 'test') return 'testnet';
  if (ACCOUNT_NETWORKS.includes(n)) return n;
  throw new RangeError(`unknown network: ${network}`);
}

/** @private */
function versionsFor (network) {
  return normalizeAccountNetwork(network) === 'mainnet' ? VERSIONS.mainnet : VERSIONS.testnet;
}

/** @private */
function addressNetworkFor (network) {
  const n = normalizeAccountNetwork(network);
  if (n === 'mainnet') return ADDRESS_NETWORKS.mainnet;
  if (n === 'regtest') return ADDRESS_NETWORKS.regtest;
  return ADDRESS_NETWORKS.testnet;
}

/**
 * @private
 * @param {string} base58
 * @returns {{ payload: Buffer, isPrivate: boolean }}
 */
function decodeExtendedKey (base58) {
  const payload = decodeCheck(String(base58 || '').trim());
  if (payload.length !== 78) throw new Error('invalid extended key length');
  const version = payload.readUInt32BE(0);
  const isPrivate = version === VERSIONS.mainnet.private || version === VERSIONS.testnet.private;
  const isPublic = version === VERSIONS.mainnet.public || version === VERSIONS.testnet.public;
  if (!isPrivate && !isPublic) throw new Error('unknown extended key version');
  return { payload, isPrivate };
}

/**
 * Re-serialize an extended key with a network's version bytes (`xpub`/`xprv`
 * on mainnet, `tpub`/`tprv` elsewhere). Key material is unchanged.
 * @param {string} base58
 * @param {string} network
 * @returns {string}
 */
function extendedKeyForNetwork (base58, network) {
  const { payload, isPrivate } = decodeExtendedKey(base58);
  const out = Buffer.from(payload);
  const versions = versionsFor(network);
  out.writeUInt32BE(isPrivate ? versions.private : versions.public, 0);
  return encodeCheck(out);
}

/**
 * Serialize an account xpub for sharing: the network's version bytes, with
 * depth, parent fingerprint, and child number zeroed. Those header fields
 * would otherwise tie every account of one seed to the same parent; child
 * derivation doesn't use them, so addresses are unchanged.
 * @param {string} base58 Account xpub / tpub.
 * @param {string} network
 * @returns {string}
 */
function shareableAccountXpub (base58, network) {
  const { payload, isPrivate } = decodeExtendedKey(base58);
  if (isPrivate) throw new Error('only public extended keys are shared');
  const out = Buffer.from(payload);
  out.writeUInt32BE(versionsFor(network).public, 0);
  out[4] = 0;
  out.writeUInt32BE(0, 5);
  out.writeUInt32BE(0, 9);
  return encodeCheck(out);
}

/**
 * Generate a new mnemonic. Show it once for backup; it is never stored.
 * @param {number} [strength=256] Entropy bits (128 → 12 words, 256 → 24 words).
 * @returns {string}
 */
function generateMnemonic (strength = 256) {
  return bip39.generateMnemonic(strength);
}

/**
 * Turn a mnemonic and optional BIP39 passphrase into the master xprv. Callers
 * drop the mnemonic and passphrase right after.
 * @param {string} mnemonic
 * @param {string} [passphrase] The derivation password (BIP39 passphrase).
 * @returns {string} Master xprv (mainnet serialization; the network is chosen per account).
 */
function importSeed (mnemonic, passphrase = '') {
  const phrase = String(mnemonic || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!bip39.validateMnemonic(phrase)) throw new Error('invalid BIP39 mnemonic');
  const seed = bip39.mnemonicToSeedSync(phrase, passphrase == null ? '' : String(passphrase));
  const key = new Key({ seed: Buffer.from(seed).toString('hex') });
  return normalizeMasterXprv(key.xprv);
}

/**
 * Validate a master xprv (depth 0, private) and serialize it for mainnet.
 * @param {string|Key} master xprv / tprv string or a Key holding one.
 * @returns {string}
 */
function normalizeMasterXprv (master) {
  const base58 = master instanceof Key ? master.xprv : master;
  if (typeof base58 !== 'string' || !base58) throw new TypeError('master xprv required');
  const { payload, isPrivate } = decodeExtendedKey(base58);
  if (!isPrivate) throw new Error('master xprv required (got a public key)');
  if (payload[4] !== 0) throw new Error('master xprv required (depth 0)');
  return extendedKeyForNetwork(base58, 'mainnet');
}

/**
 * Derive the three keys of one (account, network) pair.
 * @param {string|Key} master Master xprv.
 * @param {Object} [options]
 * @param {number} [options.account=0]
 * @param {string} [options.network='mainnet']
 * @returns {{ account: number, network: string, identity: { path: string, key: Key, pubkey: string, id: string }, wallet: { segwit: { path: string, xpub: string, key: Key }, taproot: { path: string, xpub: string, key: Key }, standard: { path: string, xpub: string, key: Key }, receive: string, descriptors: object }, cosigner: { path: string, key: Key, pubkey: string } }}
 */
function deriveAccount (master, options = {}) {
  const root = new Key({ xprv: normalizeMasterXprv(master) });
  const account = assertBip32ChildIndex(options.account != null ? options.account : 0, 'account');
  const network = normalizeAccountNetwork(options.network != null ? options.network : 'mainnet');

  const identityPath = fabricIdentityDerivationPath(account, 0, network);
  const identityKey = root.derive(identityPath);
  const identityPubkey = String(identityKey.pubkey).toLowerCase();

  const segwitPath = bitcoinAccountDerivationPath(84, account, network);
  const segwitKey = root.derive(segwitPath);
  const taprootPath = bitcoinAccountDerivationPath(bip86().BIP86_PURPOSE, account, network);
  const taprootKey = root.derive(taprootPath);
  const standardPath = bitcoinAccountDerivationPath(44, account, network);
  const standardKey = root.derive(standardPath);
  const wallet = {
    segwit: { path: segwitPath, xpub: shareableAccountXpub(segwitKey.xpub, network), key: segwitKey },
    taproot: { path: taprootPath, xpub: shareableAccountXpub(taprootKey.xpub, network), key: taprootKey },
    standard: { path: standardPath, xpub: shareableAccountXpub(standardKey.xpub, network), key: standardKey },
    receive: 'segwit'
  };
  wallet.descriptors = walletDescriptors(wallet);

  const cosignerPath = bitcoinCosignerDerivationPath(account, network);
  const cosignerKey = root.derive(cosignerPath);

  return {
    account,
    network,
    identity: {
      path: identityPath,
      key: identityKey,
      pubkey: identityPubkey,
      id: require('../functions/fabricIdentitySchnorr').fabricIdentityIdFromPubkeyHex(identityPubkey)
    },
    wallet,
    cosigner: {
      path: cosignerPath,
      key: cosignerKey,
      pubkey: String(cosignerKey.pubkey).toLowerCase()
    }
  };
}

/**
 * The watch set of a wallet: SegWit receive and change, the Taproot account's
 * `tr` receive and change (when the wallet has one), and the standard
 * account's `pkh` receive and change. No key origins.
 * @param {{ segwit: { xpub: string }, taproot: ({ xpub: string }|undefined), standard: { xpub: string } }} wallet
 * @returns {{ receive: string, change: string, watch: string[] }}
 */
function walletDescriptors (wallet) {
  if (!wallet || !wallet.segwit || !wallet.standard) throw new TypeError('wallet with segwit and standard accounts required');
  const s = wallet.segwit.xpub;
  const l = wallet.standard.xpub;
  const watch = [`wpkh(${s}/0/*)`, `wpkh(${s}/1/*)`];
  if (wallet.taproot) watch.push(`tr(${wallet.taproot.xpub}/0/*)`, `tr(${wallet.taproot.xpub}/1/*)`);
  watch.push(`pkh(${l}/0/*)`, `pkh(${l}/1/*)`);
  return {
    receive: `wpkh(${s}/0/*)`,
    change: `wpkh(${s}/1/*)`,
    watch
  };
}

/**
 * Address at `<chain>/<index>` of a wallet account xpub.
 * @param {Object} params
 * @param {string} params.xpub Account xpub / tpub.
 * @param {string} params.network
 * @param {('wpkh'|'tr'|'pkh')} [params.script='wpkh'] `tr` is BIP-86 (key path only).
 * @param {number} [params.change=0]
 * @param {number} [params.index=0]
 * @returns {string}
 */
function walletAddress (params = {}) {
  const network = normalizeAccountNetwork(params.network);
  const change = assertBip32ChildIndex(params.change != null ? params.change : 0, 'change');
  if (change !== 0 && change !== 1) throw new RangeError('change must be 0 or 1');
  const index = assertBip32ChildIndex(params.index != null ? params.index : 0, 'index');
  const node = new Key({ xpub: extendedKeyForNetwork(params.xpub, 'mainnet') });
  const pubkey = Buffer.from(node.master.derive(change).derive(index).publicKey);
  const net = addressNetworkFor(network);
  const script = params.script || 'wpkh';
  if (script === 'wpkh') return payments.p2wpkh({ pubkey, network: net }).address;
  if (script === 'tr') return bip86().address(pubkey, net);
  if (script === 'pkh') return payments.p2pkh({ pubkey, network: net }).address;
  throw new RangeError(`unsupported script: ${script}`);
}

/** @private */
function assertWalletVerified (wallet) {
  if (wallet && wallet.verified === false) {
    const err = new Error('unlock the vault before handing out addresses');
    err.code = 'FABRIC_ACCOUNT_UNVERIFIED';
    throw err;
  }
}

/**
 * Next receive address: always from the SegWit account. Refuses a wallet
 * from a locked vault view (`verified: false`, see {@link currentVaultAccount}).
 * @param {{ segwit: { xpub: string } }} wallet
 * @param {string} network
 * @param {number} index
 * @returns {string}
 */
function walletReceiveAddress (wallet, network, index = 0) {
  assertWalletVerified(wallet);
  return walletAddress({ xpub: wallet.segwit.xpub, network, script: 'wpkh', change: 0, index });
}

/**
 * Change address: always from the SegWit account. Refuses a wallet from a
 * locked vault view, like {@link walletReceiveAddress}.
 * @param {{ segwit: { xpub: string } }} wallet
 * @param {string} network
 * @param {number} index
 * @returns {string}
 */
function walletChangeAddress (wallet, network, index = 0) {
  assertWalletVerified(wallet);
  return walletAddress({ xpub: wallet.segwit.xpub, network, script: 'wpkh', change: 1, index });
}

/**
 * @private
 * @param {{ identityPubkey: string, cosignerPubkey: string, scope: string }} params
 * @returns {string}
 */
function cosignerProofMessage (params) {
  const identity = String(params.identityPubkey || '').toLowerCase();
  const cosigner = String(params.cosignerPubkey || '').toLowerCase();
  const scope = String(params.scope || '');
  if (!/^0[23][0-9a-f]{64}$/.test(identity)) throw new TypeError('compressed identity pubkey required');
  if (!/^0[23][0-9a-f]{64}$/.test(cosigner)) throw new TypeError('compressed cosigner pubkey required');
  if (!scope || scope.length > 512) throw new TypeError('scope required (at most 512 characters)');
  return `fabric-cosigner:1\n${scope}\n${identity}\n${cosigner}`;
}

/**
 * Sign a claim, by the holder of `cosignerKey`, that it acts for
 * `identityPubkey` within `scope` (e.g. `passport:<origin>:<challengeHash>`,
 * `group:<contractId>`). Only the cosigner key signs, and an identity pubkey
 * is public, so the proof alone does not show that the identity authorized
 * the cosigner: carry it inside a message the identity key signs, as a
 * `PASSPORT_ASSERTION` does.
 * @param {Key} cosignerKey
 * @param {{ identityPubkey: string, scope: string }} params
 * @returns {string} BIP340 signature hex.
 */
function cosignerProof (cosignerKey, params = {}) {
  if (!cosignerKey || !cosignerKey.private) throw new TypeError('cosigner private key required');
  const message = cosignerProofMessage({
    identityPubkey: params.identityPubkey,
    cosignerPubkey: cosignerKey.pubkey,
    scope: params.scope
  });
  return Buffer.from(cosignerKey.signSchnorr(message, signingTags.PASSPORT_COSIGNER)).toString('hex');
}

/**
 * Check a cosigner proof: the cosigner key signed this claim. Accept it only
 * from inside a message the identity key signed (see {@link cosignerProof}).
 * @param {{ cosigner: string, identityPubkey: string, scope: string, proof: string }} params
 * @returns {boolean}
 */
function verifyCosignerProof (params = {}) {
  try {
    const message = cosignerProofMessage({
      identityPubkey: params.identityPubkey,
      cosignerPubkey: params.cosigner,
      scope: params.scope
    });
    const sig = Buffer.from(String(params.proof || ''), 'hex');
    if (sig.length !== 64) return false;
    const key = new Key({ public: String(params.cosigner).toLowerCase() });
    return key.verifySchnorr(message, sig, signingTags.PASSPORT_COSIGNER);
  } catch (_) {
    return false;
  }
}

/**
 * Seal a master xprv with the lock password (Argon2id, AES-256-GCM).
 * @param {string|Key} master
 * @param {string} lockPassword
 * @returns {object}
 */
function sealMaster (master, lockPassword) {
  return sealJson({ xprv: normalizeMasterXprv(master) }, lockPassword, {
    type: 'FabricSealedMaster',
    version: ACCOUNT_VAULT_VERSION,
    kdf: 'argon2id'
  });
}

/**
 * Open a sealed master xprv.
 * @param {object} blob
 * @param {string} lockPassword
 * @returns {string}
 */
function unsealMaster (blob, lockPassword) {
  const inner = openSealedJson(blob, lockPassword);
  if (!inner || typeof inner.xprv !== 'string') throw new Error('sealed master is missing its xprv');
  return normalizeMasterXprv(inner.xprv);
}

/**
 * Public data of a derived account, cached unsealed in a vault so a locked
 * client can show identities and watch-only balances. Anyone able to edit the
 * record can change it, and no key is available to check it while locked, so
 * {@link currentVaultAccount} marks it unverified until the master checks it.
 * @param {object} derived result of `deriveAccount`
 * @param {string} [label]
 * @returns {object}
 */
function accountPublicView (derived, label) {
  return {
    account: derived.account,
    network: derived.network,
    label: label != null ? String(label).slice(0, 64) : `Account ${derived.account}`,
    identity: { pubkey: derived.identity.pubkey, id: derived.identity.id },
    wallet: {
      segwit: { path: derived.wallet.segwit.path, xpub: derived.wallet.segwit.xpub },
      taproot: { path: derived.wallet.taproot.path, xpub: derived.wallet.taproot.xpub },
      standard: { path: derived.wallet.standard.path, xpub: derived.wallet.standard.xpub },
      receive: 'segwit'
    },
    cosigner: { pubkey: derived.cosigner.pubkey }
  };
}

/**
 * Cache key of one (account, network) pair in a vault.
 * @param {number} account
 * @param {string} network
 * @returns {string}
 */
function vaultAccountKey (account, network) {
  return `${normalizeAccountNetwork(network)}:${assertBip32ChildIndex(account, 'account')}`;
}

/**
 * A new stored record: the sealed master, the current pair, and its public cache.
 * @param {Object} params
 * @param {string|Key} params.master
 * @param {string} params.lockPassword
 * @param {number} [params.account=0]
 * @param {string} [params.network='mainnet']
 * @param {string} [params.label]
 * @returns {object}
 */
function createAccountVault (params = {}) {
  const derived = deriveAccount(params.master, { account: params.account, network: params.network });
  const vault = {
    type: ACCOUNT_VAULT_TYPE,
    v: ACCOUNT_VAULT_VERSION,
    seal: sealMaster(params.master, params.lockPassword),
    current: { account: derived.account, network: derived.network },
    accounts: {}
  };
  vault.accounts[vaultAccountKey(derived.account, derived.network)] = accountPublicView(derived, params.label);
  return vault;
}

/** @private */
function assertAccountVault (vault) {
  if (!vault || vault.type !== ACCOUNT_VAULT_TYPE || vault.v !== ACCOUNT_VAULT_VERSION) {
    throw new TypeError('account vault v2 required');
  }
}

/** @private */
function vaultMismatch (why) {
  const err = new Error(`account vault cache does not match its master: ${why}`);
  err.code = 'FABRIC_ACCOUNT_VAULT_MISMATCH';
  return err;
}

/**
 * JSON text with object keys sorted. chrome.storage hands objects back with
 * sorted keys, so a cache check cannot depend on the order they were saved in.
 * @param {*} value
 * @returns {string|undefined}
 * @private
 */
function stableJSON (value) {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return `[${value.map((item) => stableJSON(item) ?? 'null').join(',')}]`;
  if (value && typeof value === 'object') {
    const parts = Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => `${JSON.stringify(key)}:${stableJSON(value[key])}`);
    return `{${parts.join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Check one cached account/network pair against what `master` derives.
 * @param {string} key Vault key of the pair (`vaultAccountKey`).
 * @param {object} cached The cached public view.
 * @param {string|Key} master
 * @returns {object} The fresh view of a cached pair; throws when they differ.
 */
function checkCachedAccount (key, cached, master) {
  if (!cached || vaultAccountKey(cached.account, cached.network) !== key) throw vaultMismatch(key);
  const fresh = accountPublicView(deriveAccount(master, { account: cached.account, network: cached.network }), cached.label);
  // Caches from before the Taproot account lack it; the fresh view supplies it.
  const compared = (cached.wallet && !cached.wallet.taproot)
    ? Object.assign({}, fresh, { wallet: withoutTaproot(fresh.wallet) })
    : fresh;
  if (stableJSON(compared) !== stableJSON(cached)) throw vaultMismatch(key);
  return fresh;
}

/** @private */
function withoutTaproot (wallet) {
  const rest = Object.assign({}, wallet);
  delete rest.taproot;
  return rest;
}

/**
 * Check every cached pair of a vault against what `master` derives, and
 * refuse a vault whose cache was edited (say, an xpub swapped for someone
 * else's). Re-deriving checks more than a MAC could, and needs no key while
 * locked, when nothing could check a MAC anyway.
 * @param {object} vault
 * @param {string|Key} master
 * @returns {object} The vault, unchanged.
 */
function verifyVaultAccounts (vault, master) {
  assertAccountVault(vault);
  const accounts = vault.accounts || {};
  for (const [key, cached] of Object.entries(accounts)) checkCachedAccount(key, cached, master);
  if (!vault.current || !accounts[vaultAccountKey(vault.current.account, vault.current.network)]) {
    throw vaultMismatch('current account is not cached');
  }
  return vault;
}

/**
 * Unlock a vault: open the sealed master with the lock password and check the
 * public cache against it ({@link verifyVaultAccounts}). Pass the master to
 * {@link currentVaultAccount} for a view that hands out addresses.
 * @param {object} vault
 * @param {string} lockPassword
 * @returns {string} Master xprv.
 */
function openAccountVault (vault, lockPassword) {
  assertAccountVault(vault);
  const master = unsealMaster(vault.seal, lockPassword);
  verifyVaultAccounts(vault, master);
  return master;
}

/**
 * Switch a vault to another pair. Derives (and caches) it when the master is
 * given; without it only cached pairs can be selected.
 * @param {object} vault
 * @param {{ account: number, network: string, master: (string|Key|undefined), label: (string|undefined) }} params
 * @returns {object} New vault record.
 */
function selectVaultAccount (vault, params = {}) {
  assertAccountVault(vault);
  const network = normalizeAccountNetwork(params.network);
  const account = assertBip32ChildIndex(params.account, 'account');
  const key = vaultAccountKey(account, network);
  const accounts = Object.assign({}, vault.accounts);
  if (params.master) {
    const derived = deriveAccount(params.master, { account, network });
    const prior = accounts[key];
    accounts[key] = accountPublicView(derived, params.label != null ? params.label : (prior && prior.label));
  } else if (!accounts[key]) {
    const err = new Error('unlock to add this account');
    err.code = 'FABRIC_ACCOUNT_LOCKED';
    throw err;
  } else if (params.label != null) {
    accounts[key] = Object.assign({}, accounts[key], { label: String(params.label).slice(0, 64) });
  }
  return Object.assign({}, vault, { current: { account, network }, accounts });
}

/**
 * Public view of the vault's current pair, marked `verified` on the view and
 * its `wallet`. Without the master it is the cache as stored, `verified:
 * false`: show it as unverified, and {@link walletReceiveAddress} /
 * {@link walletChangeAddress} refuse its wallet. With the master the pair is
 * re-derived and checked first (`FABRIC_ACCOUNT_VAULT_MISMATCH` when it
 * differs), and the view is `verified: true`.
 * @param {object} vault
 * @param {string|Key} [master]
 * @returns {object|null}
 */
function currentVaultAccount (vault, master) {
  if (!vault || !vault.current || !vault.accounts) return null;
  const key = vaultAccountKey(vault.current.account, vault.current.network);
  const cached = vault.accounts[key];
  if (!cached) return null;
  const view = master ? checkCachedAccount(key, cached, master) : cached;
  const verified = Boolean(master);
  return Object.assign({}, view, { verified, wallet: Object.assign({}, view.wallet, { verified }) });
}



  return {
    ARGON2_MASTER: true,
    ACCOUNT_NETWORKS,
    ACCOUNT_VAULT_TYPE,
    ACCOUNT_VAULT_VERSION,
    WALLET_GAP_LIMIT,
    normalizeAccountNetwork,
    extendedKeyForNetwork,
    shareableAccountXpub,
    generateMnemonic,
    importSeed,
    normalizeMasterXprv,
    deriveAccount,
    walletDescriptors,
    walletAddress,
    walletReceiveAddress,
    walletChangeAddress,
    cosignerProof,
    verifyCosignerProof,
    sealMaster,
    unsealMaster,
    accountPublicView,
    vaultAccountKey,
    createAccountVault,
    checkCachedAccount,
    verifyVaultAccounts,
    openAccountVault,
    selectVaultAccount,
    currentVaultAccount
  };
})();
Key.Accounts = accountKeys;
Object.assign(Key, accountKeys);

const operatorIdentity = (function () {
  const classifyFabricKeyMaterial = keyMaterial.classifyFabricKeyMaterial;
  const classifyFabricIdentityEnvValue = keyMaterial.classifyFabricIdentityEnvValue;
  const keySettingsFromEnv = keyMaterial.keySettingsFromEnv;
/**
 * Copy a non-empty `passphrase` (or `password`) from `bag` onto `out`.
 * @private
 */
function withPassphrase (out, bag) {
  if (!out || !bag || typeof bag !== 'object') return out;
  const passphrase = bag.passphrase != null ? bag.passphrase : bag.password;
  if (passphrase == null || passphrase === '') return out;
  out.passphrase = passphrase;
  return out;
}

/**
 * Collapse a Key settings bag to a single identity source.
 * Private HD (`xprv`) wins over seed/mnemonic so mixed env copies do not
 * silently follow Key's mnemonic-first constructor.
 *
 * @param {Object} [bag]
 * @returns {Object|null}
 */
function exclusiveOperatorKeySettings (bag = {}) {
  if (!bag || typeof bag !== 'object') return null;

  const xprvField = String(bag.xprv || '').trim();
  const fromXprvField = classifyFabricIdentityEnvValue(xprvField);
  if (fromXprvField.kind === 'xprv') {
    const out = { xprv: fromXprvField.xprv };
    const xpub = String(bag.xpub || '').trim();
    if (xpub.startsWith('xpub') || xpub.startsWith('tpub')) out.xpub = xpub;
    return withPassphrase(out, bag);
  }
  if (fromXprvField.kind === 'xpub') {
    return withPassphrase({ xpub: fromXprvField.xpub }, bag);
  }
  if (fromXprvField.kind === 'pubkey') {
    return withPassphrase({ public: fromXprvField.public }, bag);
  }

  if (bag.seed != null && String(bag.seed).trim() !== '') {
    const classified = classifyFabricKeyMaterial(bag.seed);
    if (classified.kind === 'xprv') return withPassphrase({ xprv: classified.xprv }, bag);
    if (classified.kind === 'seedHex') return withPassphrase({ seed: classified.seed }, bag);
    if (classified.kind === 'mnemonic') {
      return withPassphrase({ mnemonic: classified.mnemonic }, bag);
    }
  }

  const mnemonic = String(bag.mnemonic || '').trim();
  if (mnemonic) {
    const classified = classifyFabricKeyMaterial(mnemonic);
    if (classified.kind === 'mnemonic') {
      return withPassphrase({ mnemonic: classified.mnemonic }, bag);
    }
    if (classified.kind === 'xprv') return withPassphrase({ xprv: classified.xprv }, bag);
    if (classified.kind === 'seedHex') return withPassphrase({ seed: classified.seed }, bag);
  }

  const xpub = String(bag.xpub || '').trim();
  if (xpub.startsWith('xpub') || xpub.startsWith('tpub')) {
    return withPassphrase({ xpub }, bag);
  }
  const pub = String(bag.public || bag.pubkey || '').trim();
  const pubClassified = classifyFabricIdentityEnvValue(pub);
  if (pubClassified.kind === 'pubkey') {
    return withPassphrase({ public: pubClassified.public }, bag);
  }

  return null;
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @param {Object} [opts]
 * @param {boolean} [opts.allowWalletFallback=true]
 * @param {string} [opts.password]
 * @returns {{ source: string, key: Object }|null}
 */
function resolveFabricOperatorKeySettings (env = process.env, opts = {}) {
  const allowWallet = opts.allowWalletFallback !== false;
  const fromEnv = keySettingsFromEnv(env);
  if (fromEnv && (fromEnv.xprv || fromEnv.seed || fromEnv.mnemonic)) {
    const key = exclusiveOperatorKeySettings(fromEnv) || fromEnv;
    const source = fromEnv.xprv
      ? 'FABRIC_XPRV'
      : (fromEnv.seed ? 'FABRIC_SEED' : 'FABRIC_MNEMONIC');
    return { source, key };
  }

  // Watch-only FABRIC_XPRV (xpub/pubkey) beats wallet.json — same exclusive env rule.
  if (fromEnv && (fromEnv.xpub || fromEnv.public)) {
    let source = 'FABRIC_PUBKEY';
    if (fromEnv.xpub) {
      const slot = classifyFabricIdentityEnvValue((env && env.FABRIC_XPRV) || '');
      source = slot.kind === 'xpub' ? 'FABRIC_XPRV' : 'FABRIC_XPUB';
    }
    return {
      source,
      key: exclusiveOperatorKeySettings(fromEnv) || fromEnv
    };
  }

  if (allowWallet) {
    try {
      const { loadIdentityFromWalletFile } = require('../functions/fabricWalletIdentity');
      const wallet = loadIdentityFromWalletFile({
        home: env && env.HOME,
        password: opts.password != null ? opts.password : (env && env.FABRIC_PASSWORD)
      });
      if (wallet && wallet.xprv) {
        const key = exclusiveOperatorKeySettings({
          xprv: wallet.xprv,
          seed: wallet.seed,
          mnemonic: wallet.mnemonic,
          xpub: wallet.xpub
        }) || { xprv: wallet.xprv };
        return { source: 'wallet.json', key };
      }
    } catch (_) { /* older pin or locked wallet */ }
  }

  return null;
}



  return { exclusiveOperatorKeySettings, resolveFabricOperatorKeySettings };
})();
Key.Operator = operatorIdentity;
Object.assign(Key, operatorIdentity);
