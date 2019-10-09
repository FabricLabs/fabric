'use strict';

const Service = require('./service');
const State = require('./state');
const bcoin = require('bcoin/lib/bcoin-browser').set('testnet');

const WalletDB = bcoin.WalletDB;
const WalletKey = bcoin.wallet.WalletKey;
const KeyRing = bcoin.KeyRing;
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

    this.words = Mnemonic.getWordlist('english').words;
    this.mnemonic = new Mnemonic();
    this.index = 0;

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

    let depositor = new State({ name: 'eric' });
    await this._PUT(`/depositors/${depositor.id}/balance`, balance);
    this.emit('balance', balance);
  }

  async _registerAccount (obj) {
    this.status = 'creating';

    if (!this.database.db.loaded) {
      await this.database.open();
    }

    try {
      this.wallet = await this.database.create();
    } catch (E) {
      console.error('Could not create wallet:', E);
    }

    if (this.manager) {
      this.manager.on('tx', this._handleWalletTransaction.bind(this));
      this.manager.on('balance', this._handleWalletBalance.bind(this));
    }

    return this.account;
  }

  async _unload () {
    return this.database.close();
  }

  async _load (settings = {}) {
    this.status = 'loading';

    await this.database.open();

    let master = null;

    console.log('wallet settings:', this.settings);

    try {
      let buffer = Buffer.from(this.settings.key.private, 'hex');
      this.key = HD.fromRaw(buffer, this.settings.network);
    } catch (E) {
      console.error('could not cast key:', E);
    }

    if (this.settings.key) {
      console.log('LOADING WALLET WITH KNOWN KEY:', this.settings.key);
      master = bcoin.hd.fromXpriv(this.settings.key.xprivkey)
    }

    this.wallet = await this.database.create({ master: master });
    this.account = await this.wallet.getAccount('default');
    this.address = await this.account.receiveAddress();
    this.seed = this.wallet.master.mnemonic.phrase;
    this.master = HD.fromMnemonic(this.wallet.master.mnemonic);

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

    return this.wallet;
  }

  async start () {
    return this._load();
  }
}

module.exports = Wallet;
