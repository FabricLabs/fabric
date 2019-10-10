'use strict';

// Types
const Collection = require('./collection');
const Service = require('./service');
const State = require('./state');

// Bcoin
const bcoin = require('bcoin/lib/bcoin-browser').set('testnet');
// Convenience classes...
const Coin = bcoin.Coin;
const WalletDB = bcoin.WalletDB;
const WalletKey = bcoin.wallet.WalletKey;
const Outpoint = bcoin.Outpoint;
const Keyring = bcoin.wallet.WalletKey;
const Mnemonic = bcoin.hd.Mnemonic;
const HD = bcoin.hd;

/**
 * Manage keys and track their balances.
 * @type {Object}
 */
class Wallet extends Service {
  /**
   * Create an instance of a {@link Wallet}.
   * @param  {Object} [settings={}] Configure the wallet.
   * @return {Wallet}               Instance of the wallet.
   */
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      name: 'default',
      network: 'testnet',
      language: 'english',
      key: null
    }, settings);

    this.database = new WalletDB({
      db: 'memory',
      network: this.settings.network
    });

    this.account = null;
    this.manager = null;
    this.wallet = null;
    this.master = null;
    this.seed = null;
    this.key = null;

    this.words = Mnemonic.getWordlist(this.settings.language).words;
    this.mnemonic = null;
    this.index = 0;

    this.accounts = new Collection();

    this.state = {
      asset: null,
      balances: {
        confirmed: 0,
        unconfirmed: 0
      },
      transactions: []
    };

    this.status = 'closed';

    return this;
  }

  get balance () {
    return this.get('/balances/confirmed');
  }

  get transactions () {
    return this.get('/transactions');
  }

  async _createAccount (data) {
    return this.wallet.createAccount(data);
  }

  async _updateBalance (amount) {
    return this.set('/balances/confirmed', amount);
  }

  _handleWalletTransaction (tx) {
    console.log('[BRIDGE:WALLET]', 'incoming transaction:', tx);
  }

  _getDepositAddress () {
    return this.address;
  }

  _getSeed () {
    return this.seed;
  }

  _getAccountByIndex (index = 0) {
    return {
      address: this.account.deriveReceive(index).getAddress('string')
    };
  }

  async _getFreeCoinbase (amount) {
    const coins = {};
    const coinbase = new MTX();

    // Add a typical coinbase input
    coinbase.addInput({
      prevout: new Outpoint(),
      script: new Script()
    });

    coinbase.addOutput({
      address: this._getDepositAddress(),
      value: amount * 100000000 // amount in Satoshis
    });

    // Convert the coinbase output to a Coin
    // object and add it to the available coins for that keyring.
    // In reality you might get these coins from a wallet.
    coins[0] = Coin.fromTX(coinbase, 0, -1);
    console.log('coins:', coins);

    return coins[0];
  }


  async _getSpendableOutput (amount) {
    let key = null;
    let mtx = new MTX();
    let address = ``;

    mtx.addOutput({ value: amount, address: `${address}` });

    return {
      mtx: mtx
    };
  }

  async generateCleanKeyPair () {
    if (this.status !== 'loaded') await this._load();

    this.index++;
    let key = this.master.derivePath(`m/44/0/0/0/${this.index}`);
    let keyring = KeyRing.fromPrivate(key.privateKey);
    return {
      index: this.index,
      public: keyring.publicKey
    };
  }

  async _handleWalletBalance (balance) {
    console.log('wallet balance:', balance);
    await this._PUT(`/balance`, balance);

    let depositor = new State({ name: this.settings.name || 'default' });
    await this._PUT(`/depositors/${depositor.id}/balance`, balance);
    this.emit('balance', balance);
  }

  async _registerAccount (obj) {
    if (!obj.name) throw new Error('Account must have "name" property.');

    this.status = 'creating';

    if (!this.database.db.loaded) {
      await this.database.open();
    }

    // TODO: register account with this.wallet
    let account = await this.accounts.create(obj);
    console.log('registering account, created:', account);
    let wallet = await this.wallet.createAccount({ name: obj.name });
    console.log('bcoin wallet account:', wallet);

    if (this.manager) {
      this.manager.on('tx', this._handleWalletTransaction.bind(this));
      this.manager.on('balance', this._handleWalletBalance.bind(this));
    }

    console.log('internal wallet:', this.wallet);
    console.log('internal account:', this.account);

    return account;
  }

  async _unload () {
    return this.database.close();
  }

  async _load (settings = {}) {
    this.status = 'loading';

    await this.database.open();

    let master = null;

    try {
      if (this.settings.key) {
        let mnemonic = new Mnemonic(this.settings.key.seed);
        master = bcoin.hd.fromMnemonic(mnemonic);
      }
    } catch (E) {
      console.error('Could not find/restore key:', E);
    }

    this.wallet = await this.database.create({
      name: 'default',
      network: this.settings.network,
      master: master
    });

    this.account = await this.wallet.getAccount('default');
    this.address = await this.account.receiveAddress();
    this.master = master;

    /* this.account.bind('confirmed', async function (wallet, transaction) {
      console.log('wallet confirmed:', wallet, transaction);
      self.emit('confirmation', {
        '@type': 'Confirmation',
        '@data': transaction
      });
    }); */

    this.status = 'loaded';

    this.emit('ready');

    // console.log('[FABRIC:WALLET]', 'Wallet opened:', this.wallet);

    return this;
  }

  async start () {
    return this._load();
  }
}

module.exports = Wallet;
