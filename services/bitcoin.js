'use strict';

const {
  BITCOIN_GENESIS,
  FABRIC_USER_AGENT
} = require('../constants');

const OP_TRACE = require('../contracts/trace');

// External Dependencies
const jayson = require('jayson/lib/client');
const monitor = require('fast-json-patch');

// crypto support libraries
// TODO: replace with  `secp256k1`
const ECPairFactory = require('ecpair').default;
const ecc = require('tiny-secp256k1');
const bip65 = require('bip65');
const bip68 = require('bip68');
const ECPair = ECPairFactory(ecc);
const bitcoin = require('bitcoinjs-lib');

// Services
const ZMQ = require('../services/zmq');

// Types
const Actor = require('../types/actor');
const Collection = require('../types/collection');
const Entity = require('../types/entity');
const Service = require('../types/service');
const State = require('../types/state');
const Wallet = require('../types/wallet');

// Special Types (internal to Bitcoin)
const BitcoinBlock = require('../types/bitcoin/block');
const BitcoinTransaction = require('../types/bitcoin/transaction');

/**
 * Manages interaction with the Bitcoin network.
 * @augments Service
 */
class Bitcoin extends Service {
  /**
   * Creates an instance of the Bitcoin service.
   * @param {Object} [settings] Map of configuration options for the Bitcoin service.
   * @param {String} [settings.network] One of `regtest`, `testnet`, or `mainnet`.
   * @param {Array} [settings.nodes] List of address:port pairs to trust.
   * @param {Array} [settings.seeds] Bitcoin peers to request chain from (address:port).
   * @param {Boolean} [settings.fullnode] Run a full node.
   */
  constructor (settings = {}) {
    super(settings);

    // Internal State
    this.state = {
      blocks: {}
    };

    // Local Settings
    this.settings = Object.assign({
      name: '@services/bitcoin',
      mode: 'rpc',
      genesis: BITCOIN_GENESIS,
      network: 'regtest',
      path: './stores/bitcoin',
      mining: false,
      listen: false,
      fullnode: false,
      spv: {
        port: 18332
      },
      zmq: {
        host: 'localhost',
        port: 29000
      },
      nodes: ['127.0.0.1'],
      seeds: ['127.0.0.1'],
      servers: [],
      targets: [],
      peers: [],
      port: 18444,
      interval: 10 * 60 * 1000, // every 10 minutes, write a checkpoint
      verbosity: 2
    }, settings);

    if (this.settings.verbosity >= 4) console.log('[DEBUG]', 'Instance of Bitcoin service created, settings:', this.settings);

    // Bcoin for JS full node
    // bcoin.set(this.settings.network);
    // this.network = bcoin.Network.get(this.settings.network);

    // Internal Services
    this.observer = null;
    // this.provider = new Consensus({ provider: 'bcoin' });
    this.wallet = new Wallet(this.settings);
    // this.chain = new Chain(this.settings);

    // ## Collections
    // ### Addresses
    this.addresses = [];

    // ### Blocks
    this.blocks = new Collection({
      name: 'Block',
      type: BitcoinBlock,
      methods: {
        create: this._prepareBlock.bind(this)
      },
      listeners: {
        create: this._handleCommittedBlock.bind(this)
      }
    });

    // ### Transactions
    this.transactions = new Collection({
      name: 'Transaction',
      type: BitcoinTransaction,
      methods: {
        create: this._prepareTransaction.bind(this)
      },
      listeners: {
        create: this._handleCommittedTransaction.bind(this)
      }
    });

    // Runs fullnode from bcoin (disabled for now)
    /* if (this.settings.fullnode) {
      this.fullnode = new FullNode({
        network: this.settings.network
      });
    } */

    // Local Bitcoin Node
    this.peer = null; /* bcoin.Peer.fromOptions({
      agent: this.UAString,
      network: this.settings.network,
      hasWitness: () => {
        return false;
      }
    }); */

    // Attach to the network
    this.spv = null; /* new bcoin.SPVNode({
      agent: this.UAString + ' (SPV)',
      network: this.settings.network,
      port: this.settings.spv.port,
      http: false,
      listen: false,
      // httpPort: 48449, // TODO: disable HTTP entirely!
      memory: true,
      logLevel: (this.settings.verbosity >= 4) ? 'spam' : 'error',
      maxOutbound: 1,
      workers: true
    }); */

    // TODO: import ZMQ settings
    this.zmq = new ZMQ();

    // Define Bitcoin P2P Messages
    this.define('VersionPacket', { type: 0 });
    this.define('VerAckPacket', { type: 1 });
    this.define('PingPacket', { type: 2 });
    this.define('PongPacket', { type: 3 });
    this.define('SendHeadersPacket', { type: 12 });
    this.define('BlockPacket', { type: 13 });
    this.define('FeeFilterPacket', { type: 21 });
    this.define('SendCmpctPacket', { type: 22 });

    this._state = {
      status: 'PAUSED',
      balances: { // safe up to 2^53-1 (all satoshis can be represented in 52 bits!)
        mine: {
          trusted: 0,
          untrusted_pending: 0,
          immature: 0,
          used: 0
        },
        watchonly: {
          trusted: 0,
          untrusted_pending: 0,
          immature: 0
        }
      },
      content: {
        actors: {},
        blocks: [],
        height: 0,
        tip: this.settings.genesis
      },
      chain: [],
      blocks: {},
      headers: [],
      genesis: this.settings.genesis,
      tip: this.settings.genesis
    };

    // Chainable
    return this;
  }

  get balance () {
    return this._state.balances.mine.trusted;
  }

  get best () {
    return this._state.content.tip;
  }

  /**
   * User Agent string for the Bitcoin P2P network.
   */
  get UAString () {
    return FABRIC_USER_AGENT;
  }

  /**
   * Chain tip (block hash of the chain with the most Proof of Work)
   */
  get tip () {
    return (this.chain && this.chain.tip) ? this.chain.tip.toString('hex') : null;
  }

  /**
   * Chain height (`=== length - 1`)
   */
  get height () {
    return this._state.content.height;
  }

  get headers () {
    return this._state.headers;
  }

  set headers (value) {
    this._state.headers = value;
  }

  get lib () {
    return bitcoin;
  }

  get networks () {
    return {
      'mainnet': bitcoin.networks.mainnet,
      'regtest': bitcoin.networks.regtest,
      'testnet': bitcoin.networks.testnet
    };
  }

  set best (best) {
    if (best === this.best) return this.best;
    if (best !== this.best) {
      this._state.content.tip = best;
      this.emit('tip', best);
    }
  }

  set height (value) {
    this._state.content.height = parseInt(value);
    this.commit();
  }

  createKeySpendOutput (publicKey) {
    // x-only pubkey (remove 1 byte y parity)
    const myXOnlyPubkey = publicKey.slice(1, 33);
    const commitHash = bitcoin.crypto.taggedHash('TapTweak', myXOnlyPubkey);
    const tweakResult = ecc.xOnlyPointAddTweak(myXOnlyPubkey, commitHash);
    if (tweakResult === null) throw new Error('Invalid Tweak');

    const { xOnlyPubkey: tweaked } = tweakResult;

    // scriptPubkey
    return Buffer.concat([
      // witness v1, PUSH_DATA 32 bytes
      Buffer.from([0x51, 0x20]),
      // x-only tweaked pubkey
      tweaked,
    ]);
  }

  createSigned (key, txid, vout, amountToSend, scriptPubkeys, values) {
    const tx = new bitcoin.Transaction();

    tx.version = 2;

    // Add input
    tx.addInput(Buffer.from(txid, 'hex').reverse(), vout);

    // Add output
    tx.addOutput(scriptPubkeys[0], amountToSend);

    const sighash = tx.hashForWitnessV1(
      0, // which input
      scriptPubkeys, // All previous outputs of all inputs
      values, // All previous values of all inputs
      bitcoin.Transaction.SIGHASH_DEFAULT // sighash flag, DEFAULT is schnorr-only (DEFAULT == ALL)
    );

    const signature = Buffer.from(signTweaked(sighash, key));

    // witness stack for keypath spend is just the signature.
    // If sighash is not SIGHASH_DEFAULT (ALL) then you must add 1 byte with sighash value
    tx.ins[0].witness = [signature];

    return tx;
  }

  signTweaked (messageHash, key) {
    // Order of the curve (N) - 1
    const N_LESS_1 = Buffer.from('fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364140', 'hex');
    // 1 represented as 32 bytes BE
    const ONE = Buffer.from('0000000000000000000000000000000000000000000000000000000000000001', 'hex');
    const privateKey = (key.publicKey[0] === 2) ? key.privateKey : ecc.privateAdd(ecc.privateSub(N_LESS_1, key.privateKey), ONE);
    const tweakHash = bitcoin.crypto.taggedHash('TapTweak', key.publicKey.slice(1, 33));
    const newPrivateKey = ecc.privateAdd(privateKey, tweakHash);
    if (newPrivateKey === null) throw new Error('Invalid Tweak');
    return ecc.signSchnorr(messageHash, newPrivateKey, Buffer.alloc(32));
  }

  validateAddress (address) {
    try {
      bitcoin.address.toOutputScript(address, this.networks[this.settings.network]);
      return true;
    } catch (e) {
      return false;
    }
  }

  async tick () {
    const self = this;
    const now = (new Date()).toISOString();
    ++this._clock;

    Promise.all([
      this._syncBestBlock(),
      this._checkAllTargetBalances()
    ]).catch((exception) => {
      self.emit('error', `Unable to synchronize: ${exception}`);
    }).then((output) => {
      // self.emit('log', `Tick output: ${JSON.stringify(output, null, '  ')}`);

      const beat = {
        clock: self._clock,
        created: now,
        state: self.state
      };

      self.emit('beat', beat);
      self.commit();
    });

    return this;
  }

  /**
   * Broadcast a transaction to the Bitcoin network.
   * @unstable
   * @param {TX} tx Bitcoin transaction
   */
  async broadcast (msg) {
    console.log('[SERVICES:BITCOIN]', 'Broadcasting:', msg);
    const verify = await msg.verify();
    console.log('[SERVICES:BITCOIN]', 'Verified TX:', verify);

    await this.spv.sendTX(msg);
    // await this.spv.broadcast(msg);
    await this.spv.relay(msg);
    console.log('[SERVICES:BITCOIN]', 'Broadcasted!');
  }

  async processSpendMessage (message) {
    return this._processSpendMessage(message);
  }

  async _processRawBlock (raw) {
    const block = bcoin.Block.fromRaw(raw);
    console.log('rawBlock:', block);
  }

  /**
   * Process a spend message.
   * @param {SpendMessage} message Generic-level message for spending.
   * @param {String} message.amount Amount (in BTC) to spend.
   * @param {String} message.destination Destination for funds.
   * @returns {BitcoinTransactionID} Hex-encoded representation of the transaction ID.
   */
  async _processSpendMessage (message) {
    if (!message) throw new Error('Message is required.');
    if (!message.amount) throw new Error('Message must provide an amount.');
    if (!message.destination) throw new Error('Message must provide a destination.');

    if (message.amount instanceof String) {
      message.amount = message.amount.fixed().toPrecision(8); // TODO: evaluate precision behavior
    }

    const actor = new Actor(message);
     // sendtoaddress "address" amount ( "comment" "comment_to" subtractfeefromamount replaceable conf_target "estimate_mode" avoid_reuse fee_rate verbose )
    const txid = await this._makeRPCRequest('sendtoaddress', [
      message.destination,
      message.amount,
      message.comment || `_processSendMessage ${actor.id} ${message.created}`,
      message.recipient || 'Unknown Recipient',
      false,
      false,
      1,
      'conservative',
      true
    ]);

    if (txid.error) {
      this.emit('error', `Could not create transaction: ${txid.error}`);
      return false;
    }

    return txid;
  }

  async _heartbeat () {
    await this._syncBestBlock();
  }

  async _prepareBlock (obj) {
    if (!obj.transactions) throw new Error('Block must have "transactions" property.');
    if (!(obj.transactions instanceof Array)) throw new Error('Block must provide transactions as an Array.');

    for (const tx of obj.transactions) {
      let transaction = await this.transactions.create(tx);
    }

    let entity = new Entity(obj);
    return Object.assign({}, obj, {
      id: entity.id
    });
  }

  /**
   * Prepares a {@link Transaction} for storage.
   * @param {Transaction} obj Transaction to prepare.
   */
  async _prepareTransaction (obj) {
    let entity = new Entity(obj);
    return Object.assign({}, obj, {
      id: entity.id
    });
  }

  /**
   * Receive a committed block.
   * @param {Block} block Block to handle.
   */
  async _handleCommittedBlock (block) {
    // console.log('[FABRIC:BITCOIN]', 'Handling Committed Block:', block);
    for (let i = 0; i < block.transactions.length; i++) {
      let txid = block.transactions[i];
      await this.transactions.create({
        hash: txid.toString('hex')
      });
    }

    this.emit('block', block);

    // await this.commit();
  }

  async _handleCommittedTransaction (transaction) {
    // console.log('[SERVICE:BITCOIN]', 'Handling Committed Transaction:', transaction);
    // this.emit('message', `Transaction committed: ${JSON.stringify(transaction)}`);
    this.emit('transaction', transaction);
  }

  async _registerBlock (obj) {
    let result = null;
    let state = new State(obj);
    let transform = [state.id, state.render()];
    let prior = null;

    // TODO: ensure all appropriate fields, valid block
    let path = `/blocks/${obj.hash}`;
    let hash = require('crypto').createHash('sha256').update(obj.data).digest('hex');

    // TODO: verify local hash (see below)
    console.log('local hash from node:', hash);
    console.log('WARNING [!!!]: double check that:', `${obj.headers.hash('hex')} === ${hash}`);

    try {
      // TODO: verify block hash!!!
      prior = await this._GET(path);
    } catch (E) {
      console.warn('[SERVICES:BITCOIN]', 'No previous block (registering as new):', E);
    }

    if (prior) {
      console.log('block seen before!', prior);
      return prior;
    }

    let block = Object.assign({
      id: obj.hash,
      type: 'Block',
      // TODO: enable sharing of local hashes
      // sharing: transform,
      transactions: obj.transactions || []
    }, obj);

    try {
      await this._PUT(path, block);
      result = await this._GET(path);
    } catch (E) {
      return console.error('Cannot register block:', E);
    }

    for (let i = 0; i < obj.transactions.length; i++) {
      let tx = obj.transactions[i];
      console.log('[AUDIT]', 'tx found in block:', tx);
      let transaction = await this._registerTransaction({
        id: tx.txid + '',
        hash: tx.hash + '',
        confirmations: 1
      });
      console.log('[SERVICES:BITCOIN]', 'registered transaction:', transaction);
      // await this._PUT(`/transactions/${tx.hash}`, tx);
    }

    this.emit(path, result);
    this.emit(`message`, {
      '@type': 'BlockRegistration',
      '@data': result,
      actor: `services/btc`,
      target: `/blocks`,
      object: result,
      origin: {
        type: 'Link',
        name: 'btc',
        link: `/services/btc`
      }
    });

    return result;
  }

  async _registerAddress (addr) {
    this.emit('address', addr);
  }

  async _registerTransaction (obj) {
    await this._PUT(`/transactions/${obj.hash}`, obj);
    let tx = await this._GET(`/transactions/${obj.hash}`);
    console.log('registered tx:', tx);

    let txns = await this._GET(`/transactions`);
    let txids = Object.keys(txns);
    let inputs = [];
    let outputs = [];

    if (obj.inputs) {
      for (let i = 0; obj.inputs.length; i++) {
        let input = obj.inputs[i];

        if (input.address) {
          await this._registerAddress({
            id: input.address
          });
        }

        inputs.push(input);
      }
    }

    if (obj.outputs) {
      for (let i = 0; obj.outputs.length; i++) {
        let output = obj.outputs[i];

        if (output.address) {
          await this._registerAddress({
            id: output.address
          });
        }

        outputs.push(output);
      }
    }

    let transaction = Object.assign({
      id: obj.hash,
      hash: obj.hash,
      inputs: inputs,
      outputs: outputs
    }, obj);

    // await this._PUT(`/transactions`, txids);
    await this.commit();

    this.emit(`message`, {
      '@type': 'TransactionRegistration',
      '@data': tx,
      actor: `services/bitcoin`,
      target: `/transactions`,
      object: transaction,
      origin: {
        type: 'Link',
        name: 'Bitcoin',
        link: `/services/bitcoin`
      }
    });

    return tx;
  }

  async _handlePeerError (err) {
    console.error('[SERVICES:BITCOIN]', 'Peer generated error:', err);
  }

  /**
   * Process a message from a peer in the Bitcoin network.
   * @param {PeerPacket} msg Message from peer.
   */
  async _handlePeerPacket (msg) {
    console.log('[SERVICES:BITCOIN]', 'Peer sent packet:', msg);

    switch (msg.cmd) {
      default:
        console.warn('[SERVICES:BITCOIN]', 'unhandled peer packet:', msg.cmd);
        break;
      case 'block':
        let blk = msg.block.toBlock();
        let sample = blk.toJSON();
        let headers = msg.block.toHeaders();
        let txids = sample.txs.map(x => x.hash);
        let block = await this._registerBlock({
          headers: headers,
          transactions: txids,
          root: blk.createMerkleRoot('hex'),
          hash: sample.hash,
          data: msg.block.toBlock()._raw,
        });

        console.log('registered block:', block);
        break;
      case 'inv':
        this.peer.getData(msg.items);
        break;
      case 'tx':
        let transaction = await this._registerTransaction({
          id: msg.tx.txid() + '',
          hash: msg.tx.hash('hex') + '',
          confirmations: 0
        });
        console.log('regtest tx:', transaction);
        break;
    }

    console.log('[SERVICES:BITCOIN]', 'State:', this.state);
  }

  async _handleBlockMessage (msg) {
    let template = {
      hash: msg.hash('hex'),
      parent: msg.prevBlock.toString('hex'),
      transactions: msg.txs.map((tx) => {
        return tx;
      }),
      block: msg,
      raw: msg.toRaw().toString('hex')
    };

    let block = await this.blocks.create(template);
  }

  async _handleConnectMessage (entry, block) {
    try {
      const count = await this.wallet.database.addBlock(entry, block.txs);
      this.emit('log', `Added block to wallet database, transactions added: ${count}`);
    } catch (exception) {
      this.emit('error', `Could not add block to WalletDB: ${exception}`);
    }
  }

  /**
   * Hand a {@link Block} message as supplied by an {@link SPV} client.
   * @param {BlockMessage} msg A {@link Message} as passed by the {@link SPV} source.
   */
  async _handleBlockFromSPV (msg) {
    if (this.settings.verbosity >= 5) console.log('[AUDIT]', 'SPV Received block:', msg);
    let block = await this.blocks.create({
      hash: msg.hash('hex'),
      parent: msg.prevBlock.toString('hex'),
      transactions: msg.hashes,
      block: msg
    });

    // if (this.settings.verbosity >= 5) console.log('created block:', block);
    if (this.settings.verbosity >= 5) console.log('block count:', Object.keys(this.blocks.list()).length);

    let message = {
      '@type': 'BitcoinBlock',
      '@data': block
    };

    // Finalize any uncommitted changes
    // await this.commit();

    this.emit('block', message);
    this.emit('message', { '@type': 'ServiceMessage', '@data': message });
  }

  /**
   * Verify and interpret a {@link BitcoinTransaction}, as received from an
   * {@link SPVSource}.
   * @param {BitcoinTransaction} tx Incoming transaction from the SPV source.
   */
  async _handleTransactionFromSPV (tx) {
    if (this.settings.verbosity >= 5) console.log('[AUDIT]', 'SPV Received TX:', tx);
    let msg = {
      '@type': 'BitcoinTransaction',
      '@data': {
        hash: tx.hash('hex'),
        inputs: tx.inputs,
        outputs: tx.outputs,
        tx: tx
      }
    };

    this.emit('transaction', msg);
    this.emit('message', { '@type': 'ServiceMessage', '@data': msg });

    return 1;
  }

  async _dumpKeyPair (address) {
    const wif = await this._makeRPCRequest('dumpprivkey', [address]);
    const pair = ECPair.fromWIF(wif, this.networks[this.settings.network]);
    return pair;
  }

  async _dumpPrivateKey (address) {
    const wif = await this._makeRPCRequest('dumpprivkey', [address]);
    const pair = ECPair.fromWIF(wif, this.networks[this.settings.network]);
    return pair.privateKey;
  }

  async _loadPrivateKey (key) {
    return this._makeRPCRequest('importprivkey', [key]);
  }

  async _loadWallet (name) {
    const actor = new Actor({ content: name });
    const created = await this._makeRPCRequest('createwallet', [
      actor.id,
      false,
      false, // blank (use sethdseed)
      '', // passphrase
      true, // avoid reuse
      false, // descriptors
    ]);

    const wallet = await this._makeRPCRequest('loadwallet', [actor.id]);

    /* if (created.error && wallet.error) {
      return this.emit('error', `Could not create or load wallet: ${created.error || wallet.error}`);
    } */

    try {
      this.addresses = await this._listAddresses();
    } catch (exception) {}

    // console.log('addresses:', this.addresses);
    if (this.addresses.error) this.addresses = [];

    if (!this.addresses.length) {
      const address = await this.getUnusedAddress();
      this.addresses.push(address);
    }

    return {
      id: actor.id
    };
  }

  /**
   * Attach event handlers for a supplied list of addresses.
   * @param {Shard} shard List of addresses to monitor.
   */
  async _subscribeToShard (shard) {
    for (let i = 0; i < shard.length; i++) {
      let slice = shard[i];
      // TODO: fix @types/wallet to use named types for Addresses...
      // i.e., this next line should be unnecessary!
      let address = bcoin.Address.fromString(slice.string, this.settings.network);
      if (this.settings.verbosity >= 4) console.log('[DEBUG]', `[@0x${slice.string}] === ${slice.string}`);
      this.spv.pool.watchAddress(address);
    }
  }

  /**
   * Initiate outbound connections to configured SPV nodes.
   */
  async _connectSPV () {
    await this.spv.open();
    await this.spv.connect();

    // subscribe to shard...
    await this._subscribeToShard(this.wallet.shard);

    // bind listeners...
    this.spv.on('tx', this._handleTransactionFromSPV.bind(this));
    this.spv.on('block', this._handleBlockFromSPV.bind(this));

    // get peer from known address
    let addr = new NetAddress({
      host: '127.0.0.1',
      // port: this.fullnode.pool.options.port
      port: this.provider.port
    });

    // connect this.spv with fullNode
    let peer = this.spv.pool.createOutbound(addr);
    if (this.settings.verbosity >= 4) console.log('[SERVICES:BITCOIN]', 'Peer connection created:', peer);
    this.spv.pool.peers.add(peer);

    // start the SPV node's blockchain sync
    await this.spv.startSync();
  }

  async _connectToSeedNodes () {
    for (let i = 0; i < this.settings.seeds.length; i++) {
      let node = this.settings.seeds[i];
      this.connect(node);
    }
  }

  async _connectToEdgeNodes () {
    let bitcoin = this;

    for (let id in this.settings.nodes) {
      let node = this.settings.nodes[id];
      let peer = bcoin.Peer.fromOptions({
        network: this.settings.network,
        agent: this.UAString,
        hasWitness: () => {
          return false;
        }
      });

      this.peer.on('error', this._handlePeerError.bind(this));
      this.peer.on('packet', this._handlePeerPacket.bind(this));
      this.peer.on('open', () => {
        // triggers block event
        // pre-seeds genesis block for the rest of us.
        bitcoin.peer.getBlock([bitcoin.network.genesis.hash]);
      });

      await peer.open();
      await peer.connect();

      /* try {
        let walletClient = new bclient.WalletClient({
          network: this.settings.network,
          port: node.port
        });
        let balance = await walletClient.execute('getbalance');
        console.log('wallet balance:', balance);
      } catch (E) {
        console.error('[SERVICES:BITCOIN]', 'Could not connect to trusted node:', E);
      } */
    }
  }

  async _startZMQ () {
    const self = this;

    this.zmq.on('log', async function _handleZMQLogEvent (event) {
      self.emit('debug', `[BITCOIN:ZMQ] Log: ${event}`);
      self.emit('log', `[BITCOIN:ZMQ] Log: ${event}`);
    });

    this.zmq.on('message', async function _handleZMQMessage (event) {
      self.emit('debug', `[BITCOIN:ZMQ] Message: ${JSON.stringify(event)}`);

      let data = null;

      try {
        data = JSON.parse(event.data);
      } catch (exception) {
        self.emit('error', 'Could not parse raw block:', event.data);
      }

      if (!data || !data.topic) return;

      switch (data.topic) {
        case 'hashblock':
          try {
            await self._requestBlock(data.message);
          } catch (exception) {
            self.emit('error', `Could not retrieve reported block: ${data.message}`);
          }
          break;
        case 'rawblock':
          try {
            await self._processRawBlock(data.message);
          } catch (exception) {
            self.emit('error', `Could not retrieve reported block: ${data.message}`);
          }
          break;
        default:
          self.emit('warning', `[BITCOIN:ZMQ] Unhandled topic: ${data.topic}`);
          break;
      }
    });

    await this.zmq.start();
    return this;
  }

  async _startLocalNode () {
    const self = this;

    if (this.settings.verbosity >= 4) console.log('[SERVICES:BITCOIN]', `Starting fullnode for network "${this.settings.network}"...`);

    /* for (const candidate of this.settings.seeds) {
      let parts = candidate.split(':');
      let addr = new NetAddress({
        host: parts[0],
        port: parseInt(parts[1]) || this.provider.port
      });

      let peer = this.fullnode.pool.createOutbound(addr);
      this.fullnode.pool.peers.add(peer);
    } */

    await this.fullnode.open();
    await this.fullnode.connect();

    // TODO: listen for sync finalization
    this.fullnode.startSync();

    if (this.settings.verbosity >= 4) console.log('[SERVICES:BITCOIN]', `Full Node for network "${this.settings.network}" started!`);
  }

  async generateBlock (address) {
    let block = null;

    if (!address) address = await this.getUnusedAddress();

    switch (this.settings.mode) {
      case 'rpc':
        const result = await this._makeRPCRequest('generatetoaddress', [1, address]);
        break;
      default:
        try {
          block = await this.fullnode.miner.mineBlock(this.fullnode.chain.tip, address);
          // Add the block to our chain
          await this.fullnode.chain.add(block);
        } catch (exception) {
          return this.emit('error', `Could not mine block: ${exception}`);
        }
        break;
    }

    return block;
  }

  async generateBlocks (count = 1, address = this.wallet.receive) {
    const blocks = [];

    // Generate the specified number of blocks
    for (let i = 0; i < count; i++) {
      const block = await this.generateBlock(address);
      blocks.push(block);
    }

    return blocks;
  }

  async getChainHeight () {
    const info = await this._makeRPCRequest('getblockchaininfo');
    return info.blocks;
  }

  async getBalances () {
    const balances = await this._makeRPCRequest('getbalances');
    return balances.mine;
  }

  async getUnusedAddress () {
    if (this.rpc) {
      const address = await this._makeRPCRequest('getnewaddress');
      return address;
    } else {
      const target = this.key.deriveAddress(this.state.index);
      return target.address;
    }
  }

  async append (raw) {
    const block = bcoin.Block.fromRaw(raw, 'hex');
    this.emit('debug', `Parsed block: ${JSON.stringify(block)}`);
    const added = await this.fullnode.chain.add(block);
    if (!added) this.emit('warning', 'Block not added to chain.');
    return added;
  }

  /**
   * Connect to a Fabric {@link Peer}.
   * @param {String} addr Address to connect to.
   */
  async connect (addr) {
    try {
      this.peer.connect(addr);
    } catch (E) {
      console.error('[SERVICES:BITCOIN]', 'Could not connect to peer:', E);
    }
  }

  async _listAddresses () {
    return this._makeRPCRequest('listreceivedbyaddress', [1, true]);
  }

  async _makeRPCRequest (method, params = []) {
    const self = this;
    return new Promise((resolve, reject) => {
      if (!self.rpc) {
        self.emit('error', `No local RPC: ${self} \n${OP_TRACE({ name: 'foo' })}`);
        return reject(new Error('RPC manager does not exist.'));
      }

      try {
        self.rpc.request(method, params, function responseHandler (err, response) {
          if (err) {
            // TODO: replace with reject()
            return resolve({
              error: (err.error) ? JSON.parse(JSON.parse(err.error)) : err,
              response: response
            });
          }

          return resolve(response.result);
        });
      } catch (exception) {
        return reject(exception);
      }
    });
  }

  async _checkAllTargetBalances () {
    for (let i = 0; i < this.settings.targets.length; i++) {
      const balance = await this._getBalanceForAddress(this.settings.targets[i]);
    }
  }

  async _getBalanceForAddress (address) {
    return this._makeRPCRequest('getreceivedbyaddress', [address]);
  }

  async _listChainBlocks () {
    return Object.keys(this._state.blocks);
  }

  async _requestBestBlockHash () {
    const hash = await this._makeRPCRequest('getbestblockhash', []);
    // this.emit('debug', `Got best block hash: ${hash}`);
    return hash;
  }

  async _requestBlockHeader (hash) {
    return this._makeRPCRequest('getblockheader', [hash]);
  }

  async _requestRawBlockHeader (hash) {
    return this._makeRPCRequest('getblockheader', [hash, false]);
  }

  async _requestBlock (hash) {
    return this._makeRPCRequest('getblock', [hash]);
  }

  async _getMempool (hash) {
    return this._makeRPCRequest('getrawmempool');
  }

  async _requestRawTransaction (hash) {
    return this._makeRPCRequest('getrawtransaction', [hash]);
  }

  async _syncRawBlock (hash) {
    const self = this;
    const raw = await this._requestRawBlock(hash);

    if (!self._state.blocks[hash]) {
      self._state.blocks[hash] = raw;
      const actor = new Actor({ raw });
      self.emit('block', actor);
    }

    return this;
  }

  async _requestRawBlock (hash) {
    return this._makeRPCRequest('getblock', [hash, 0]);
  }

  /**
   * Retrieve the equivalent to `getblockhash` from Bitcoin Core.
   * @param {Number} height Height of block to retrieve.
   * @returns {Object} The block hash.
   */
  async _requestBlockAtHeight (height) {
    return this._makeRPCRequest('getblockhash', [height]);
  }

  async _syncHeaderAtHeight (height) {
    const hash = await this._requestBlockAtHeight(height);
    return this._makeRPCRequest('getblockheader', [hash]);
  }

  async _getHeaderAtHeight (height) {
    const hash = await this._requestBlockAtHeight(height);
    return this._makeRPCRequest('getblockheader', [hash]);
  }

  async _requestChainHeight () {
    return this._makeRPCRequest('getblockcount', []);
  }

  async _syncChainHeight () {
    this.height = await this._makeRPCRequest('getblockcount', []);
    // this.emit('debug', `Got height:`, this.height);
    return this.height;
  }

  async _listUnspent () {
    return this._makeRPCRequest('listunspent', []);
  }

  async _encodeSequenceForNBlocks (time) {
    return bip68.encode({ blocks: time });
  }

  async _encodeSequenceTargetBlock (height) {
    const locktime = bip65.encode({ blocks: height });
    return bitcoin.script.number.encode(locktime).toString('hex');
  }

  async _signRawTransactionWithWallet (rawTX, prevouts = []) {
    return this._makeRPCRequest('signrawtransaction', [rawTX, JSON.stringify(prevouts)]);
  }

  async _getUTXOSetMeta (utxos) {
    const coins = [];
    const keys = [];

    let inputSum = 0;
    let inputCount = 0;

    for (let i = 0; i < utxos.length; i++) {
      const candidate = utxos[i];
      const template = {
        hash: Buffer.from(candidate.txid, 'hex').reverse(),
        index: candidate.vout,
        value: Amount.fromBTC(candidate.amount).toValue(),
        script: Script.fromAddress(candidate.address)
      };

      const c = Coin.fromOptions(template);
      const keypair = await this._dumpKeyPair(candidate.address);

      coins.push(c);
      keys.push(keypair);

      inputCount++;
      // TODO: not rely on parseFloat
      // use bitwise...
      inputSum += parseFloat(template.value);
    }

    return {
      inputs: {
        count: inputCount,
        total: inputSum
      }
    };
  }

  /**
   * Creates an unsigned Bitcoin transaction.
   * @param {Object} options 
   * @returns {ContractProposal} Instance of the proposal.
   */
  async _createContractProposal (options = {}) {
    const mtx = new MTX();
    const keys = [];
    const rate = await this._estimateFeeRate();
    const utxos = await this._listUnspent();
    const coins = await this._getCoinsFromInputs(utxos);
    const meta = await this._getUTXOSetMeta(utxos);

    // TODO: report FundingError: Not enough funds
    await mtx.fund(coins, {
      rate: rate,
      changeAddress: options.change
    });

    return {
      change: options.change,
      inputs: utxos,
      keys: keys,
      meta: meta,
      mtx: mtx,
      // raw: raw,
      // tx: tx
    };
  }

  async _createContractFromProposal (proposal) {
    const tx = proposal.mtx.toTX();
    const raw = tx.toRaw().toString('hex');
    return {
      tx: tx,
      raw: raw
    };
  }

  async _getCoinsFromInputs (inputs = []) {
    const coins = [];
    const keys = [];

    let inputSum = 0;
    let inputCount = 0;

    for (let i = 0; i < inputs.length; i++) {
      const candidate = inputs[i];
      const template = {
        hash: Buffer.from(candidate.txid, 'hex').reverse(),
        index: candidate.vout,
        value: Amount.fromBTC(candidate.amount).toValue(),
        script: Script.fromAddress(candidate.address)
      };

      const c = Coin.fromOptions(template);
      const keypair = await this._dumpKeyPair(candidate.address);

      coins.push(c);
      keys.push(keypair);

      inputCount++;
      // TODO: not rely on parseFloat
      // use bitwise...
      inputSum += parseFloat(template.value);
    }

    return coins;
  }

  async _getKeysFromCoins (coins) {
    console.log('coins:', coins);
  }

  async _attachOutputToContract (output, contract) {
    // TODO: add support for segwit, taproot
    // is the scriptpubkey still set?
    const scriptpubkey = output.scriptpubkey;
    const value = output.value;
    // contract.mtx.addOutput(scriptpubkey, value);
    return contract;
  }

  async _signInputForContract (index, contract) {

  }

  async _signAllContractInputs (contract) {

  }

  async _generateScriptAddress () {
    const script = new Script();
    script.pushOp(bcoin.opcodes.OP_); // Segwit version
    script.pushData(ring.getKeyHash());
    script.compile();

    return {
      address: script.getAddress(),
      script: script
    };
  }

  async _estimateFeeRate (options = {}) {
    // satoshis per kilobyte
    // TODO: use satoshis/vbyte
    return 10000;
  }

  async _coinSelectNaive (options = {}) {

  }

  async _createSwapScript (options) {
    const sequence = await this._encodeSequenceTargetBlock(options.constraints.blocktime);
    const asm = `
      OP_IF OP_SHA256 ` + options.hash + ` OP_EQUALVERIFY
        ` + options.counterparty.toString('hex') + `
      OP_ELSE
        ` + sequence + `
        OP_CHECKSEQUENCEVERIFY
        OP_DROP
        ` + options.initiator.toString('hex') + `
      OP_ENDIF
      OP_CHECKSIG
    `;

    const clean = asm.trim().replace(/\s+/g, ' ');
    return bitcoin.script.fromASM(clean);
  }

  async _createSwapTX (options) {
    const network = this.networks[this.settings.network];
    const tx = new bitcoin.Transaction();

    tx.locktime = bip65.encode({ blocks: options.constraints.blocktime });

    const input = options.inputs[0];
    tx.addInput(Buffer.from(input.txid, 'hex').reverse(), input.vout, 0xfffffffe);

    const output = bitcoin.address.toOutputScript(options.destination, network);
    tx.addOutput(output, options.amount * 100000000);

    return tx;
  }

  async _p2shForOutput (output) {
    return bitcoin.payments.p2sh({
      redeem: { output },
      network: this.networks[this.settings.network]
    });
  }

  async _spendSwapTX (options) {
    const network = this.networks[this.settings.network];
    const tx = options.tx;
    const hashtype = bitcoin.Transaction.SIGHASH_ALL;
    const sighash = tx.hashForSignature(0, options.script, hashtype);
    const scriptsig = bitcoin.payments.p2sh({
      redeem: {
        input: bitcoin.script.compile([
          bitcoin.script.signature.encode(options.signer.sign(sighash), hashtype),
          bitcoin.opcodes.OP_TRUE
        ]),
        output: options.script
      },
      network: network
    });

    tx.setInputScript(0, scriptsig.input);

    return tx;
  }

  async _createP2WPKHTransaction (options) {
    const p2wpkh = this._createPayment(options);
    const psbt = new bitcoin.Psbt({ network: this.networks[this.settings.network] })
      .addInput(options.input)
      .addOutput({
        address: options.change,
        value: 2e4,
      })
      .signInput(0, p2wpkh.keys[0]);

    psbt.finalizeAllInputs();
    const tx = psbt.extractTransaction();
    return tx;
  }

  async _createP2WKHPayment (options) {
    return bitcoin.payments.p2wsh({
      pubkey: options.pubkey, 
      network: this.networks[this.settings.network]
    });
  }

  _createPayment (options) {
    return bitcoin.payments.p2wpkh({
      pubkey: options.pubkey,
      network: this.networks[this.settings.network]
    });
  }

  async _getInputData (options = {}) {
    const unspent = options.input;
    const isSegwit = true;
    const redeemType = 'p2wpkh';
    const raw = await this._requestRawTransaction(unspent.txid);
    const tx = bitcoin.Transaction.fromHex(raw);

    // for non segwit inputs, you must pass the full transaction buffer
    const nonWitnessUtxo = Buffer.from(raw, 'hex');
    // for segwit inputs, you only need the output script and value as an object.
    const witnessUtxo = await this._getWitnessUTXO(tx.outs[unspent.vout]);
    const mixin = isSegwit ? { witnessUtxo } : { nonWitnessUtxo };
    const mixin2 = {};

    switch (redeemType) {
      case 'p2sh':
        mixin2.redeemScript = payment.redeem.output;
        break;
      case 'p2wsh':
        mixin2.witnessScript = payment.redeem.output;
        break;
      case 'p2sh-p2wsh':
        mixin2.witnessScript = payment.redeem.redeem.output;
        mixin2.redeemScript = payment.redeem.output;
        break;
    }

    return {
      hash: unspent.txId,
      index: unspent.vout,
      ...mixin,
      ...mixin2,
    };
  }

  /**
   * Create a Partially-Signed Bitcoin Transaction (PSBT).
   * @param {Object} options Parameters for the PSBT.
   * @returns {PSBT} Instance of the PSBT.
   */
  async _buildPSBT (options = {}) {
    if (!options.inputs) options.inputs = [];
    if (!options.outputs) options.outputs = [];

    const psbt = new bitcoin.Psbt({
      network: this.networks[this.settings.network]
    });

    for (let i = 0; i < options.inputs.length; i++) {
      const input = options.inputs[i];
      const data = {
        hash: input.txid,
        index: input.vout
      };

      psbt.addInput(data);
    }

    for (let i = 0; i < options.outputs.length; i++) {
      const output = options.outputs[i];
      const data = {
        address: output.address,
        value: output.value
      };

      psbt.addOutput(data);
    }

    return psbt;
  }

  async _signAllInputs (psbt, keypair) {
    psbt.signAllInputs(keypair);
    return psbt;
  }

  async _finalizePSBT (psbt) {
    return psbt.finalizeAllInputs();
  }

  async _psbtToRawTX (psbt) {
    return psbt.extractTransaction().toHex();
  }

  async _createTX (options = {}) {
    const psbt = await this._buildPSBT(options);

    return psbt;
  }

  _getFinalScriptsForInput (inputIndex, input, script, isSegwit, isP2SH, isP2WSH) {
    const options = {
      inputIndex,
      input,
      script,
      isSegwit,
      isP2SH,
      isP2WSH
    };

    const decompiled = bitcoin.script.decompile(options.script);
    // TODO: SECURITY !!!
    // This is a very naive implementation of a script-validating heuristic.
    // DO NOT USE IN PRODUCTION
    //
    // Checking if first OP is OP_IF... should do better check in production!
    // You may even want to check the public keys in the script against a
    // whitelist depending on the circumstances!!!
    // You also want to check the contents of the input to see if you have enough
    // info to actually construct the scriptSig and Witnesses.
    if (!decompiled || decompiled[0] !== bitcoin.opcodes.OP_IF) {
      throw new Error(`Can not finalize input #${inputIndex}`);
    }

    const signature = (options.input.partialSig)
      ? options.input.partialSig[0].signature
      : undefined;

    const template = {
      network: this.networks[this.settings.network],
      output: options.script,
      input: bitcoin.script.compile([
        signature,
        bitcoin.opcodes.OP_TRUE
      ])
    };

    let payment = null;

    if (options.isP2WSH && options.isSegwit) {
      payment = bitcoin.payments.p2wsh({
        network: this.networks[this.settings.network],
        redeem: template,
      });
    }

    if (options.isP2SH) {
      payment = bitcoin.payments.p2sh({
        network: this.networks[this.settings.network],
        redeem: template,
      });
    }

    return {
      finalScriptSig: payment.input,
      finalScriptWitness: payment.witness && payment.witness.length > 0
        ? this._witnessStackToScriptWitness(payment.witness)
        : undefined
    };
  }

  _witnessStackToScriptWitness (stack) {
    const buffer = Buffer.alloc(0);

    function writeSlice (slice) {
      buffer = Buffer.concat([buffer, Buffer.from(slice)]);
    }

    function writeVarInt (i) {
      const currentLen = buffer.length;
      const varintLen = varuint.encodingLength(i);

      buffer = Buffer.concat([buffer, Buffer.allocUnsafe(varintLen)]);
      varuint.encode(i, buffer, currentLen);
    }

    function writeVarSlice (slice) {
      writeVarInt(slice.length);
      writeSlice(slice);
    }

    function writeVector (vector) {
      writeVarInt(vector.length);
      vector.forEach(writeVarSlice);
    }

    writeVector(stack);

    return buffer;
  }

  async _buildTX () {
    return new bitcoin.TransactionBuilder();
  }

  async _spendRawTX (raw) {
    return this._makeRPCRequest('sendrawtransaction', [ raw ]);
  }

  async _syncBestBlock () {
    return this._syncBestBlockHash();
  }

  async _syncBestBlockHash () {
    const best = await this._requestBestBlockHash();
    if (best.error) return this.emit('error', `[${this.settings.name}] Could not make request to RPC host: ${best.error}`);
    this.best = best;
    await this.commit();
    return this.best;
  }

  async _syncHeaders () {
    const height = await this._requestChainHeight();
    for (let i = 0; i <= height; i++) {
      const hash = await this._requestBlockAtHeight(i);
      await this._syncHeadersForBlock(hash);
    }
    await this.commit();
    return this;
  }

  async _syncBalanceFromOracle () {
    // Get balance
    const balance = await this._makeRPCRequest('getbalance');

    // Update service data
    this._state.balance = balance;

    // Commit to state
    const commit = await this.commit();
    const actor = new Actor(commit.data);

    // Return OracleBalance
    return {
      type: 'OracleBalance',
      data: {
        content: balance
      },
      // signature: actor.sign().signature
    };
  }

  async _syncBalances () {
    const balances = await this._makeRPCRequest('getbalances');
    this._state.balances = balances;
    this.commit();
    return balances;
  }

  async _syncChainInfoOverRPC () {
    // Try to get the reported Genesis Block (Chain ID)
    try {
      this.genesis = await this._requestBlockAtHeight(0);
    } catch (exception) {
      this.emit('error', `Could not retrive genesis block: ${JSON.stringify(exception)}`);
    }

    // Get the best block hash (and height)
    const best = await this._syncBestBlockHash();
    const height = await this._syncChainHeight();

    this.best = best;
    this.height = height;

    return this;
  }

  async _syncRawHeadersForBlock (hash) {
    const header = await this._requestRawBlockHeader(hash);
    if (header.error) return this.emit('error', header.error);
    const raw =  Buffer.from(header, 'hex');
    this.headers.push(raw);
    this.emit('debug', `raw headers[${hash}] = ${JSON.stringify(header)}`);
    return this;
  }

  async _syncHeadersForBlock (hash) {
    const header = await this._requestBlockHeader(hash);
    this.headers[hash] = header;
    this.emit('debug', `headers[${hash}] = ${JSON.stringify(header)}`);
    this.commit();
    return this;
  }

  async _syncChainHeadersOverRPC () {
    const start = Date.now();

    let last = 0;
    let rate = 0;
    let before = 0;

    for (let i = 0; i <= this.height; i++) {
      this.emit('debug', `Getting block headers: ${i} of ${this.height}`);

      const now = Date.now();
      const progress = now - start;
      const hash = await this._requestBlockAtHeight(i);
      await this._syncRawHeadersForBlock(hash);

      const epoch = Math.floor((progress / 1000) % 1000);
      // this.emit('debug', `timing: epochs[${epoch}] ${now} ${progress} ${i} ${epoch} ${rate}/sec`);

      if (epoch > last) {
        rate = `${i - before}`;
        before = i;
        last = epoch;

        this.emit('debug', `timing: epochs[${epoch}] ${now} ${i} processed @ ${rate}/sec (${progress/1000}s elapsed)`);
      }
    }

    return this;
  }

  async _syncRawChainOverRPC () {
    // TODO: async (i.e., Promise.all) chainsync
    for (let i = 0; i <= this.height; i++) {
      this.emit('log', `Getting block: ${i}`);
      const hash = await this._requestBlockAtHeight(i);
      this._state.chain[i] = hash;
      this.emit('log', `blocks[${i}] = ${hash}`);
      await this._syncRawBlock(hash); // state updates happen here
    }
  }

  async _syncChainOverRPC () {
    await this._syncChainInfoOverRPC();

    this.emit('log', `Beginning chain sync for height ${this.height} with best block: ${this.best}`);

    await this._syncBestBlock();
    await this._syncChainHeadersOverRPC(this.best);
    // await this._syncRawChainOverRPC();

    this.state.status = 'READY';
    this.emit('sync', {
      best: this.best,
      height: this.height
    });

    this.commit();

    return this;
  }

  async _syncWithRPC () {
    // await this._syncChainInfoOverRPC();
    await this._syncChainOverRPC();
    await this.commit();

    return this;
  }

  /**
   * Start the Bitcoin service, including the initiation of outbound requests.
   */
  async start () {
    this.emit('debug', `[SERVICES:BITCOIN] Starting for network "${this.settings.network}"...`);

    const self = this;
    self.status = 'starting';

    // Bitcoin events
    if (this.peer) this.peer.on('error', this._handlePeerError.bind(this));
    if (this.peer) this.peer.on('packet', this._handlePeerPacket.bind(this));
    // NOTE: we always ask for genesis block on peer open
    if (this.peer) this.peer.on('open', () => {
      let block = self.peer.getBlock([this.network.genesis.hash]);
    });

    if (this.store) await this.store.open();
    /* if (this.settings.fullnode) {
      this.fullnode.on('peer connect', function peerConnectHandler (peer) {
        self.emit('warning', `[SERVICES:BITCOIN]', 'Peer connected to Full Node: ${peer}`);
      });

      this.fullnode.on('block', this._handleBlockMessage.bind(this));
      this.fullnode.on('connect', this._handleConnectMessage.bind(this));

      this.fullnode.on('tx', async function fullnodeTxHandler (tx) {
        self.emit('log', `tx event: ${JSON.stringify(tx)}`);
      });
    } */

    this.wallet.on('message', function (msg) {
      self.emit('log', `wallet msg: ${msg}`);
    });

    this.wallet.on('log', function (msg) {
      self.emit('log', `wallet log: ${msg}`);
    });

    this.wallet.on('warning', function (msg) {
      self.emit('warning', `wallet warning: ${msg}`);
    });

    this.wallet.on('error', function (msg) {
      self.emit('error', `wallet error: ${msg}`);
    });

    if (this.wallet.database) {
      this.wallet.database.on('tx', function (tx) {
        self.emit('debug', `wallet tx!!!!!! ${JSON.stringify(tx, null, '  ')}`);
      });
    }

    this.observer = monitor.observe(this._state.content);

    // Start services
    await this.wallet.start();
    // await this.chain.start();

    // Start nodes
    // if (this.settings.fullnode) await this._startLocalNode();
    if (this.settings.zmq) await this._startZMQ();

    // Handle RPC mode
    if (this.settings.mode === 'rpc') {
      // If deprecated setting `authority` is provided, compose settings
      if (this.settings.authority) {
        const url = new URL(this.settings.authority);

        // Assign all parameters
        this.settings.username = url.username;
        this.settings.password = url.password;
        this.settings.host = url.host;
        this.settings.port = url.port;
        this.settings.secure = (url.protocol === 'https:') ? true : false;
      }

      const authority = `http${(this.settings.secure == true) ? 's': ''}://${this.settings.username}:${this.settings.password}@${this.settings.host}:${this.settings.port}`;
      const provider = new URL(authority);
      const config = {
        host: provider.hostname,
        port: provider.port
      };

      const auth = provider.username + ':' + provider.password;
      config.headers = { Authorization: `Basic ${Buffer.from(auth, 'utf8').toString('base64')}` };

      if (provider.protocol === 'https:') {
        self.rpc = jayson.https(config);
      } else {
        self.rpc = jayson.http(config);
      }

      const wallet = await this._loadWallet();

      // Heartbeat
      self._heart = setInterval(self.tick.bind(self), self.settings.interval);

      // Sync!
      await self._syncWithRPC();
    }

    // TODO: re-enable these
    // await this._connectToSeedNodes();
    // await this._connectToEdgeNodes();

    // TODO: re-enable SPV
    // await this._connectSPV();

    // this.peer.tryOpen();
    // END TODO

    this.emit('ready', {
      id: this.id,
      tip: this.tip
    });

    this.emit('log', '[SERVICES:BITCOIN] Service started!');

    return this;
  }

  /**
   * Stop the Bitcoin service.
   */
  async stop () {
    if (this.peer && this.peer.connected) await this.peer.destroy();
    if (this.fullnode) await this.fullnode.close();
    await this.wallet.stop();
    // await this.chain.stop();

    if (this._heart) {
      clearInterval(this._heart);
      delete this._heart;
    }

    return this;
  }
}

module.exports = Bitcoin;
