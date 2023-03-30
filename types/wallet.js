'use strict';

// External Dependencies
const BN = require('bn.js');
const EC = require('elliptic').ec;
const merge = require('lodash.merge');
const payments = require('bitcoinjs-lib/src/payments');

// Mnemonics
const ecc = require('tiny-secp256k1');
const BIP32 = require('bip32').default;
const bip32 = new BIP32(ecc);
const bip39 = require('bip39');

// Types
const Key = require('./key');
const Actor = require('./actor');
const Collection = require('./collection');
// const Consensus = require('./consensus');
// const Channel = require('./channel');
const Hash256 = require('./hash256');
const Service = require('./service');
const Secret = require('./secret');
const State = require('./state');

/**
 * Manage keys and track their balances.
 * @property {String} id Unique identifier for this {@link Wallet}.
 * @type {Object}
 */
class Wallet extends Service {
  /**
   * Create an instance of a {@link Wallet}.
   * @param  {Object} [settings={}] Configure the wallet.
   * @param  {Number} [settings.verbosity=2] One of: 0 (none), 1 (error), 2 (warning), 3 (notice), 4 (debug), 5 (audit)
   * @param  {Object} [settings.key] Key to restore from.
   * @param  {String} [settings.key.seed] Mnemonic seed for a restored wallet.
   * @return {Wallet} Instance of the wallet.
   */
  constructor (settings = {}) {
    super(settings);

    // Create a Marshalling object
    this.marshall = {
      agents: [],
      collections: {
        transactions: null, // not yet loaded, seek for Buffer,
        orders: null
      }
    };

    this.settings = merge({
      name: 'primary',
      network: 'regtest',
      language: 'english',
      locktime: 144,
      decimals: 8,
      shardsize: 4,
      verbosity: 2,
      witness: true,
      key: null,
      version: 1
    }, settings);

    // bcoin.set(this.settings.network);

    this.database = null;
    /* this.database = new WalletDB({
      network: 'regtest'
    }); */

    this.account = null;
    this.manager = null;
    this.wallet = null;
    this.master = null;
    this.ring = null;
    this.seed = null;

    // TODO: enable wordlist translations
    // this.words = Mnemonic.getWordlist(this.settings.language).words;
    this.mnemonic = null;
    this.index = 0;

    // Storage
    this.accounts = new Collection();
    this.addresses = new Collection();
    this.keys = new Collection();
    this.coins = new Collection();
    this.transactions = new Collection();
    this.txids = new Collection();
    this.outputs = new Collection();

    // Encrypted Storage
    this.secrets = new Collection({
      methods: {
        create: this._prepareSecret.bind(this)
      }
    });

    // Internals
    this.ec = new EC('secp256k1');
    this.key = new Key(this.settings.key);
    this.entity = new Actor(this.settings);
    // this.consensus = new Consensus();

    // Internal State
    this._state = merge(this._state, {
      actors: {},
      asset: this.settings.asset || null,
      balances: {
        confirmed: 0,
        unconfirmed: 0
      },
      content: {
        balances: {
          spendable: 0
        },
        keys: {},
        transactions: {},
        utxos: []
      },
      labels: [],
      space: {}, // tracks addresses in shard
      keys: {},
      services: {},
      status: 'PAUSED',
      transactions: {},
      orders: {},
      outputs: {}
    });

    // Cleanup log output
    // TODO: remove these
    Object.defineProperty(this, 'database', { enumerable: false });
    Object.defineProperty(this, 'accounts', { enumerable: false });
    Object.defineProperty(this, 'addresses', { enumerable: false });
    Object.defineProperty(this, 'utxos', { enumerable: false });
    Object.defineProperty(this, 'keys', { enumerable: false });
    Object.defineProperty(this, 'outputs', { enumerable: false });
    Object.defineProperty(this, 'secrets', { enumerable: false });
    Object.defineProperty(this, 'swarm', { enumerable: false });
    Object.defineProperty(this, 'transactions', { enumerable: false });
    Object.defineProperty(this, 'wallet', { enumerable: false });

    return this;
  }

  get balance () {
    return this.get('/balances/confirmed');
  }

  get orders () {
    return this.get('/orders');
  }

  get version () {
    return this.settings.version;
  }

  /**
   * Create a new seed phrase.
   * @param {String} passphrase BIP 39 passphrase for key derivation.
   * @returns {FabricSeed} The seed object.
   */
  static createSeed (passphrase = '') {
    const mnemonic = bip39.generateMnemonic(256);
    const interim = bip39.mnemonicToSeedSync(mnemonic, passphrase);
    const master = bip32.fromSeed(interim);

    return {
      phrase: mnemonic.toString(),
      master: master.privateKey.toString('hex'),
      xprv: master.toBase58()
    };
  }

  /**
   * Create a new {@link Wallet} from a seed object.
   * @param {FabricSeed} seed Fabric seed.
   * @returns {Wallet} Instance of the wallet.
   */
  static fromSeed (seed) {
    return new Wallet({
      key: {
        seed: seed.phrase
      }
    });
  }

  derive (path = `m/7777'/7777'/0'/0/0`) {
    return this.key.master.derivePath(path);
  }

  export () {
    return {
      type: 'FabricWallet',
      object: {
        // TODO: export this.logs
        // TODO: reduce to C mem equivalent
        logs: [
          { method: 'genesis', params: [JSON.stringify({ id: this.id })] },
          {
            method: 'transaction',
            params: [
              JSON.stringify({
                changes: [
                  { method: 'replace', path: '/status', value: 'PAUSED' }
                ]
              }),
              1 // Version
            ]
          }
        ],
        master: {
          private: this.key.master.privateKey.toString('hex'),
          public: this.key.master.publicKey.toString('hex')
        },
        seed: this.key.seed,
        xprv: this.key.master.toBase58()
      },
      version: this.version
    };
  }

  /**
   * Import a key to the wallet.
   * @param {Object} keypair Keypair.
   * @param {Buffer} keypair.public Public key.
   * @param {Buffer} [keypair.private] Private key.
   * @returns {Wallet} Instance of the Wallet.
   */
  loadKey (keypair, labels = []) {
    if (!keypair) throw new Error('You must provide a keypair.');
    if (!keypair.public) throw new Error('The keypair must have a "public" property.');
    if (!(keypair.public instanceof Buffer)) throw new Error('The "public" property must be of type Buffer.');

    const id = { public: keypair.public.toString('hex') };
    const actor = new Actor(id);

    // Addresses
    // P2PKH: Pay to Public Key Hash
    const p2pkh = payments.p2pkh({
      pubkey: keypair.public
    });

    // P2WPKH: Pay to Witness Public Key Hash
    const p2wpkh = payments.p2wpkh({
      pubkey: keypair.public
    });

    // P2TR: Pay to Tap Root
    // const p2t2 = ...

    // TODO: new Key() here, then use key.export()
    const key = {
      addresses: {
        p2pkh: p2pkh.address,
        p2wpkh: p2wpkh.address
      },
      labels: labels.concat(['p2pkh', 'p2wpkh']),
      private: (keypair.private) ? keypair.private.toString('hex') : undefined,
      public: keypair.public.toString('hex')
    };

    this._state.content.keys[actor.id] = key;
    this._state.labels = this._state.labels.concat(key.labels);

    this.commit();

    return this;
  }

  loadTransaction (transaction, labels = []) {
    if (!transaction) throw new Error('You must provide a transaction.');
    if (!transaction.id) throw new Error('The transaction must have a "id" property.');

    const actor = new Actor(transaction);

    this._state.content.transactions[transaction.id] = actor.toObject();

    if (transaction.spendable) {
      this._state.content.utxos.push({
        type: 'UnspentTransactionOutput',
        object: {
          id: transaction.id
        }
      });
    }

    this.commit();

    return this;
  }

  /**
   * Start the wallet, including listening for transactions.
   */
  start () {
    this.status = 'STARTING';
    this._load();
    this.status = 'STARTED';
  }

  trust (emitter) {
    const wallet = this;
    const listener = emitter.on('message', this._handleGenericMessage.bind(this));

    // Keep track of all event handlers
    this.marshall.agents.push(listener);

    emitter.on('transaction', async function trustedHandler (msg) {
      if (this.settings.verbosity >= 5) console.log('[FABRIC:WALLET]', 'Received transaction from trusted event emitter:', msg);
      await wallet.addTransactionToWallet(msg);
    });

    return this;
  }

  _handleGenericMessage (msg) {
    if (this.settings.verbosity >= 5) console.log('[FABRIC:WALLET]', 'Received message from trusted event emitter:', msg);
    if (this.settings.verbosity >= 5) console.log('[AUDIT]', '[FABRIC:WALLET]', 'Trusted emitter gave us:', msg);

    // TODO: bind @fabric/core/services/bitcoin to addresses on wallet...
    // ATTN: Eric

    // TODO: update channels
    // TODO: parse as {@link Message}
    // TODO: store in this.messages
    switch (msg['@type']) {
      case 'ServiceMessage':
        return this._processServiceMessage(msg['@data']);
      default:
        return console.warn('[FABRIC:WALLET]', `Unhandled message type: ${msg['@type']}`);
    }
  }

  /**
   * Initialize the wallet, including keys and addresses.
   * @param {Object} settings Settings to load.
   */
  _load (settings = {}) {
    if (this.wallet) return this;

    this.keypair = this.ec.keyFromPrivate(this.key.master.privateKey);
    this.wallet = {
      keypair: this.keypair
    };

    this.loadKey({
      private: this.key.master.privateKey,
      public: this.key.master.publicKey
    });

    /* for (let i = 0; i < 20; i++) {
      const account = this.derive(`m/44'/0'/0'/0/${i}`);
      this.loadKey({
        private: account.privateKey.toString('hex'),
        public: account.publicKey.toString('hex')
      });
    } */

    return this;
  }

  async _processServiceMessage (msg) {
    switch (msg['@type']) {
      case 'BitcoinBlock':
        this.processBitcoinBlock(msg['@data']);
        break;
      case 'BitcoinTransaction':
        // TODO: validate destination is this wallet
        this.addTransactionToWallet(msg['@data']);
        break;
      default:
        return console.warn('[FABRIC:WALLET]', `Unhandled message type: ${msg['@type']}`);
    }
  }

  async processBitcoinBlock (block) {
    if (this.settings.verbosity >= 4) console.log('[FABRIC:WALLET]', 'Processing block:', block);
    if (!block.block) return 0;
    for (let i = 0; i < block.block.hashes.length; i++) {
      const txid = block.block.hashes[i].toString('hex');
      // ATTN: Eric
      // TODO: process transaction
      console.log('found txid in block:', txid);
    }
  }

  async _attachTXID (txid) {
    // TODO: check that `txid` is a proper TXID
    let txp = await this.txids.create(txid);
    if (this.settings.verbosity >= 5) console.log('[AUDIT]', `Attached TXID ${txid} to Wallet ID ${this.id}, result:`, txp);
    return txp;
  }

  async _handleFabricTransaction (tx) {
    console.log('[FABRIC:WALLET]', 'Handling Fabric Transaction:', tx);
  }

  async addTransactionToWallet (transaction) {
    if (this.settings.verbosity >= 5) console.log('[AUDIT]', '[FABRIC:WALLET]', 'Adding transaction to Wallet:', transaction);
    let entity = new Actor(transaction);
    if (!transaction.spent) transaction.spent = false;
    if (!transaction.outputs) transaction.outputs = [];
    this._state.transactions.push(transaction);
    await this.commit();
    if (this.settings.verbosity >= 5) console.log('[FABRIC:WALLET]', 'Wallet transactions now:', this._state.transactions);

    for (let i = 0; i < transaction.outputs.length; i++) {
      let output = transaction.outputs[i].toJSON();
      let address = await this._findAddressInCurrentShard(output.address);

      // TODO: test these outputs
      // console.log('output to parse:', output);
      // console.log('address found:', address);

      if (address) {
        this._state.outputs.push(output);
        this._state.utxos.push(new Coin(transaction.outputs[i]));
        this.emit('payment', {
          '@type': 'WalletPayment',
          '@data': {
            id: entity.id,
            transaction: transaction
          }
        });
      }

      /* switch (output.type) {
        default:
          console.warn('[FABRIC:WALLET]', 'Unhandled output type:', output.type);
          break;
        case 'pubkeyhash':
          let address = await this._findAddressInCurrentShard(output.address);
          break;
      } */
    }

    await this.commit();
  }

  async _findAddressInCurrentShard (address) {
    for (let i = 0; i < this.shard.length; i++) {
      let slice = this.shard[i];
      if (slice.string === address) return slice;
    }
    return null;
  }

  async _createMultisigAddress (m, n, keys) {
    let result = null;

    // Check for required fields
    if (!m) throw new Error('Parameter 0 required: m');
    if (!n) throw new Error('Parameter 1 required: n');
    if (!keys || !keys.length) throw new Error('Parameter 2 required: keys');

    try {
      // Compose the address
      const pubkeys = keys.map(key => Buffer.from(key, 'hex'));
      const payment = payments.p2wsh({
        redeem: payments.p2ms({ m, pubkeys })
      });

      // Assign to output
      result = payment.address;
    } catch (exception) {
      console.error('[FABRIC:WALLET]', 'Could not create multisig address:', exception);
    }

    return result;
  }

  async _spendToAddress (amount, address) {
    const mtx = new MTX();
    const change = await this.wallet.receiveAddress();
    const coins = await this.wallet.getCoins();

    this.emit('log', `Amount to send: ${amount}`);

    mtx.addOutput({
      address: recipient,
      value: parseInt(amount)
    });

    await mtx.fund(coins, {
      rate: 10,
      changeAddress: change
    });

    const sigs = mtx.sign(this.ring);
    const tx = mtx.toTX();
    const valid = tx.check(mtx.view);

    return tx;
  }

  async _getUnspentOutput (amount) {
    if (!this._state.utxos.length) throw new Error('No available funds.');
    // TODO: use coin selection
    const mtx = new MTX();

    // Send 10,000 satoshis to ourself.
    mtx.addOutput({
      address: this.ring.getAddress(),
      value: amount
    });

    await mtx.fund(this._state.utxos, {
      // Use a rate of 10,000 satoshis per kb.
      // With the `fullnode` object, you can
      // use the fee estimator for this instead
      // of blindly guessing.
      rate: 10000,
      // Send the change back to ourselves.
      changeAddress: this.ring.getAddress()
    });
    // TODO: use the MTX to select outputs

    return this._state.utxos[0];
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

  /**
   * Generate a {@link BitcoinAddress} for the supplied {@link BitcoinScript}.
   * @param {BitcoinScript} redeemScript 
   */
  getAddressFromRedeemScript (redeemScript) {
    if (!redeemScript) return null;
    return Address.fromScripthash(redeemScript.hash160());
  }

  /**
   * Create a priced order.
   * @param {Object} order
   * @param {Object} order.asset
   * @param {Object} order.amount
   */
  async createPricedOrder (order) {
    if (!order.asset) throw new Error('Order parameter "asset" is required.');
    if (!order.amount) throw new Error('Order parameter "amount" is required.');

    let leftover = order.amount % (10 * this.settings.decimals);
    let parts = order.amount / (10 * this.settings.decimals);

    let partials = [];
    // TODO: remove short-circuit
    let cb = await this._generateFakeCoinbase(order.amount);
    let mtx = new MTX();
    let script = new Script();

    let secret = await this.generateSecret();
    let image = Buffer.from(secret.hash);

    console.log('secret generated:', secret);
    console.log('image of secret:', image);

    let refund = await this.ring.getPublicKey();
    console.log('refund:', refund);

    script.pushSym('OP_IF');
    script.pushSym('OP_SHA256');
    script.pushData(image);
    script.pushSym('OP_EQUALVERIFY');
    script.pushData(order.counterparty);
    script.pushSym('OP_ELSE');
    script.pushInt(this.settings.locktime);
    script.pushSym('OP_CHECKSEQUENCEVERIFY');
    script.pushSym('OP_DROP');
    script.pushData(refund);
    script.pushSym('OP_ENDIF');
    script.pushSym('OP_CHECKSIG');
    script.compile();

    // TODO: complete order construction
    for (let i = 0; i < parts; i++) {
      // TODO: should be split parts
      partials.push(script);
    }

    let entity = new Actor({
      comment: 'List of transactions to validate.',
      orders: partials,
      transactions: partials
    });

    return entity;
  }

  async createHTLC (contract) {
    // if (!contract.asset) throw new Error('Contract parameter "asset" is required.');
    if (!contract.amount) throw new Error('Contract parameter "amount" is required.');
    // TODO: remove short-circuit
    if (!contract.counterparty) {
      // TODO: replace this with a randomly-generated input
      // sha256
      // -> pubkey
      contract.counterparty = await this.ring.getPublicKey();
      console.log('contract counterparty artificially generated:', contract.counterparty);
    }

    let leftover = contract.amount % this.settings.decimals;
    let parts = contract.amount / this.settings.decimals;

    let partials = [];
    // TODO: remove short-circuit
    let cb = await this._generateFakeCoinbase(contract.amount);
    let mtx = new MTX();
    let script = new Script();

    let secret = await this.generateSecret();
    let image = Buffer.from(secret.hash);

    console.log('secret generated:', secret);
    console.log('image of secret:', image);

    let refund = await this.ring.getPublicKey();
    console.log('refund:', refund);

    script.pushSym('OP_IF');
    script.pushSym('OP_SHA256');
    script.pushData(image);
    script.pushSym('OP_EQUALVERIFY');
    script.pushData(contract.counterparty);
    script.pushSym('OP_ELSE');
    script.pushInt(this.settings.locktime);
    script.pushSym('OP_CHECKSEQUENCEVERIFY');
    script.pushSym('OP_DROP');
    script.pushData(refund);
    script.pushSym('OP_ENDIF');
    script.pushSym('OP_CHECKSIG');
    script.compile();

    // TODO: complete order construction
    for (let i = 0; i < parts; i++) {
      // TODO: should be split parts
      partials.push(script);
    }

    console.log('parts:', partials);
    console.log('leftover:', leftover);

    let entity = new Actor({
      comment: 'List of transactions to validate.',
      orders: partials,
      transactions: partials,
      type: 'BitcoinTransaction'
    });

    return entity;
  }

  async generateSecret () {
    const secret = new Secret();
    const entity = await this.secrets.create({
      hash: secret.hash
    });
    console.log('created secret:', entity);
    return entity;
  }

  async generateSignedTransactionTo (address, amount) {
    if (!address) throw new Error(`Parameter "address" is required.`);
    if (!amount) throw new Error(`Parameter "amount" is required.`);

    let bn = new BN(amount + '', 10);
    // TODO: labeled keypairs
    let clean = await this.generateCleanKeyPair();
    let change = await this.generateCleanKeyPair();

    let mtx = new MTX();
    let cb = await this._generateFakeCoinbase(amount);

    mtx.addOutput({
      address: address,
      amount: amount
    });

    await mtx.fund(this._state.utxos, {
      rate: 10000, // TODO: fee calculation
      changeAddress: change.address
    });

    mtx.sign(this.ring);
    // mtx.signInput(0, this.ring);

    let tx = mtx.toTX();
    let output = Coin.fromTX(mtx, 0, -1);
    let raw = mtx.toRaw();
    let hash = Hash256.digest(raw.toString('hex'));

    return {
      type: 'BitcoinTransaction',
      data: {
        tx: tx,
        output: output,
        raw: raw.toString('hex'),
        hash: hash
      }
    };
  }

  async generateOrderRootTo (pubkey, amount) {
    if (!pubkey) throw new Error(`Parameter "pubkey" is required.`);
    if (!amount) throw new Error(`Parameter "amount" is required.`);

    let bn = new BN(amount + '', 10);
    // TODO: labeled keypairs
    let clean = await this.generateCleanKeyPair();
    let change = await this.generateCleanKeyPair();

    let mtx = new MTX();
    let cb = await this._generateFakeCoinbase(amount);

    mtx.addOutput({
      address: address,
      amount: amount
    });

    await mtx.fund(this._state.utxos, {
      rate: 10000, // TODO: fee calculation
      changeAddress: change.address
    });

    mtx.sign(this.ring);
    // mtx.signInput(0, this.ring);

    let tx = mtx.toTX();
    let output = null;

    try {
      output = Coin.fromTX(mtx, 0, -1);
    } catch (exception) {
      console.error('[FABRIC:WALLET]', 'Could not generate output:', exception);
    }

    let raw = mtx.toRaw();
    let hash = Hash256.digest(raw.toString('hex'));

    return {
      type: 'BitcoinTransaction',
      data: {
        tx: tx,
        output: output,
        raw: raw.toString('hex'),
        hash: hash
      }
    };
  }

  addInputForCrowdfund (coin, inputIndex, mtx, keyring, hashType) {
    let sampleCoin = coin instanceof Coin ? coin : Coin.fromJSON(coin);
    if (!hashType) hashType = Script.hashType.ANYONECANPAY | Script.hashType.ALL;

    mtx.addCoin(sampleCoin);
    mtx.scriptInput(inputIndex, sampleCoin, keyring);
    mtx.signInput(inputIndex, sampleCoin, keyring, hashType);

    console.log('MTX after Input added (and signed):', mtx);

    // TODO: return a full object for Fabric
    return mtx;
  }

  balanceFromState (state) {
    if (!state.transactions) throw new Error('State does not provide a `transactions` property.');
    if (!state.transactions.length) return 0;
    return state.transactions.reduce((acc, obj, i) => {
      if (!acc.value) acc.value = 0;
      acc.value += obj.value;
    });
  }

  getFeeForInput (coin, address, keyring, rate) {
    let fundingTarget = 100000000; // 1 BTC (arbitrary for purposes of this function)
    let testMTX = new MTX();

    // TODO: restore swap code, abstract input types
    // this.addInputForCrowdfund(coin, 0, testMTX, this.keyring);

    return testMTX.getMinFee(null, rate);
  }

  async _createAccount (data) {
    // console.log('wallet creating account with data:', data);
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

  async _splitCoinbase (funderKeyring, coin, targetAmount, txRate) {
    // loop through each coinbase coin to split
    let coins = [];

    const mtx = new MTX();

    assert(coin.value > targetAmount, 'coin value is not enough!');

    // creating a transaction that will have an output equal to what we want to fund
    mtx.addOutput({
      address: funderKeyring.getAddress(),
      value: targetAmount
    });

    // the fund method will automatically split
    // the remaining funds to the change address
    // Note that in a real application these splitting transactions will also
    // have to be broadcast to the network
    await mtx.fund([coin], {
      rate: txRate,
      // send change back to an address belonging to the funder
      changeAddress: funderKeyring.getAddress()
    }).then(() => {
      // sign the mtx to finalize split
      mtx.sign(funderKeyring);
      assert(mtx.verify());

      const tx = mtx.toTX();
      assert(tx.verify(mtx.view));

      const outputs = tx.outputs;

      // get coins from tx
      outputs.forEach((outputs, index) => {
        coins.push(Coin.fromTX(tx, index, -1));
      });
    }).catch(e => console.log('There was an error: ', e));

    return coins;
  }

  async composeCrowdfund (coins) {
    const funderCoins = {};
    // Loop through each coinbase
    for (let index in coins) {
      const coinbase = coins[index][0];
      // estimate fee for each coin (assuming their split coins will use same tx type)
      const estimatedFee = getFeeForInput(coinbase, fundeeAddress, funders[index], txRate);
      const targetPlusFee = amountToFund + estimatedFee;

      // split the coinbase with targetAmount plus estimated fee
      const splitCoins = await Utils.splitCoinbase(funders[index], coinbase, targetPlusFee, txRate);

      // add to funderCoins object with returned coins from splitCoinbase being value,
      // and index being the key
      funderCoins[index] = splitCoins;
    }
    // ... we'll keep filling out the rest of the code here
  }

  async _addOutputToSpendables (coin) {
    this._state.utxos.push(coin);
    return this;
  }

  async getUnusedAddress () {
    let clean = await this.wallet.receiveAddress();
    this.emit('log', `unused address: ${clean}`);
    return clean;
  }

  async getUnspentTransactionOutputs () {
    return this._state.transactions.filter(x => {
      return (x.spent === 0);
    });
  }

  async _generateFakeCoinbase (amount = 1) {
    // TODO: use Satoshis for all calculations
    let num = new BN(amount, 10);

    // TODO: remove all fake coinbases
    // TODO: remove all short-circuits
    // fake coinbase
    let cb = new MTX();
    let clean = await this.generateCleanKeyPair();

    // Coinbase Input
    cb.addInput({
      prevout: new Outpoint(),
      script: new Script(),
      sequence: 0xffffffff
    });

    // Add Output to pay ourselves
    cb.addOutput({
      address: clean.address,
      value: 5000000000
    });

    // TODO: remove short-circuit
    let coin = Coin.fromTX(cb, 0, -1);
    let tx = cb.toTX();

    // TODO: remove entirely, test short-circuit removal
    // await this._addOutputToSpendables(coin);

    return {
      type: 'BitcoinTransactionOutput',
      data: {
        tx: cb,
        coin: coin
      }
    };
  }

  async _getFreeCoinbase (amount = 1) {
    let num = new BN(amount, 10);
    let max = new BN('5000000000000', 10); // upper limit per coinbase
    let hun = new BN('100000000', 10); // one hundred million
    let value = num.mul(hun); // amount in Satoshis

    if (value.gt(max)) {
      console.warn('Value (in satoshis) higher than max:', value.toString(10), `(max was ${max.toString(10)})`);
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
    this._state.utxos.push(coin);

    // console.log('coinbase:', coinbase);

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

    mtx.addCoin(this._state.utxos[0]);
    mtx.scriptInput(index, this._state.utxos[0], this.keyring);
    mtx.signInput(index, this._state.utxos[0], this.keyring, hashType);

    await this.commit();

    return {
      tx: mtx.toTX(),
      mtx: mtx
    };
  }

  async _createFromFreshSeed (passphrase = '') {
    console.log('creating fresh seed with passphrase:', passphrase);
    const seed = await this._createSeed(passphrase);
    return seed;
  }

  async _createSeed (passphrase = '') {
    const mnemonic = bip39.generateMnemonic(256);
    const interim = bip39.mnemonicToSeedSync(mnemonic, passphrase);
    const master = bip32.fromSeed(interim);

    return {
      phrase: mnemonic.toString(),
      master: master.privateKey.toString('hex'),
      xprv: master.toBase58()
    };
  }

  async _importSeed (seed) {
    let mnemonic = new Mnemonic(seed);
    return this._loadSeed(mnemonic.toString());
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
    data.pushSym('OP_ELSE');
    data.pushInt(config.locktime);
    data.pushSym('OP_CHECKSEQUENCEVERIFY');
    data.pushSym('OP_DROP');
    data.pushData(Buffer.from(clean.public));
    data.pushSym('OP_ENDIF');
    data.pushSym('OP_CHECKSIG');
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

    if (this.settings.verbosity >= 5) console.log('[AUDIT]', 'getting bond address, clean:', clean);

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

    console.log('funding transaction with coins:', this._state.utxos);

    // INSERT 1 Output
    mtx.addOutput({
      address: target,
      value: amount
    });

    out = await mtx.fund(this._state.utxos, {
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

  async signInput (mtx, index, redeemScript, value, privateKey, sigHashType, version_or_flags) {
    return mtx.signature(
      index,
      redeemScript,
      value,
      privateKey,
      sigHashType,
      version_or_flags
    );
  }

  async getRedeemTX (address, fee, fundingTX, fundingTXoutput, redeemScript, inputScript, locktime, privateKey) {
    // Create a mutable transaction object
    let redeemTX = new MTX();

    // Get the output we want to spend (coins sent to the P2SH address) 
    let coin = Coin.fromTX(fundingTX, fundingTXoutput, -1);

    // Add that coin as an input to our transaction
    redeemTX.addCoin(coin);

    // Redeem the input coin with either the swap or refund script
    redeemTX.inputs[0].script = inputScript;

    // Create the output back to our primary wallet
    redeemTX.addOutput({
      address: address,
      value: coin.value - fee
    });

    // If this was a refund redemption we need to set the sequence
    // Sequence is the relative timelock value applied to individual inputs
    if (locktime) {
      redeemTX.setSequence(0, locktime, this.CSV_seconds);
    } else {
      redeemTX.inputs[0].sequence = 0xffffffff;
    }

    // Set SIGHASH and replay protection bits
    let version_or_flags = 0;
    let type = null;

    if (this.libName === 'bcash') {
      version_or_flags = this.flags;
      type = Script.hashType.SIGHASH_FORKID | Script.hashType.ALL;
    }

    // Create the signature authorizing the input script to spend the coin
    let sig = await this.signInput(
      redeemTX,
      0,
      redeemScript,
      coin.value,
      privateKey,
      type,
      version_or_flags
    );

    // Insert the signature into the input script where we had a `0` placeholder
    inputScript.setData(0, sig);

    // Finish up and return
    inputScript.compile();

    return redeemTX;
  }

  /**
   * Generate {@link Script} for claiming a {@link Swap}.
   * @param {*} redeemScript 
   * @param {*} secret 
   */
  async _getSwapInputScript (redeemScript, secret) {
    let inputSwap = new Script();

    inputSwap.pushInt(0); // signature placeholder
    inputSwap.pushData(secret);
    inputSwap.pushInt(1); // <true>
    inputSwap.pushData(redeemScript.toRaw()); // P2SH
    inputSwap.compile();

    return inputSwap;
  }

  /**
   * Generate {@link Script} for reclaiming funds commited to a {@link Swap}.
   * @param {*} redeemScript 
   */
  async _getRefundInputScript (redeemScript) {
    let inputRefund = new Script();

    inputRefund.pushInt(0); // signature placeholder
    inputRefund.pushInt(0); // <false>
    inputRefund.pushData(redeemScript.toRaw()); // P2SH
    inputRefund.compile();

    return inputRefund;
  }

  async _createOrderForPubkey (pubkey) {
    this.emit('log', `creating ORDER transaction with pubkey: ${pubkey}`);

    let mtx = new MTX();
    let data = new Script();
    let clean = await this.generateCleanKeyPair();

    let secret = 'fixed secret :)';
    let sechash = require('crypto').createHash('sha256').update(secret).digest('hex');

    this.emit('log', `SECRET CREATED: ${secret}`);
    this.emit('log', `SECHASH: ${sechash}`);

    data.pushSym('OP_IF');
    data.pushSym('OP_SHA256');
    data.pushData(Buffer.from(sechash));
    data.pushSym('OP_EQUALVERIFY');
    data.pushData(Buffer.from(pubkey));
    data.pushSym('OP_ELSE');
    data.pushInt(86400);
    data.pushSym('OP_CHECKSEQUENCEVERIFY');
    data.pushSym('OP_DROP');
    data.pushData(Buffer.from(clean.public));
    data.pushSym('OP_ENDIF');
    data.pushSym('OP_CHECKSIG');
    data.compile();

    this.emit('log', `[AUDIT] address data: ${data}`);
    let segwitAddress = await this.getAddressForScript(data);
    let address = await this.getAddressFromRedeemScript(data);

    this.emit('log', `[AUDIT] segwit address: ${segwitAddress}`);
    this.emit('log', `[AUDIT] normal address: ${address}`);

    mtx.addOutput({
      address: address,
      value: 25000000
    });

    // ensure a coin exists...
    // NOTE: this is tracked in this._state.coins
    // and thus does not need to be cast to a variable...
    let coinbase = await this._getFreeCoinbase();

    // TODO: load available outputs from wallet
    let out = await mtx.fund(this._state.utxos, {
      // TODO: fee estimation
      rate: 10000,
      changeAddress: this.ring.getAddress()
    });

    let tx = mtx.toTX();
    let sig = await mtx.sign(this.ring);

    this.emit('log', 'transaction:', tx);
    this.emit('log', 'sig:', sig);

    return {
      tx: tx,
      mtx: mtx,
      sig: sig
    };
  }

  async _scanBlockForTransactions (block) {
    console.log('[AUDIT]', 'Scanning block for transactions:', block);
    let found = [];
  }

  async _scanChainForTransactions (chain) {
    console.log('[AUDIT]', 'Scanning chain for transactions:', chain);

    let transactions = [];

    for (let i = 0; i < chain.blocks.length; i++) {
      transactions.concat(await this._scanBlockForTransactions(chain.blocks[i]));
    }

    return transactions;
  }

  async _createChannel (channel) {
    let element = new Channel(channel);
    return element;
  }

  async _allocateSlot () {
    for (let i = 0; i < Object.keys(this._state.space).length; i++) {
      let slot = this._state.space[Object.keys(this._state.space)[i]];
      if (!slot.allocation) {
        this._state.space[Object.keys(this._state.space)[i]].allocation = new Secret();
        return this._state.space[Object.keys(this._state.space)[i]];
      }
    }
  }

  async getFirstAddressSlice (size = 256) {
    await this._load();

    // aggregate results for return
    let slice = [];

    if (this.settings.verbosity >= 5) console.log('[AUDIT]', 'generating {@link Space} with settings:', this.settings);

    // iterate over length of shard, aggregate addresses
    for (let i = 0; i < size; i++) {
      // let addr = this.account.deriveReceive(i).getAddress('string', this.settings.network);
      const addr = this.key.deriveAccountReceive(i);
      let address = await this.addresses.create({
        string: addr,
        label: `shared address ${i} for wallet ${this.id}`,
        allocation: null
      });

      // TODO: restore address tracking in state
      // this._state.space[addr] = address;

      slice.push(address);
    }

    return slice;
  }

  /**
   * Create a public key from a string.
   * @param {String} input Hex-encoded string to create key from.
   */
  publicKeyFromString (input) {
    const buf = Buffer.from(input, 'hex');
    const key = new Key({ public: buf });
    return key.pubkey;
  }

  async generateCleanKeyPair () {
    if (this.status !== 'loaded') await this._load();

    const pair = this.key.deriveKeyPair(++this.index);
    const keypair = {
      index: this.index,
      public: pair.public,
      address: payments.p2pkh({
        pubkey: Buffer.from(pair.public, 'hex')
      })
      // keyring: keyring
    };

    return keypair;
  }

  async _handleWalletBalance (balance) {
    await this._PUT('/balance', balance);
    const depositor = new State({ name: this.settings.name || 'default' });
    await this._PUT(`/depositors/${depositor.id}/balance`, balance);
    this.emit('balance', balance);
  }

  async _registerAccount (obj) {
    if (!obj.name) throw new Error('Account must have "name" property.');
    if (!this.database.db.loaded) {
      await this.database.open();
    }

    const account = await this.accounts.create(obj);
    if (this.settings.verbosity >= 4) console.log('registering account, created:', account);

    if (this.manager) {
      this.manager.on('tx', this._handleWalletTransaction.bind(this));
      this.manager.on('balance', this._handleWalletBalance.bind(this));
      // TODO: check on above events, should be more like...
      // this.manager.on('changes', this._handleWalletBalance.bind(this));
    }

    return account;
  }

  async _prepareSecret (state) {
    const entity = new Actor(state);
    return entity;
  }

  async _loadSeed (seed) {
    this.settings.key = { seed };
    await this._load();
    return this.seed;
  }

  async _unload () {
    return this.database.close();
  }
}

module.exports = Wallet;
