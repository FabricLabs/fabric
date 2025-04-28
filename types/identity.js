'use strict';

const Actor = require('./actor');
const Bech32 = require('./bech32');
const Hash256 = require('./hash256');
const Key = require('./key');

/**
 * Manage a network identity.
 */
class Identity extends Actor {
  /**
   * Create an instance of an Identity.
   * @param {Object} [settings] Settings for the Identity.
   * @param {String} [settings.seed] BIP 39 seed phrase.
   * @param {String} [settings.xprv] Serialized BIP 32 master private key.
   * @param {String} [settings.xpub] Serialized BIP 32 master public key.
   * @param {Number} [settings.account=0] BIP 44 account index.
   * @param {Number} [settings.index=0] BIP 44 key index.
   * @param {String} [settings.passphrase] Passphrase for the key.
   * @returns {Identity} Instance of the identity.
   */
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      seed: null,
      xprv: null,
      passphrase: null
    }, settings);

    // Initialize key
    this.key = new Key({
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

    this._state = {
      content: {
        account: this.settings.account,
        index: this.settings.index
      }
    };

    return this;
  }

  get accountID () {
    return this._state.content.account;
  }

  get derivation () {
    // m / purpose' / coin_type' / account' / change / address_index
    // NOTE:
    // Always using Coin Type 0 (Bitcoin) and Change 0 (Public Flag)!
    // We will use Change 1 ("Internal Chain" as designated by BIP0044)
    // for any kind of revoke mechanic; i.e., the key derived by the change
    // address may be used to auto-encode a "revocation" contract.
    return `m/44'/7778'/${this.accountID}'/0/${this.index}`;
  }

  get id () {
    return this.toString();
  }

  get index () {
    return this._state.content.index;
  }

  get master () {
    return this.key;
  }

  get pubkey () {
    return this.key.pubkey;
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
    this._state.content.accountID = id;
    this.commit();
    return this;
  }

  sign (data = Buffer.from('', 'hex')) {
    return this.key.sign(data);
  }

  /**
   * Retrieve the bech32m-encoded identity.
   * @returns {String} Public identity.
   */
  toString () {
    if (this.settings.debug) console.log('master key:', this.key.master.publicKey);
    if (this.settings.debug) console.log('pubkey for id:', this.pubkey);

    const bech32 = new Bech32({
      hrp: 'id',
      content: this.pubkeyhash
    });

    if (this.settings.debug) console.log('bech32:', bech32);

    return bech32.toString();
  }

  _nextAccount () {
    ++this._state.content.account;
    this.commit();
    return this;
  }

  _signAsSchnorr (input) {
    if (!input) input = this.pubkeyhash;
    this._signature = this.key.sign(input)
    return this;
  }

  _verifyKeyIsChild (key, parent) {
    
  }
}

module.exports = Identity;
