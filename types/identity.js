'use strict';

const Actor = require('./actor');
const Bech32 = require('./bech32');
const Hash256 = require('./hash256');
const Key = require('./key');

class Identity extends Actor {
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      seed: null,
      accountID: 0,
      index: 0
    }, this.settings, settings);

    this.key = new Key(this.settings);

    this._state = {
      content: {
        accountID: this.settings.accountID,
        index: this.settings.index
      }
    };

    return this;
  }

  get accountID () {
    return this._state.content.accountID;
  }

  get derivation () {
    // m / purpose' / coin_type' / account' / change / address_index
    // NOTE:
    // Always using Coin Type 0 (Bitcoin) and Change 0 (Public Flag)!
    // We will use Change 1 ("Internal Chain" as designated by BIP0044)
    // for any kind of revoke mechanic; i.e., the key derived by the change
    // address may be used to auto-encode a "revocation" contract.
    return `m/44'/0'/${this.accountID}'/0/${this.index}`;
  }

  get index () {
    return this._state.content.index;
  }

  get master () {
    return this.key;
  }

  get pubkey () {
    return this.key.public.x.toString('hex');
  }

  get pubkeyhash () {
    return Hash256.digest(this.pubkey);
  }

  loadAccountByID (id = 0) {
    this._state.content.accountID = id;
    return this;
  }

  toString () {
    if (this.settings.debug) console.log('master key:', this.key.master.publicKey);
    if (this.settings.debug) console.log('pubkey for id:', this.pubkey);

    const bech32 = new Bech32({
      hrp: 'id',
      content: Hash256.digest(this.pubkey)
    });

    if (this.settings.debug) console.log('bech32:', bech32);

    return bech32.toString();
  }
}

module.exports = Identity;
