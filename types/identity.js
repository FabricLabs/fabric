'use strict';

const Actor = require('./actor');
const Bech32 = require('./bech32');
const Hash256 = require('./hash256');
const Key = require('./key');
const {
  FABRIC_KEY_DERIVATION_PATH,
  fabricIdentityDerivationPath,
  assertBip32ChildIndex
} = require('../constants');

/**
 * @classdesc <strong>BIP32/BIP39 identity</strong> wrapping {@link Key}: mnemonic / xprv / passphrase.
 * Protocol identity (pubkey / Schnorr sign / Bech32 id) uses the Fabric derivation path
 * <code>m/44'/{7777|7778}'/account'/0/index</code> — coin type <strong>7777</strong> on Bitcoin
 * mainnet, <strong>7778</strong> on all other networks (see {@link Identity#derivation} and
 * IDENTITY.md). The HD <strong>master</strong> remains available as {@link Identity#master} /
 * {@link Identity#key} so Bitcoin funds can derive under BIP44 coin type <code>0</code> (see
 * <code>BITCOIN_KEY_DERIVATION_PATH</code> in <code>constants.js</code>
 * / Wallet) without mixing protocol identity keys with spend keys.
 * <strong>Important:</strong> this class overrides {@link Actor#id} with <code>toString()</code>
 * (human-facing / Bech32-style identity), <strong>not</strong> the content-addressed
 * <code>Actor#id</code> / <code>preimage</code> chain from {@link Actor#toGenericMessage}. Use
 * <code>pubkey</code>, <code>pubkeyhash</code>, or explicit hashing when you need stable bytes.
 * @class Identity
 * @extends Actor
 */
class Identity extends Actor {
  /**
   * Create an instance of an Identity.
   * @param {Object} [settings] Settings for the Identity.
   * @param {String} [settings.seed] Raw BIP32 seed hex, or a legacy BIP39 mnemonic.
   * @param {String} [settings.mnemonic] BIP39 mnemonic (preferred over putting words in `seed`).
   * @param {String} [settings.xprv] Serialized BIP 32 master private key.
   * @param {String} [settings.xpub] Serialized BIP 32 master public key.
   * @param {Number} [settings.account=0] BIP 44 account index (Fabric coin type 7777/7778).
   * @param {Number} [settings.index=0] BIP 44 address index.
   * @param {String} [settings.network=regtest] Bitcoin network name; selects Fabric coin type
   *   (`mainnet` → 7777, otherwise → 7778).
   * @param {String} [settings.passphrase] Passphrase for the key.
   * @returns {Identity} Instance of the identity.
   */
  constructor (settings = {}) {
    const fromKey = settings instanceof Key;
    super(fromKey ? {} : settings);

    this.settings = Object.assign({
      seed: null,
      mnemonic: null,
      xprv: null,
      passphrase: null,
      account: 0,
      index: 0,
      network: 'regtest'
    }, fromKey ? {} : settings);

    // Initialize master key (Bitcoin fund root). Protocol signing uses {@link #fabricKey}.
    if (fromKey) {
      this.key = settings;
    } else {
      this.key = new Key({
        mnemonic: this.settings.mnemonic,
        seed: this.settings.seed,
        xprv: this.settings.xprv,
        passphrase: this.settings.passphrase
      });

      // Ensure we have a private key
      if (!this.key.xprv) {
        // Generate a new key if none provided
        this.key = new Key();
        this.settings.xprv = this.key.xprv;
      }
    }

    this._state = {
      content: {
        account: assertBip32ChildIndex(
          this.settings.account != null ? this.settings.account : 0,
          'account'
        ),
        index: assertBip32ChildIndex(
          this.settings.index != null ? this.settings.index : 0,
          'index'
        ),
        network: this.settings.network != null ? String(this.settings.network) : 'regtest'
      }
    };

    return this;
  }

  get accountID () {
    return this._state.content.account;
  }

  get network () {
    return this._state.content.network || 'regtest';
  }

  get derivation () {
    // m / purpose' / coin_type' / account' / change / address_index
    // Fabric identity: 7777 mainnet / 7778 otherwise (IDENTITY.md). Change 0 = external;
    // change 1 is reserved for revoke / internal-chain mechanics.
    return fabricIdentityDerivationPath(this.accountID, this.index, this.network);
  }

  get id () {
    return this.toString();
  }

  get index () {
    return this._state.content.index;
  }

  /** HD master key — use for Bitcoin BIP44 coin-type-0 fund derivation only. */
  get master () {
    return this.key;
  }

  /**
   * Fabric-protocol signing key at {@link Identity#derivation}.
   * When this.key is already a protocol account/signing node (or public-only),
   * derivation may be impossible — use the key as-is.
   * @returns {Key}
   */
  get fabricKey () {
    const path = this.derivation || FABRIC_KEY_DERIVATION_PATH;
    try {
      return this.key.derive(path);
    } catch (_) {
      return this.key;
    }
  }

  get pubkey () {
    return this.fabricKey.pubkey;
  }

  get pubkeyhash () {
    const input = Buffer.from(this.pubkey, 'hex');
    return Hash256.digest(input);
  }

  static fromString (input = '') {
    const parsed = Bech32.decode(input);
    return {
      content: parsed.content.toString('hex')
    };
  }

  loadAccountByID (id = 0) {
    this._state.content.account = assertBip32ChildIndex(id, 'account');
    this.commit();
    return this;
  }

  sign (data = Buffer.from('', 'hex')) {
    return this.fabricKey.sign(data);
  }

  /**
   * Retrieve the bech32m-encoded identity.
   * @returns {String} Public identity.
   */
  toString () {
    const bech32 = new Bech32({
      hrp: 'id',
      content: this.pubkeyhash
    });

    return bech32.toString();
  }

  _nextAccount () {
    ++this._state.content.account;
    this.commit();
    return this;
  }

  _signAsSchnorr (input) {
    if (!input) input = this.pubkeyhash;
    this._signature = this.fabricKey.sign(input);
    return this;
  }

  /**
   * True when `key` matches the BIP32 child of `parent` at this identity's
   * Fabric derivation path (or an explicit `path`).
   * @param {Key|string|{ pubkey?: string }} key Candidate key or pubkey hex.
   * @param {Key} [parent=this.master] Parent HD key.
   * @param {string} [path] Override derivation path (default {@link Identity#derivation}).
   * @returns {boolean}
   */
  _verifyKeyIsChild (key, parent = this.master, path = null) {
    if (!parent || typeof parent.derive !== 'function') return false;
    const derivePath = path != null ? String(path) : this.derivation;
    let child;
    try {
      child = parent.derive(derivePath);
    } catch (_) {
      return false;
    }
    const expect = String(child.pubkey || '').toLowerCase();
    if (!expect) return false;
    let got = '';
    if (typeof key === 'string') got = key;
    else if (key && typeof key === 'object') got = key.pubkey || key.publicKey || '';
    return String(got).toLowerCase() === expect;
  }
}

module.exports = Identity;
