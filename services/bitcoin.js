'use strict';

const {
  BITCOIN_GENESIS
} = require('../constants');

// External Dependencies
const jayson = require('jayson/lib/client');
const monitor = require('fast-json-patch');

// crypto support libraries
// TODO: replace with  `secp256k1`
const ECPairFactory = require('ecpair').default;
const ecc = require('tiny-secp256k1');
const bip65 = require('bip65');

const ECPair = ECPairFactory(ecc);

// TODO: remove bcoin
const bcoin = require('bcoin');
const bitcoin = require('bitcoinjs-lib');

// Services
const ZMQ = require('./zmq');

// Types
const Actor = require('../types/actor');
const Collection = require('../types/collection');
const Entity = require('../types/entity');
const Message = require('../types/message');
const Service = require('../types/service');
const State = require('../types/state');
const Chain = require('../types/chain');
const Wallet = require('../types/wallet');
const Consensus = require('../types/consensus');

// Special Types (internal to Bitcoin)
const BitcoinBlock = require('../types/bitcoin/block');
const BitcoinTransaction = require('../types/bitcoin/transaction');

// Convenience Labels
const FullNode = bcoin.FullNode;
const NetAddress = bcoin.net.NetAddress;

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
      zmq: {
        host: 'localhost',
        port: 29000
      },
      nodes: ['127.0.0.1'],
      seeds: ['127.0.0.1'],
      servers: [],
      peers: [],
      port: 18444,
      interval: 10 * 60 * 1000, // every 10 minutes, write a checkpoint
      verbosity: 2
    }, settings);

    if (this.settings.verbosity >= 4) console.log('[DEBUG]', 'Instance of Bitcoin service created, settings:', this.settings);

    // Bcoin for JS full node
    bcoin.set(this.settings.network);
    this.network = bcoin.Network.get(this.settings.network);

    // Internal Services
    this.observer = null;
    this.provider = new Consensus({ provider: 'bcoin' });
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

    if (this.settings.fullnode) {
      this.fullnode = new FullNode({
        network: this.settings.network
      });
    }

    // Local Bitcoin Node
    this.peer = bcoin.Peer.fromOptions({
      agent: this.UAString,
      network: this.settings.network,
      hasWitness: () => {
        return false;
      }
    });

    // Attach to the network
    this.spv = new bcoin.SPVNode({
      agent: this.UAString + ' (SPV)',
      network: this.settings.network,
      port: this.provider.port,
      http: false,
      listen: false,
      // httpPort: 48449, // TODO: disable HTTP entirely!
      memory: true,
      logLevel: (this.settings.verbosity >= 4) ? 'spam' : 'error',
      maxOutbound: 1,
      workers: true
    });

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
        confirmed: 0,
        unconfirmed: 0
      },
      blocks: {},
      genesis: this.settings.genesis,
      tip: this.settings.genesis
    };

    // Chainable
    return this;
  }

  /**
   * Provides bcoin's implementation of `TX` internally.  This static may be
   * removed in the future.
   */
  static get Transaction () {
    return bcoin.TX;
  }

  /**
   * Provides bcoin's implementation of `MTX` internally.  This static may be
   * removed in the future.
   */
  static get MutableTransaction () {
    return bcoin.TX;
  }

  get balance () {
    return this._state.balances.confirmed;
  }

  get best () {
    return this._state.tip;
  }

  /**
   * User Agent string for the Bitcoin P2P network.
   */
  get UAString () {
    return 'Portal/Bridge 0.1.0-dev (@fabric/core#0.1.0-dev)';
  }

  /**
   * Chain tip (block hash of the chain with the most Proof of Work)
   */
  get tip () {
    if (this.settings.fullnode) {
      return this.fullnode.chain.tip.hash.toString('hex');
    } else {
      return (this.chain && this.chain.tip) ? this.chain.tip.toString('hex') : null;
    }
  }

  /**
   * Chain height (`=== length - 1`)
   */
  get height () {
    return this._state.height;
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
      this._state.tip = best;
      this.emit('tip', best);
    }
  }

  set height (value) {
    this._state.height = parseInt(value);
    this.commit();
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
      self.emit('log', `Tick output: ${JSON.stringify(output, null, '  ')}`);
      const beat = {
        clock: self._clock,
        created: now,
        state: self._state
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

    for (const candidate of this.settings.seeds) {
      let parts = candidate.split(':');
      let addr = new NetAddress({
        host: parts[0],
        port: parseInt(parts[1]) || this.provider.port
      });

      let peer = this.fullnode.pool.createOutbound(addr);
      this.fullnode.pool.peers.add(peer);
    }

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
    const address = await this._makeRPCRequest('getnewaddress');
    return address;
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

  async _registerActor (actor) {
    this.emit('log', `Bitcoin Actor to Register: ${JSON.stringify(actor, null, '  ')}`);
  }

  async _listAddresses () {
    return this._makeRPCRequest('listreceivedbyaddress', [1, true]);
  }

  async _makeRPCRequest (method, params = []) {
    const self = this;
    return new Promise((resolve, reject) => {
      if (!self.rpc) return reject(new Error('RPC manager does not exist.'));
      try {
        self.rpc.request(method, params, function (err, response) {
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
    return this._makeRPCRequest('getbestblockhash', []);
  }

  async _requestBlockHeader (hash) {
    return this._makeRPCRequest('getblockheader', [hash]);
  }

  async _requestBlock (hash) {
    return this._makeRPCRequest('getblock', [hash]);
  }

  async _requestRawBlock (hash) {
    const self = this;
    const request = this._makeRPCRequest('getblock', [hash, 0]);

    request.then(async (result) => {
      if (!self._state.blocks[hash]) {
        self._state.blocks[hash] = result;
        const actor = new Actor(result);
        self.emit('block', result);
      }
    });

    return request;
  }

  async _requestBlockAtHeight (height) {
    return this._makeRPCRequest('getblockhash', [height]);
  }

  async _requestChainHeight () {
    return this._makeRPCRequest('getblockcount', []);
  }

  async _listUnspent () {
    return this._makeRPCRequest('listunspent', []);
  }

  async _signRawTransactionWithWallet (rawTX, prevouts = []) {
    return this._makeRPCRequest('signrawtransaction', [rawTX, JSON.stringify(prevouts)]);
  }

  async _createSwapScript (options) {
    const locktime = bip65.encode({ blocks: options.constraints.blocktime });
    const sequence = bitcoin.script.number.encode(locktime).toString('hex');

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

  async _buildPSBT () {
    return new bitcoin.Psbt();
  }

  async _buildTX () {
    return new bitcoin.TransactionBuilder();
  }

  async _spendRawTX (raw) {
    return this._makeRPCRequest('sendrawtransaction', [ raw ]);
  }

  async _syncBestBlock () {
    try {
      this.best = await this._requestBestBlockHash();
    } catch (exception) {
      this.emit('error', `[${this.settings.name}] Could not make request to RPC host: ${JSON.stringify(exception)}`);
    }

    await this.commit();
  }

  async _syncHeaders () {
    const height = await this._requestChainHeight();
    for (let i = 0; i <= height; i++) {
      const hash = await this._requestBlockAtHeight(i);
      await this._requestBlockHeader(hash); // state updates happen here
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
      signature: actor.sign().signature
    };
  }

  async _syncChainOverRPC () {
    // Try to get the reported Genesis Block (Chain ID)
    try {
      this.genesis = await this._requestBlockAtHeight(0);
    } catch (exception) {
      this.emit('error', `Could not retrive genesis block: ${JSON.stringify(exception)}`);
    }

    // Get the best block hash (and height)
    const best = await this._requestBestBlockHash();
    const height = await this._requestChainHeight();

    // TODO: headers-only sync
    // TODO: async (i.e., Promise.all) chainsync
    for (let i = 0; i <= height; i++) {
      const hash = await this._requestBlockAtHeight(i);
      await this._requestRawBlock(hash); // state updates happen here
    }

    // Assign values
    this.best = best;
    this.height = height;

    this.commit();

    return this;
  }

  async _syncWithRPC () {
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
    this.peer.on('error', this._handlePeerError.bind(this));
    this.peer.on('packet', this._handlePeerPacket.bind(this));
    // NOTE: we always ask for genesis block on peer open
    this.peer.on('open', () => {
      let block = self.peer.getBlock([this.network.genesis.hash]);
    });

    if (this.store) await this.store.open();
    if (this.settings.fullnode) {
      this.fullnode.on('peer connect', function peerConnectHandler (peer) {
        self.emit('warning', `[SERVICES:BITCOIN]', 'Peer connected to Full Node: ${peer}`);
      });

      this.fullnode.on('block', this._handleBlockMessage.bind(this));
      this.fullnode.on('connect', this._handleConnectMessage.bind(this));

      this.fullnode.on('tx', async function fullnodeTxHandler (tx) {
        self.emit('log', `tx event: ${JSON.stringify(tx)}`);
      });
    }

    this.wallet.on('message', function (msg) {
      self.emit('log', `wallet msg: ${msg}`);
    });

    this.wallet.on('warning', function (msg) {
      self.emit('warning', `wallet warning: ${msg}`);
    });

    this.wallet.on('error', function (msg) {
      self.emit('error', `wallet error: ${msg}`);
    });

    this.wallet.database.on('tx', function (tx) {
      self.emit('debug', `wallet tx!!!!!! ${JSON.stringify(tx, null, '  ')}`);
    });

    this.observer = monitor.observe(this._state);

    // Start services
    await this.wallet.start();
    // await this.chain.start();

    // Start nodes
    if (this.settings.fullnode) await this._startLocalNode();
    if (this.settings.zmq) await this._startZMQ();
    if (this.settings.mode === 'rpc') {
      if (!this.settings.authority) return this.emit('error', 'Error: No authority specified.  To use an RPC anchor, provide the "authority" parameter.');
      const provider = new URL(this.settings.authority);
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

    if (this.settings.verbosity >= 4) {
      this.emit('log', '[SERVICES:BITCOIN] Service started!');
    }

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
