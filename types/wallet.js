'use strict';

// Types
const Collection = require('./collection');
const Service = require('./service');
const State = require('./state');

// Bcoin
const bcoin = require('bcoin/lib/bcoin-browser').set('testnet');
// Convenience classes...
const Address = bcoin.Address;
const Coin = bcoin.Coin;
const WalletDB = bcoin.WalletDB;
const WalletKey = bcoin.wallet.WalletKey;
const Outpoint = bcoin.Outpoint;
const Output = bcoin.Output;
const Keyring = bcoin.wallet.WalletKey;
const Mnemonic = bcoin.hd.Mnemonic;
const HD = bcoin.hd;
const MTX = bcoin.MTX;
const Script = bcoin.Script;


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
      network: 'regtest',
      language: 'english',
      witness: false,
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
    this.ring = null;
    this.seed = null;
    this.key = null;

    this.words = Mnemonic.getWordlist(this.settings.language).words;
    this.mnemonic = null;
    this.index = 0;

    this.accounts = new Collection();
    this.coins = new Collection();

    // Internal State
    this._state = {
      coins: []
    };

    // External State
    this.state = {
      asset: null,
      balances: {
        confirmed: 0,
        unconfirmed: 0
      },
      coins: [],
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

  getAddressFromRedeemScript (redeemScript) {
    return Address.fromScripthash(redeemScript.hash160());
  }

  async _createAccount (data) {
    console.log('wallet creating account with data:', data);
    return this.wallet.createAccount(data);
  }

  async _updateBalance (amount) {
    return this.set('/balances/confirmed', amount);
  }

  _handleWalletTransaction (tx) {
    console.log('[BRIDGE:WALLET]', 'incoming transaction:', tx);
  }

  _getDepositAddress () {
    return this.ring.getAddress().toString();
  }

  _getSeed () {
    return this.seed;
  }

  _getAccountByIndex (index = 0) {
    return {
      address: this.account.deriveReceive(index).getAddress('string')
    };
  }

  async _getFreeCoinbase (amount = 1) {
    await this._load();

    const coins = {};
    const coinbase = new MTX();

    // INSERT 1 Input
    coinbase.addInput({
      prevout: new Outpoint(),
      script: new Script(),
      sequence: 0xffffffff
    });

    // INSERT 1 Output
    coinbase.addOutput({
      address: this._getDepositAddress(),
      value: amount * 100000000 // amount in Satoshis
    });

    // TODO: wallet._getSpendableOutput()
    let coin = Coin.fromTX(coinbase, 0, -1);

    this._state.coins.push(coin);

    console.log('coins:', this._state.coins);
    
    return this._state.coins[0];
  }

  async _sign (tx) {
    let signature = await tx.sign(this.keyring);
    console.log('signing tx:', tx);
    console.log('signing sig:', signature);
    return Object.assign({}, tx, { signature });
  }

  async _createIncentivizedTransaction (config) {
    console.log('creating incentivized transaction with config:', config);

    let mtx = new MTX();
    let data = new Script();

    data.pushSym('OP_IF');
    data.pushSym('OP_SHA256');
    data.pushData(hash);
    data.pushSym('OP_EQUALVERIFY');
    data.pushData(swapPubkey);
    data.pushSym('OP_CHECKSIG');
    data.pushSym('OP_ELSE');
    data.pushInt(locktime);
    data.pushSym('OP_CHECKSEQUENCEVERIFY');
    data.pushSym('OP_DROP');
    data.pushData(refundPubkey);
    data.pushSym('OP_CHECKSIG');
    data.pushSym('OP_ENDIF');
    data.compile();

    console.log('address data:', data);

    mtx.addOutput({
      address: data,
      value: 0
    });

    // TODO: load available outputs from wallet
    let out = await mtx.fund([] /* coins */, {
      // TODO: fee estimation
      rate: 10000,
      changeAddress: this.ring.getAddress()
    });



    console.log('transaction:', out);
    return out;
  }

  async _getBondAddress () {
    await this._load();

    let script = new Script();
    let clean = await this.generateCleanKeyPair();

    console.log('[AUDIT]', 'getting bond address, clean:', clean);

    // write the contract
    // script.pushData(clean.public.toString('hex'));
    // script.pushSym('OP_CHECKSIG');

    // compile the script
    // script.compile();

    return {
      pubkey: clean.public.toString(),
      address: clean.address
    };
  }

  async _getSpendableOutput (target, amount = 0) {
    let self = this;
    let key = null;
    let out = null;
    let mtx = new MTX();

    await this._load();

    console.log('funding transaction with coins:', this._state.coins);

    // INSERT 1 Output
    mtx.addOutput({
      address: target,
      value: amount
    });

    out = await mtx.fund(this._state.coins, {
      // TODO: fee estimation
      rate: 10000,
      changeAddress: self.ring.getAddress()
    });

    console.log('out:', out);

    console.trace('created mutable transaction:', mtx);
    console.trace('created immutable transaction:', mtx.toTX());

    return {
      tx: mtx.toTX(),
      mtx: mtx
    };
  }

  async generateCleanKeyPair () {
    if (this.status !== 'loaded') await this._load();

    this.index++;

    let key = this.master.derivePath(`m/44/0/0/0/${this.index}`);
    let keyring = bcoin.KeyRing.fromPrivate(key.privateKey);

    return {
      index: this.index,
      public: keyring.publicKey.toString('hex'),
      address: keyring.getAddress('string')
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

  /**
   * Initialize the wallet, including keys and addresses.
   * @param {Object} settings 
   */
  async _load (settings = {}) {
    if (this.wallet) return this;

    this.status = 'loading';
    this.master = null;

    if (!this.database.db.loaded) {
      await this.database.open();
    }

    if (this.settings.key && this.settings.key.seed) {
      let mnemonic = new Mnemonic(this.settings.key.seed);
      this.master = bcoin.hd.fromMnemonic(mnemonic);
    } else {
      this.master = bcoin.hd.from(mnemonic, this.settings.network);
    }

    this.wallet = await this.database.create({
      name: this.settings.name,
      network: this.settings.network,
      master: this.master
    });

    // Setup Ring
    this.ring = new bcoin.KeyRing(this.master, this.settings.network);
    this.ring.witness = this.settings.witness;

    console.log('keyring:', this.ring);
    console.log('address from keyring:', this.ring.getAddress().toString());

    // TODO: notify downstream of short-circuit removal
    this.account.bind('confirmed', async function (wallet, transaction) {
      console.log('[AUDIT]', 'wallet confirmed:', wallet, transaction);
      self.emit('confirmation', {
        '@type': 'Confirmation',
        '@data': { transaction }
      });
    });

    this.account = await this.wallet.getAccount(this.settings.name);
    // TODO: also retrieve key for address
    // let key = this.master.derivePath('m/44/0/0/0/0');
    // TODO: label as identity address
    // this.address = await this.account.receiveAddress();

    this.status = 'loaded';
    this.emit('ready');

    return this;
  }

  /**
   * Start the wallet, including listening for transactions.
   */
  async start () {
    return this._load();
  }
}

module.exports = Wallet;
