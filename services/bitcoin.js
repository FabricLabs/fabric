'use strict';

// Types
const Collection = require('../types/collection');
const Entity = require('../types/entity');
const Service = require('../types/service');
const State = require('../types/state');
const Wallet = require('../types/wallet');
const Consensus = require('../types/consensus');

// Special Types (internal to Bitcoin)
const BitcoinBlock = require('../types/bitcoin/block');
const BitcoinTransaction = require('../types/bitcoin/transaction');

// External Dependencies
// For the browser
// ATTN: breaks after 1.0.2
// const bcoin = require('bcoin/lib/bcoin-browser');

// For node...
const bcoin = require('bcoin');

// Bitcoin types.
const FullNode = bcoin.FullNode;
const NetAddress = bcoin.net.NetAddress;

// Extraneous Dependencies
const pEvent = require('p-event');
// TODO: remove!
// const bclient = require('bclient');

/**
 * Manages interaction with the Bitcoin network.
 */
class Bitcoin extends Service {
  /**
   * Creates an instance of the Bitcoin service.
   * @param {Object} settings Map of configuration options for the Bitcoin service.
   * @param {String} settings.network One of `regtest`, `testnet`, or `mainnet`.
   * @param {Array} settings.nodes List of address:port pairs to trust.
   */
  constructor (settings = {}) {
    super(settings);

    // Internal State
    this.state = {
      blocks: {}
    };

    this.settings = Object.assign({
      name: '@services/bitcoin',
      network: 'main',
      listen: false,
      fullnode: false,
      nodes: ['127.0.0.1'],
      seeds: ['127.0.0.1'],
      port: 18444,
      verbosity: 2
    }, settings);

    if (this.settings.verbosity >= 4) console.log('[DEBUG]', 'Instance of Bitcoin service created, settings:', this.settings);

    bcoin.set(this.settings.network);
    this.network = bcoin.Network.get(this.settings.network);

    // Internal management components
    this.provider = new Consensus({ provider: 'bcoin' });
    this.wallet = new Wallet(this.settings);

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
      console.warn('[SERVICES:BITCOIN]', 'Will run an internal Full Node as "fullnode" has been specified in Service configuration.');
      this.fullnode = new this.provider.FullNode({
        agent: this.UAString,
        port: this.provider.port,
        network: this.settings.network,
        bip37: true, // TODO: verify SPV implementation
        // listen: this.settings.fullnode,
        listen: true,
        http: false,
        httpPort: 19999,
        logLevel: (this.settings.verbosity >= 4) ? 'spam' : 'error',
        memory: true,
        workers: true,
        loader: require,
        maxOutbound: 1
      });
    }

    this.peer = bcoin.Peer.fromOptions({
      agent: this.UAString,
      network: this.settings.network,
      hasWitness: () => {
        return false;
      }
    });

    this.peer.on('error', this._handlePeerError.bind(this));
    this.peer.on('packet', this._handlePeerPacket.bind(this));
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

    this.define('VersionPacket', { type: 0 });
    this.define('VerAckPacket', { type: 1 });
    this.define('PingPacket', { type: 2 });
    this.define('PongPacket', { type: 3 });
    this.define('SendHeadersPacket', { type: 12 });
    this.define('BlockPacket', { type: 13 });
    this.define('FeeFilterPacket', { type: 21 });
    this.define('SendCmpctPacket', { type: 22 });

    return this;
  }

  static get Transaction () {
    return bcoin.TX;
  }

  get UAString () {
    return 'Portal/Bridge 0.1.0-dev (@fabric/core#0.1.0-dev)';
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

  async _prepareBlock (obj) {
    let entity = new Entity(obj);
    return Object.assign({}, obj, {
      // '@fabric/id': entity.id,
      id: entity.id
    });
  }

  /**
   * Prepares a {@link Transaction} for storage.
   * @param {Transaction} obj Transaction to prepare.
   */
  async _prepareTransaction (obj) {
    /* let entity = new Entity(obj);
    return Object.assign({}, obj, {
      id: entity.id
    }); */
    return Object.assign({}, obj);
  }

  /**
   * Receive a committed block.
   * @param {Block} block Block to handle.
   */
  async _handleCommittedBlock (block) {
    // console.log('[FABRIC:BITCOIN]', 'Handling Committed Block:', block);
    for (let i = 0; i < block.transactions.length; i++) {
      let txid = block.transactions[i];
      // console.log('transaction in block:', txid);
      await this.transactions.create({
        hash: txid.toString('hex')
      });
    }

    this.emit('block', block);

    // await this.commit();
  }

  async _handleCommittedTransaction (transaction) {
    // console.log('[SERVICE:BITCOIN]', 'Handling Committed Transaction:', transaction);
    // this.emit('transaction', transaction);
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

  async _handlePeerFromSPV (msg) {
    console.log('[SERVICES:BITCOIN]', 'Peer message ("peer") from SPV:', msg);
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

    let transaction = await this.transactions.create({
      formats: {
        bitcoin: {
          hash: tx.hash('hex'),
          raw: tx.toRaw()
        }
      }
    });
    console.log('created transaction:', transaction);

    let msg = {
      '@type': 'BitcoinTransaction',
      '@data': {
        hash: tx.hash('hex'),
        inputs: tx.inputs,
        outputs: tx.outputs,
        tx: tx
      }
    };

    // this.emit('transaction', msg);
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
      if (this.settings.verbosity >= 4) console.log('[FABRIC:WALLET]', '[DEBUG]', `[@0x${slice.string}] === ${slice.string}`);
      this.spv.pool.watchAddress(address);
    }
  }

  /**
   * Initiate outbound connections to configured SPV nodes.
   */
  async _connectSPV () {
    console.log('[SERVICES:BITCOIN]', 'Connecting SPV node...');

    await this.spv.open();
    await this.spv.connect();

    // subscribe to shard...
    await this._subscribeToShard(this.wallet.shard);

    // bind listeners...
    this.spv.on('tx', this._handleTransactionFromSPV.bind(this));
    this.spv.on('block', this._handleBlockFromSPV.bind(this));
    this.spv.on('peer', this._handlePeerFromSPV.bind(this));

    console.log('[SERVICES:BITCOIN]', 'SPV node peers BEFORE connection:', this.spv.pool.peers.head());

    // get peer from known address
    let addr = new NetAddress({
      host: '127.0.0.1',
      // port: 18444
      // port: this.fullnode.pool.options.port
      // port: this.spv.pool.options.port
      port: this.provider.port
    });

    // connect this.spv with fullNode
    let peer = this.spv.pool.createOutbound(addr);
    if (this.settings.verbosity >= 4) console.log('[SERVICES:BITCOIN]', 'Peer connection created:', peer);

    // Add the created peer to our pool
    this.spv.pool.peers.add(peer);

    // await to establish connection
    let connected  = await pEvent(this.spv.pool, 'peer connect');
    // nodes are now connected!
    console.log('[SERVICES:BITCOIN]', 'Event "peer connect" received:', connected);
    console.log('[SERVICES:BITCOIN]', 'SPV node peers AFTER connection:', this.spv.pool.peers.head());

    /*
      // TODO: test TX broadcast and receive

    // broadcast a tx that DOESN'T pay out to SPV node's watch address
    const tx1 = bcoin.TX.fromRaw('01000000011d06bce42b67f1de811a3444353fab5d400d82728a5bbf9c89978be37ad3eba9000000006a47304402200de4fd4ecc365ea90f93dbc85d219d7f1bd92ec8743648acb48b6602977e0b4302203ca2eeabed8e6f457234652a92711d66dd8eda71ed90fb6c49b3c12ce809a5d401210257654e1b0de2d8b08d514e51af5d770e9ef617ca2b254d84dd26685fbc609ec3ffffffff0280969800000000001976a914a4ecde9642f8070241451c5851431be9b658a7fe88acc4506a94000000001976a914b9825cafc838c5b5befb70ecded7871d011af89d88ac00000000', 'hex');
    await this.fullnode.sendTX(tx1);
    // broadcast a tx that pays out to SPV node's watch address
    const tx2 = bcoin.TX.fromRaw('010000000106b014e37704109fefe2c5c9f4227d68840c3497fc89a9832db8504df039a6c7000000006a47304402207dc8173fbd7d23c3950aaf91b1bc78c0ed9bf910d47a977b24a8478a91b28e69022024860f942a16bc67ec54884e338b5b87f4a9518a80f9402564061a3649019319012103cb25dc2929ea58675113e60f4c08d084904189ab44a9a142179684c6cdd8d46affffffff0280c3c901000000001976a91400ba915c3d18907b79e6cfcd8b9fdf69edc7a7db88acc41c3c28010000001976a91437f306a0154e1f0de4e54d6cf9d46e07722b722688ac00000000', 'hex');
    this.fullnode.sendTX(tx2);

    // await for the second transaction to be received by the SPV node
    await pEvent(this.spv, 'tx');
    */

    // start the SPV node's blockchain sync
    await this.spv.startSync();

    console.log('[SERVICES:BITCOIN]', 'SPV node connect done!');
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
        console.log('PEER IS OPEN:', this);
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
    console.log('[SERVICES:BITCOIN]', 'Starting fullnode for network "', this.settings.network, '"...');

    try {
      await this.fullnode.ensure();
    } catch (exception) {
      console.error('[SERVICES:BITCOIN]', 'Could not ensure log directry for local Full Node:', exception);
    }

    try {
      await this.fullnode.open();
    } catch (exception) {
      console.error('[SERVICES:BITCOIN]', 'Could not "open" local Full Node:', exception);
    }

    try {
      await this.fullnode.connect();
    } catch (exception) {
      console.error('[SERVICES:BITCOIN]', 'Could not "connect" local Full Node:', exception);
    }

    console.log('[SERVICES:BITCOIN]', 'Full Node opened and connected!');
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

  /**
   * Start the Bitcoin service, including the initiation of outbound requests.
   */
  async start () {
    if (this.settings.verbosity >= 4) console.log('[SERVICES:BITCOIN]', `Starting for network "${this.settings.network}"...`);

    try {
      await this.wallet.start();
    } catch (exception) {
      console.error('[SERVICES:BITCOIN]', 'Could not start Service Wallet:', exception);
    }

    await this._startLocalNode();
    // await this._connectToSeedNodes();
    // await this._connectToEdgeNodes();
    await this._connectSPV();
    // this.peer.tryOpen();

    if (this.settings.verbosity >= 4) console.log('[SERVICES:BITCOIN]', 'Service started!');
    return this;
  }

  /**
   * Stop the Bitcoin service.
   */
  async stop () {
    console.log('[SERVICES:BITCOIN]', 'Stopping Bitcoin service...');

    try {
      await this.spv.disconnect();
      await this.spv.stop();
    } catch (exception) {
      console.error('[SERVICES:BITCOIN]', 'Could not stop SPV node:', exception);
    }

    try {
      await this.fullnode.disconnect();
      await this.fullnode.stop();
    } catch (exception) {
      console.error('[SERVICES:BITCOIN]', 'Could not stop full node:', exception);
    }

    try {
      await this.peer.disconnect();
    } catch (exception) {
      console.error('[SERVICES:BITCOIN]', 'Could not stop peer:', exception);
    }

    try {
      await this.wallet.stop();
    } catch (exception) {
      console.error('[SERVICES:BITCOIN]', 'Could not stop Wallet:', exception);
    }
  }
}

module.exports = Bitcoin;
