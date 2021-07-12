'use strict';

// Types
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

const NODEA = require('../settings/node-a');
const NODEB = require('../settings/node-b');

// External Dependencies
const jayson = require('jayson');
// For the browser
// ATTN: breaks after 1.0.2
// const bcoin = require('bcoin/lib/bcoin-browser');

// For node...
const bcoin = require('bcoin');
const Actor = require('../types/actor');

// Used to connect to the Bitcoin network directly
const FullNode = bcoin.FullNode;
const NetAddress = bcoin.net.NetAddress;

/**
 * Manages interaction with the Bitcoin network.
 * @module @fabric/core/services/bitcoin
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
      network: 'regtest',
      path: './stores/bitcoin-regtest',
      listen: false,
      fullnode: false,
      nodes: ['127.0.0.1'],
      seeds: ['127.0.0.1'],
      servers: [
        'http://username:password@localhost:18443'
      ],
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
    this.provider = new Consensus({ provider: 'bcoin' });
    this.wallet = new Wallet(this.settings);
    // this.chain = new Chain(this.settings);

    // ## Collections
    // ### Blocks
    this.blocks = new Collection({
      name: 'Block',
      type: BitcoinBlock,
      methods: {
        'create': this._prepareBlock.bind(this)
      },
      listeners: {
        'create': this._handleCommittedBlock.bind(this)
      }
    });

    // ### Transactions
    this.transactions = new Collection({
      name: 'Transaction',
      type: BitcoinTransaction,
      methods: {
        'create': this._prepareTransaction.bind(this)
      },
      listeners: {
        'create': this._handleCommittedTransaction.bind(this)
      }
    });

    if (this.settings.fullnode) {
      let logLevel = 'none';

      if (this.settings.verbosity > 2) {
        logLevel = 'debug';
      }

      this.fullnode = new FullNode({
        network: 'regtest'
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

    // Bitcoin events
    this.peer.on('error', this._handlePeerError.bind(this));
    this.peer.on('packet', this._handlePeerPacket.bind(this));
    // NOTE: we always ask for genesis block on peer open
    this.peer.on('open', () => {
      console.log('PEER IS OPEN:', this);
      // triggers block event
      // pre-seeds genesis block for the rest of us.
      let block = this.peer.getBlock([this.network.genesis.hash]);
      console.log('block recovered:', block);
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

    // Define Bitcoin P2P Messages
    this.define('VersionPacket', { type: 0 });
    this.define('VerAckPacket', { type: 1 });
    this.define('PingPacket', { type: 2 });
    this.define('PongPacket', { type: 3 });
    this.define('SendHeadersPacket', { type: 12 });
    this.define('BlockPacket', { type: 13 });
    this.define('FeeFilterPacket', { type: 21 });
    this.define('SendCmpctPacket', { type: 22 });

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
    return this.fullnode.chain.height;
  }

  async broadcast (msg) {
    console.log('[SERVICES:BITCOIN]', 'Broadcasting:', msg);
    const verify = await msg.verify();
    console.log('[SERVICES:BITCOIN]', 'Verified TX:', verify);

    await this.spv.sendTX(msg);
    // await this.spv.broadcast(msg);
    await this.spv.relay(msg);
    console.log('[SERVICES:BITCOIN]', 'Broadcasted!');
  }

  async _heartbeat () {
    await this._checkRPCBlockNumber();
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
      this.emit('message', `Added block to wallet database, transactions added: ${count}`);
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

    if (!address) address = await this.wallet.getUnusedAddress();

    try {
      block = await this.fullnode.miner.mineBlock(this.fullnode.chain.tip, address);
      // Add the block to our chain
      await this.fullnode.chain.add(block);
    } catch (exception) {
      return this.emit('message', `Could not mine block: ${exception}`);
    }

    return block;
  }

  async generateBlocks (count = 1, address) {
    const blocks = [];

    if (!address) address = await this.wallet.getUnusedAddress();

    // Generate the specified number of blocks
    for (let i = 0; i < count; i++) {
      blocks.push( await this.generateBlock(address) );
    }

    return blocks;
  }

  async append (raw) {
    const block = bcoin.Block.fromRaw(raw, 'hex');
    this.emit('message', `Parsed block: ${JSON.stringify(block)}`);
    const added = await this.fullnode.chain.add(block);
    if (!added) this.emit('message', `Block not added to chain.`);
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

  async _makeRPCRequest (method, params = []) {
    const self = this;
    return new Promise((resolve, reject) => {
      self.rpc.request(method, params, function (err, response) {
        if (err) return reject(err);
        return resolve(response.result);
      });
    });
  }

  async _requestBestBlockHash () {
    return this._makeRPCRequest('getbestblockhash', []);
  }

  async _requestBlock (hash) {
    return this._makeRPCRequest('getblock', [hash]);
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

  async _checkRPCBlockNumber () {
    try {
      const best = await this._requestBestBlockHash();
      if (best !== this.best) {
        this.best = best;
      }
    } catch (exception) {
      this.emit('error', `[${this.settings.name}] Could not make request to RPC host: ${JSON.stringify(exception)}`);
    }
  }

  async _syncBalanceFromOracle () {
    const balance = await this._makeRPCRequest('getbalance');
    this._state.balance = balance;
    this.emit('message', `balance sync: ${balance}`);
    const commit = await this.commit();
    const actor = new Actor(commit.data);
    this.emit('message', `balance sync, commit: ${commit}`);
    return {
      type: 'OracleBalance',
      data: {
        content: balance
      },
      signature: actor.sign().signature
    };
  }

  async _syncWithRPC () {
    const self = this;

    // const genesisID = await self._requestBlockAtHeight(0);
    // const genesis = await self._requestBlock(genesisID);
    const height = await self._requestChainHeight();
    // const best = await self._requestBestBlockHash();

    // TODO: test and verify append() on chain length 0 sets genesis
    /* await self.chain._setGenesis({
      hash: genesisID
    }); */

    for (let i = 0; i <= height; i++) {
      const blockID = await self._requestBlockAtHeight(i);
      const block = await self._requestBlock(blockID);

      const entity = new Entity({
        hash: blockID,
        bits: block.bits,
        nonce: block.nonce,
        time: block.time,
        size: block.size,
        parent: block.previousblockhash,
        weight: block.weight,
        version: block.version
      });

      self.emit('block', Message.fromVector(['BitcoinBlock', {
        type: 'Entity',
        data: entity.data
      }]));

      /* const posted = await self.chain.append({
        hash: blockID,
        bits: block.bits,
        nonce: block.nonce,
        time: block.time,
        size: block.size,
        weight: block.weight,
        version: block.version
      });

      // TODO: subscribe to this event in CLI
      self.emit('message', {
        '@type': 'BlockNotification',
        '@data': posted
      }); */
    }
  }

  /**
   * Start the Bitcoin service, including the initiation of outbound requests.
   */
  async start () {
    if (this.settings.verbosity >= 4) console.log('[SERVICES:BITCOIN]', `Starting for network "${this.settings.network}"...`);
    const self = this;
    self.status = 'starting';

    if (this.store) await this.store.open();
    if (this.settings.fullnode) {
      this.fullnode.on('peer connect', function peerConnectHandler (peer) {
        self.emit('warning', `[SERVICES:BITCOIN]', 'Peer connected to Full Node: ${peer}`);
      });

      this.fullnode.on('block', this._handleBlockMessage.bind(this));
      this.fullnode.on('connect', this._handleConnectMessage.bind(this));

      this.fullnode.on('tx', async function fullnodeTxHandler (tx) {
        self.emit('message', `tx event: ${JSON.stringify(tx)}`);
      });
    }

    this.wallet.on('message', function (msg) {
      self.emit('message', `wallet msg: ${msg}`);
    });

    this.wallet.on('warning', function (msg) {
      self.emit('warning', `wallet warning: ${msg}`);
    });

    this.wallet.on('error', function (msg) {
      self.emit('error', `wallet error: ${msg}`);
    });

    this.wallet.database.on('tx', function (tx) {
      self.emit('message', `wallet tx!!!!!! ${JSON.stringify(tx, null, '  ')}`);
    });

    // Start services
    await this.wallet.start();
    // await this.chain.start();

    // Start nodes
    if (this.settings.fullnode) await this._startLocalNode();
    if (this.settings.mode === 'rpc') {
      const provider = new URL(self.settings.authority);
      const config = {
        host: provider.hostname,
        port: provider.port
      };

      if (provider.protocol === 'https:') {
        const auth = provider.username + ':' + provider.password;
        config.headers = { Authorization: `Basic ${Buffer.from(auth, 'utf8').toString('base64')}` };
        self.rpc = jayson.client.https(config);
      } else {
        self.rpc = jayson.client.http(config);
      }

      try {
        await this._syncBalanceFromOracle();
      } catch (exception) {
        this.emit('error', exception);
        return this;
      }

      self.heartbeat = setInterval(self._heartbeat.bind(self), self.settings.interval);
    }

    // TODO: re-enable these
    // await this._connectToSeedNodes();
    // await this._connectToEdgeNodes();

    // TODO: re-enable SPV
    // await this._connectSPV();

    // this.peer.tryOpen();
    // END TODO

    if (this.settings.fullnode) {
      let genesis = await this.fullnode.getBlock(0);

      // TODO: refactor Chain
      await this.chain._setGenesis(genesis.toJSON());
    }

    this.emit('ready', {
      tip: this.tip
    });

    if (this.settings.verbosity >= 4) console.log('[SERVICES:BITCOIN]', 'Service started!');
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
  }
}

module.exports = Bitcoin;
