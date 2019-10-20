'use strict';

// External Dependencies
const BN = require('bn.js');

// Types
const EncryptedPromise = require('./promise');
const Transaction = require('./transaction');
const Collection = require('./collection');
const Entity = require('./entity');
const Service = require('./service');
const State = require('./state');

// Bcoin
const bcoin = require('bcoin/lib/bcoin-browser').set('regtest');

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

    // Create a Marshalling object
    this.marshall = {
      collections: {
        'transactions': null // not yet loaded, seek for Buffer
      }
    };

    this.settings = Object.assign({
      name: 'primary',
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

    // TODO: enable wordlist translations
    // this.words = Mnemonic.getWordlist(this.settings.language).words;
    this.mnemonic = null;
    this.index = 0;

    this.accounts = new Collection();
    this.addresses = new Collection();
    this.keys = new Collection();
    this.coins = new Collection();
    this.transactions = new Collection();
    this.entity = new Entity(this.settings);

    // Internal State
    this._state = {
      coins: [],
      keys: {}
    };

    // External State
    this.state = {
      asset: this.settings.asset || null,
      balances: {
        confirmed: 0,
        unconfirmed: 0
      },
      coins: [],
      keys: [],
      transactions: []
    };

    Object.defineProperty(this, 'database', { enumerable: false });
    Object.defineProperty(this, 'wallet', { enumerable: false });

    this.status = 'closed';

    return this;
  }

  get id () {
    return this.settings.id || this.entity.id;
  }

  get balance () {
    return this.get('/balances/confirmed');
  }

  get transactions () {
    return this.get('/transactions');
  }

  set transactions (val) {
    let state = {};

    for (let key in val) {
      if (key === 'id') {
        console.log('[AUDIT]', '');
      }

      state[key] = val[key];
    }

    this.marshall.collections.transactions = val;
  }

  /**
   * Returns a bech32 address for the provided {@link Script}.
   * @param {Script} script 
   */
  getAddressForScript (script) {
    // TODO: use Fabric.Script
    let p2wsh = script.forWitness();
    let address = p2wsh.getAddress().toBech32(this.settings.network);
    return address;
  }

  getAddressFromRedeemScript (redeemScript) {
    return Address.fromScripthash(redeemScript.hash160());
  }

  async _createAccount (data) {
    console.log('wallet creating account with data:', data);
    await this._load();
    let existing = await this.wallet.getAccount(data.name);
    if (existing) return existing;
    let account = await this.wallet.createAccount(data);
    return account;
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
    let num = new BN(amount, 10);
    let max = new BN('5000000000000', 10); // upper limit per coinbase
    let hun = new BN('100000000', 10); // one hundred million
    let value = num.mul(hun); // amount in Satoshis

    if (value.gt(max)) {
      value = max;
    }

    let v = value.toString(10);
    let w = parseInt(v);

    await this._load();

    const coins = {};
    const coinbase = new MTX();

    // INSERT 1 Input
    coinbase.addInput({
      prevout: new Outpoint(),
      script: new Script(),
      sequence: 0xffffffff
    });

    try {
      // INSERT 1 Output
      coinbase.addOutput({
        address: this._getDepositAddress(),
        value: w
      });
    } catch (E) {
      console.error('Could not add output:', E);
    }

    // TODO: wallet._getSpendableOutput()
    let coin = Coin.fromTX(coinbase, 0, -1);

    this._state.coins.push(coin);

    console.log('coins:', this._state.coins);
    
    return coinbase;
  }

  /**
   * Signs a transaction with the keyring.
   * @param {BcoinTX} tx 
   */
  async _sign (tx) {
    let signature = await tx.sign(this.keyring);
    console.log('signing tx:', tx);
    console.log('signing sig:', signature);
    return Object.assign({}, tx, { signature });
  }

  /**
   * Create a crowdfunding transaction.
   * @param {Object} fund 
   */
  async _createCrowdfund (fund = {}) {
    if (!fund.amount) return null;
    if (!fund.address) return null;

    let index = fund.index || 0;
    let hashType = Script.hashType.ANYONECANPAY | Script.hashType.ALL;

    mtx.addCoin(this._state.coins[0]);
    mtx.scriptInput(index, this._state.coins[0], this.keyring);
    mtx.signInput(index, this._state.coins[0], this.keyring, hashType);

    await this.commit();

    return {
      tx: mtx.toTX(),
      mtx: mtx
    };
  }

  async _createSeed() {
    let mnemonic = new Mnemonic({ bits: 256 });
    return { seed: mnemonic.toString() };
  }

  async _createIncentivizedTransaction (config) {
    console.log('creating incentivized transaction with config:', config);

    let mtx = new MTX();
    let data = new Script();
    let clean = await this.generateCleanKeyPair();

    data.pushSym('OP_IF');
    data.pushSym('OP_SHA256');
    data.pushData(Buffer.from(config.hash));
    data.pushSym('OP_EQUALVERIFY');
    data.pushData(Buffer.from(config.payee));
    data.pushSym('OP_CHECKSIG');
    data.pushSym('OP_ELSE');
    data.pushInt(config.locktime);
    data.pushSym('OP_CHECKSEQUENCEVERIFY');
    data.pushSym('OP_DROP');
    data.pushData(Buffer.from(clean.public));
    data.pushSym('OP_CHECKSIG');
    data.pushSym('OP_ENDIF');
    data.compile();

    console.log('address data:', data);
    let segwitAddress = await this.getAddressForScript(data);

    mtx.addOutput({
      address: segwitAddress,
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

  async getFirstAddressSlice (size = 256) {
    await this._load();

    // aggregate results for return
    let slice = [];

    // iterate over length of shard, aggregate addresses
    for (let i = 0; i < size; i++) {
      let addr = this.account.deriveReceive(i).getAddress('string');
      slice.push(await this.addresses.create({
        string: addr
      }));
    }

    return slice;
  }

  async generateCleanKeyPair () {
    if (this.status !== 'loaded') await this._load();

    this.index++;

    let key = this.master.derivePath(`m/44/0/0/0/${this.index}`);
    let keyring = bcoin.KeyRing.fromPrivate(key.privateKey);

    return {
      index: this.index,
      public: keyring.publicKey.toString('hex'),
      address: keyring.getAddress('string'),
      keyring: keyring
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
    let wallet = await this.wallet.createAccount({ name: obj.name });
    console.log('bcoin wallet account:', wallet);
    let actor = Object.assign({
      account: wallet
    }, obj);

    let account = await this.accounts.create(obj);

    if (this.manager) {
      this.manager.on('tx', this._handleWalletTransaction.bind(this));
      this.manager.on('balance', this._handleWalletBalance.bind(this));
    }

    return account;
  }

  async _loadSeed (seed) {
    this.settings.key = { seed };
    await this._load();
    return this.seed;
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
      this.seed = new EncryptedPromise({ data: this.settings.key.seed });
    } else {
      this.master = bcoin.hd.generate(this.settings.network);
    }

    try {
      this.wallet = await this.database.create({
        network: this.settings.network,
        master: this.master
      });
    } catch (E) {
      console.error('Could not create wallet:', E);
    }

    // Setup Ring
    this.ring = new bcoin.KeyRing(this.master, this.settings.network);
    this.ring.witness = this.settings.witness; // designates witness

    console.log('keyring:', this.ring);
    console.log('address from keyring:', this.ring.getAddress().toString());

    this.account = await this.wallet.getAccount('default');

    // Let's call it a shard!
    this.shard = await this.getFirstAddressSlice();

    // TODO: also retrieve key for address
    // let key = this.master.derivePath('m/44/0/0/0/0');
    // TODO: label as identity address
    // this.address = await this.account.receiveAddress();
    // TODO: notify downstream of short-circuit removal

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
