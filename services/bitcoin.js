'use strict';

const {
  BITCOIN_GENESIS,
  BITCOIN_GENESIS_HASH,
  FABRIC_USER_AGENT
} = require('../constants');

const OP_TRACE = require('../contracts/trace');

// Dependencies
const crypto = require('crypto');
const children = require('child_process');

// External Dependencies
const jayson = require('jayson/lib/client');
const monitor = require('fast-json-patch');
const { mkdirp } = require('mkdirp');

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

    // Local Settings
    this.settings = Object.assign({
      name: '@services/bitcoin',
      mode: 'fabric',
      genesis: BITCOIN_GENESIS,
      network: 'mainnet',
      path: './stores/bitcoin',
      mining: false,
      listen: false,
      fullnode: false,
      managed: false,
      constraints: {
        storage: {
          size: 550 // size in MB
        }
      },
      spv: {
        port: 18332
      },
      zmq: {
        host: 'localhost',
        port: 29500
      },
      state: {
        actors: {},
        blocks: {}, // Map of blocks by block hash
        height: 0,
        tip: BITCOIN_GENESIS_HASH,
        transactions: {}, // Map of transactions by txid
        addresses: {}, // Map of addresses to their transactions
        walletIndex: 0, // Current address index
        supply: 0
      },
      nodes: ['127.0.0.1'],
      seeds: ['127.0.0.1'],
      servers: [],
      targets: [],
      peers: [],
      port: 18333, // P2P port
      rpcport: 18332, // RPC port
      interval: 60000, // 10 * 60 * 1000, // every 10 minutes, write a checkpoint
      verbosity: 2
    }, settings);

    // Initialize network configurations
    this._networkConfigs = {
      mainnet: bitcoin.networks.bitcoin,
      testnet: bitcoin.networks.testnet,
      regtest: bitcoin.networks.regtest
    };

    if (this.settings.debug && this.settings.verbosity >= 4) console.debug('[DEBUG]', 'Instance of Bitcoin service created, settings:', this.settings);

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

    this.zmq = new ZMQ(this.settings.zmq);

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
      content: this.settings.state,
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

  get network () {
    return this.settings.network;
  }

  get networks () {
    return this._networkConfigs;
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

  get supply () {
    return this._state.content.supply;
  }

  createRPCAuth (settings = {}) {
    if (!settings.username) throw new Error('Username is required.');
    const username = settings.username;
    const password = settings.password || crypto.randomBytes(32).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    const salt = crypto.randomBytes(16).toString('hex');
    const salted = crypto.createHmac('sha256', salt, { encoding: 'utf8' }).update(password, 'utf8').digest('hex');
    return {
      content: `${username}:${salt}$${salted}`,
      password: password,
      username: username
    };
  }

  validateAddress (address) {
    try {
      // Get the correct network configuration
      const network = this.networks[this.settings.network];
      if (!network) {
        throw new Error(`Invalid network: ${this.settings.network}`);
      }

      // Try to convert the address to an output script
      bitcoin.address.toOutputScript(address, network);
      return true;
    } catch (e) {
      if (this.settings.debug) {
        console.debug('[FABRIC:BITCOIN]', 'Address validation failed:', e.message);
      }
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
    console.debug('[SERVICES:BITCOIN]', 'Broadcasting:', msg);
    const verify = await msg.verify();
    console.debug('[SERVICES:BITCOIN]', 'Verified TX:', verify);

    await this.spv.sendTX(msg);
    // await this.spv.broadcast(msg);
    await this.spv.relay(msg);
    console.debug('[SERVICES:BITCOIN]', 'Broadcasted!');
  }

  async processSpendMessage (message) {
    return this._processSpendMessage(message);
  }

  async _processRawBlock (raw) {
    const block = bcoin.Block.fromRaw(raw);
    console.debug('rawBlock:', block);
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
    console.debug('WARNING [!!!]: double check that:', `${obj.headers.hash('hex')} === ${hash}`);

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

    // Track transactions for each address
    if (obj.inputs) {
      for (let input of obj.inputs) {
        if (input.address && this.settings.state.addresses[input.address]) {
          this.settings.state.addresses[input.address].transactions.push(obj.hash);
        }
      }
    }

    if (obj.outputs) {
      for (let output of obj.outputs) {
        if (output.address && this.settings.state.addresses[output.address]) {
          this.settings.state.addresses[output.address].transactions.push(obj.hash);
        }
      }
    }

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
    console.debug('[SERVICES:BITCOIN]', 'Peer sent packet:', msg);

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

        console.debug('registered block:', block);
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
        console.debug('regtest tx:', transaction);
        break;
    }

    console.debug('[SERVICES:BITCOIN]', 'State:', this.state);
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

    // Update state with new block
    this._state.content.blocks[block.hash] = block;

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

    // Update state with new transaction
    this._state.content.transactions[tx.hash('hex')] = msg['@data'];

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

    try {
      // Try to create wallet first
      await this._makeRPCRequest('createwallet', [
        actor.id,
        false,
        false, // blank (use sethdseed)
        '', // passphrase
        true, // avoid reuse
        false, // descriptors
      ]);

      // Load the wallet
      await this._makeRPCRequest('loadwallet', [actor.id]);

      // Get addresses
      try {
        this.addresses = await this._listAddresses();
      } catch (exception) {
        if (this.settings.debug) console.debug('[FABRIC:BITCOIN]', 'Error listing addresses:', exception.message);
        this.addresses = [];
      }

      // If no addresses, generate one
      if (!this.addresses || !this.addresses.length) {
        const address = await this.getUnusedAddress();
        this.addresses = [address];
      }

      return {
        id: actor.id
      };
    } catch (error) {
      if (this.settings.debug) console.debug('[FABRIC:BITCOIN]', 'Error loading wallet:', error.message);
      throw error;
    }
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
    if (this.settings.verbosity >= 5) console.debug('[AUDIT]', 'Starting ZMQ service...');
    this.zmq.on('log', (msg) => {
      if (this.settings.debug) console.log('[ZMQ]', msg);
    });

    this.zmq.on('message', async (msg) => {
      let topic, content;

      // Handle both raw ZMQ messages and Message objects
      if (Array.isArray(msg)) {
        // Raw ZMQ message format
        topic = msg[0].toString();
        content = msg[1];
      } else if (msg && typeof msg === 'object') {
        // Message object format
        topic = msg.type;
        content = msg.data;
      } else {
        console.error('[BITCOIN]', 'Invalid message format:', msg);
        return;
      }

      if (this.settings.debug) this.emit('debug', '[ZMQ] Received message on topic:', topic, 'Message length:', content.length);

      try {
        switch (topic) {
          case 'GenericMessage':
            // Handle generic message
            if (this.settings.verbosity >= 5) console.log('[AUDIT]', 'Received generic message:', content.toString());
            console.debug('current state:', this.state);
            break;
          case 'hashblock':
            // Update state with block hash (reversed byte order)
            const blockHash = content.toString('hex');
            this._state.content.blocks[blockHash] = {
              hash: blockHash,
              raw: null,
              timestamp: Date.now()
            };
            if (this.settings.verbosity >= 5) console.log('[AUDIT]', 'Received block hash:', blockHash);
            break;
          case 'rawblock':
            // Update state with full block data
            const block = await this.blocks.create({
              hash: content.hash('hex'),
              parent: content.prevBlock.toString('hex'),
              transactions: content.txs.map(tx => tx.hash('hex')),
              block: content,
              raw: content.toRaw().toString('hex'),
              timestamp: Date.now()
            });
            this._state.content.blocks[block.hash] = block;
            if (this.settings.verbosity >= 5) console.log('[AUDIT]', 'Received raw block:', block.hash);
            break;
          case 'hashtx':
            // Update state with transaction hash (reversed byte order)
            const txHash = content.toString('hex');
            if (!this._state.content.transactions[txHash]) {
              this._state.content.transactions[txHash] = {
                hash: txHash,
                raw: null,
                timestamp: Date.now()
              };
            }
            if (this.settings.verbosity >= 5) console.log('[AUDIT]', 'Received transaction hash:', txHash);
            break;
          case 'rawtx':
            // Update state with full transaction data
            const tx = {
              hash: content.hash('hex'),
              inputs: content.inputs,
              outputs: content.outputs,
              tx: content,
              raw: content.toRaw().toString('hex'),
              timestamp: Date.now()
            };
            this._state.content.transactions[tx.hash] = tx;
            if (this.settings.verbosity >= 5) console.log('[AUDIT]', 'Received raw transaction:', tx.hash);
            break;
          default:
            if (this.settings.verbosity >= 5) console.log('[AUDIT]', 'Unknown ZMQ topic:', topic);
        }
      } catch (exception) {
        this.emit('error', `Could not process ZMQ message: ${exception}`);
      }
    });

    this.zmq.on('error', (err) => {
      console.error('[ZMQ] Error:', err);
    });

    this.zmq.on('connect', () => {
      console.log('[ZMQ] Connected to Bitcoin node');
    });

    this.zmq.on('disconnect', () => {
      console.log('[ZMQ] Disconnected from Bitcoin node');
    });

    await this.zmq.start();
    if (this.settings.debug) console.log('[AUDIT]', 'ZMQ Started.');
  }

  async generateBlock (address) {
    if (!address) address = await this.getUnusedAddress();

    switch (this.settings.mode) {
      case 'rpc':
        const result = await this._makeRPCRequest('generatetoaddress', [1, address]);
        return result[0];
      case 'fabric':
        // In fabric mode, we just increment the height and return a mock block hash
        this.settings.state.height++;
        const mockHash = crypto.createHash('sha256').update(`${this.settings.state.height}`).digest('hex');
        this.settings.state.tip = mockHash;
        return mockHash;
      default:
        throw new Error('Invalid mode for block generation');
    }
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
    } else if (this.settings.key) {
      // In fabric mode, use the provided key to derive an address
      const target = this.settings.key.deriveAddress(this.settings.state.walletIndex);
      // Increment the index for next time
      this.settings.state.walletIndex++;
      // Track the address
      this.settings.state.addresses[target.address] = {
        index: this.settings.state.walletIndex - 1,
        transactions: []
      };
      return target.address;
    } else {
      // If no key is provided, generate a new key for regtest
      const key = new Key({
        network: this.settings.network,
        purpose: 44,
        account: 0,
        index: this.settings.state.walletIndex
      });
      this.settings.key = key;
      const target = key.deriveAddress(this.settings.state.walletIndex);
      this.settings.state.walletIndex++;
      this.settings.state.addresses[target.address] = {
        index: this.settings.state.walletIndex - 1,
        transactions: []
      };
      return target.address;
    }
  }

  async append (raw) {
    const block = bcoin.Block.fromRaw(raw, 'hex');
    if (this.settings.debug) this.emit('debug', `Parsed block: ${JSON.stringify(block)}`);
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
    if (this.settings.mode === 'fabric') {
      // In fabric mode, handle requests locally
      switch (method) {
        case 'getnewaddress':
          if (this.settings.key) {
            const target = this.settings.key.deriveAddress(this.settings.state.walletIndex);
            this.settings.state.walletIndex++;
            this.settings.state.addresses[target.address] = {
              index: this.settings.state.walletIndex - 1,
              transactions: []
            };
            return target.address;
          }
          throw new Error('No key provided for address generation in fabric mode');
        case 'validateaddress':
          return { isvalid: this.validateAddress(params[0]) };
        case 'getblockchaininfo':
          return { blocks: this.settings.state.height };
        case 'getblockcount':
          return this.settings.state.height;
        case 'getbestblockhash':
          return this.settings.state.tip;
        case 'listunspent':
          return [];
        default:
          if (this.settings.managed) {
            // Allow RPC request to be sent in managed mode
            break;
          }
          throw new Error(`Method ${method} not implemented in fabric mode`);
      }
    }

    if (this.settings.debug) console.debug('[FABRIC:BITCOIN]', `Making RPC request: ${method}(${JSON.stringify(params)})`);
    return new Promise((resolve, reject) => {
      if (!this.rpc) {
        const error = new Error('RPC manager does not exist');
        if (this.settings.debug) console.debug('[FABRIC:BITCOIN]', 'RPC request failed:', error.message);
        return reject(error);
      }
      try {
        this.rpc.request(method, params, (err, response) => {
          if (err) {
            if (this.settings.debug) console.debug('[FABRIC:BITCOIN]', 'RPC request failed:', err);
            // Handle different types of errors
            if (err.error) {
              try {
                // If err.error is a string, try to parse it as JSON
                const errorObj = typeof err.error === 'string' ? JSON.parse(err.error) : err.error;
                return reject(new Error(errorObj.message || errorObj.error || JSON.stringify(errorObj)));
              } catch (parseError) {
                // If parsing fails, use the original error
                return reject(new Error(err.error));
              }
            }
            return reject(new Error(err.message || err));
          }
          if (this.settings.debug) console.debug('[FABRIC:BITCOIN]', `RPC response for ${method}:`, response.result);
          return resolve(response.result);
        });
      } catch (exception) {
        if (this.settings.debug) console.debug('[FABRIC:BITCOIN]', 'RPC request failed with exception:', exception);
        return reject(new Error(`RPC request failed: ${exception.message}`));
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
    try {
      const hash = await this._makeRPCRequest('getbestblockhash', []);
      this.best = hash;
      await this.commit();
      return this.best;
    } catch (error) {
      if (this.settings.debug) console.debug('[FABRIC:BITCOIN]', 'Error requesting best block hash:', error.message);
      throw error;
    }
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

    // Get the correct network configuration
    const network = this.networks[this.settings.network];
    if (!network) {
      throw new Error(`Invalid network: ${this.settings.network}`);
    }

    const psbt = new bitcoin.Psbt({ network });

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
      try {
        const script = bitcoin.address.toOutputScript(output.address, network);
        const data = {
          script,
          value: output.value
        };

        psbt.addOutput(data);
      } catch (e) {
        if (this.settings.debug) {
          console.debug('[FABRIC:BITCOIN]', 'Failed to add output:', e.message);
        }
        throw new Error(`Invalid address ${output.address}: ${e.message}`);
      }
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
    try {
      const best = await this._requestBestBlockHash();
      this.best = best;
      await this.commit();
      return this.best;
    } catch (error) {
      if (this.settings.debug) console.debug('[FABRIC:BITCOIN]', 'Error syncing best block hash:', error.message);
      throw error;
    }
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
    if (this.settings.debug) this.emit('debug', `raw headers[${hash}] = ${JSON.stringify(header)}`);
    return this;
  }

  async _syncHeadersForBlock (hash) {
    const header = await this._requestBlockHeader(hash);
    this.headers[hash] = header;
    if (this.settings.debug) this.emit('debug', `headers[${hash}] = ${JSON.stringify(header)}`);
    this.commit();
    return this;
  }

  async _syncChainHeadersOverRPC () {
    const start = Date.now();

    let last = 0;
    let rate = 0;
    let before = 0;

    for (let i = 0; i <= this.height; i++) {
      if (this.settings.debug) this.emit('debug', `Getting block headers: ${i} of ${this.height}`);

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

        if (this.settings.debug) this.emit('debug', `timing: epochs[${epoch}] ${now} ${i} processed @ ${rate}/sec (${progress/1000}s elapsed)`);
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
    // await this._syncChainHeadersOverRPC(this.best);
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
    try {
      await this._syncChainOverRPC();
      await this.commit();
    } catch (error) {
      console.error('[FABRIC:BITCOIN]', 'Sync failed:', error.message);
      throw error;
    }
    return this;
  }

  async _isBitcoindOnline () {
    try {
      // Try to get blockchain info - this will fail if bitcoind is not ready
      await this._makeRPCRequest('getblockchaininfo', []);
      return true;
    } catch (error) {
      if (this.settings.debug) console.debug('[FABRIC:BITCOIN]', 'Bitcoind not yet ready:', error.message);
      return false;
    }
  }

  async _waitForBitcoind (maxAttempts = 30, initialDelay = 1000) {
    if (this.settings.debug) console.debug('[FABRIC:BITCOIN]', 'Waiting for bitcoind to be ready...');
    let attempts = 0;
    let delay = initialDelay;

    while (attempts < maxAttempts) {
      try {
        if (this.settings.debug) console.debug('[FABRIC:BITCOIN]', `Attempt ${attempts + 1}/${maxAttempts} to connect to bitcoind...`);

        // Check multiple RPC endpoints to ensure full readiness
        const checks = [
          this._makeRPCRequest('getblockchaininfo'),
          this._makeRPCRequest('getnetworkinfo')
        ];

        // Wait for all checks to complete
        const results = await Promise.all(checks);

        if (this.settings.debug) {
          console.debug('[FABRIC:BITCOIN]', 'Successfully connected to bitcoind:');
          console.debug('[FABRIC:BITCOIN]', '- Blockchain info:', results[0]);
          console.debug('[FABRIC:BITCOIN]', '- Network info:', results[1]);
        }

        return true;
      } catch (error) {
        if (this.settings.debug) console.debug('[FABRIC:BITCOIN]', `Connection attempt ${attempts + 1} failed:`, error.message);
        attempts++;

        // If we've exceeded max attempts, throw error
        if (attempts >= maxAttempts) {
          throw new Error(`Failed to connect to bitcoind after ${maxAttempts} attempts: ${error.message}`);
        }

        // Wait before next attempt with exponential backoff
        await new Promise(resolve => setTimeout(resolve, delay));
        delay = Math.min(delay * 1.5, 10000); // Exponential backoff with max 10s delay
        continue; // Continue to next attempt
      }
    }

    // Should never reach here due to maxAttempts check in catch block
    throw new Error('Failed to connect to bitcoind: Max attempts exceeded');
  }

  async createLocalNode () {
    if (this.settings.debug) console.debug('[FABRIC:BITCOIN]', 'Creating local node...');
    let datadir = './stores/bitcoin';

    // TODO: use RPC auth
    const params = [
      `-port=${this.settings.port}`,
      '-rpcbind=127.0.0.1',
      `-rpcport=${this.settings.rpcport}`,
      '-server',
      '-zmqpubrawblock=tcp://127.0.0.1:29500',
      '-zmqpubrawtx=tcp://127.0.0.1:29500',
      '-zmqpubhashtx=tcp://127.0.0.1:29500',
      '-zmqpubhashblock=tcp://127.0.0.1:29500'
    ];

    if (this.settings.debug) console.debug('[FABRIC:BITCOIN]', 'Bitcoind parameters:', params);
    if (this.settings.username && this.settings.password) {
      params.push(`-rpcuser=${this.settings.username}`);
      params.push(`-rpcpassword=${this.settings.password}`);
    } else {
      const username = crypto.randomBytes(16).toString('hex');
      const auth = this.createRPCAuth({ username });
      this.settings.username = auth.username;
      this.settings.password = auth.password;
      this.settings.authority = `http://${this.settings.username}:${this.settings.password}@127.0.0.1:${this.settings.rpcport}`;
      params.push(`-rpcauth=${auth.content}`);
    }

    // Configure network
    switch (this.settings.network) {
      default:
      case 'mainnet':
        datadir = (this.settings.constraints.storage.size) ? './stores/bitcoin-pruned' : './stores/bitcoin';
        break;
      case 'testnet':
        datadir = './stores/bitcoin-testnet';
        params.push('-testnet');
        break;
      case 'testnet4':
        datadir = './stores/bitcoin-testnet4';
        params.push('-testnet4');
        break;
      case 'regtest':
        datadir = './stores/bitcoin-regtest';
        params.push('-regtest');
        break;
      case 'playnet':
        datadir = './stores/bitcoin-playnet';
        break;
    }

    if (this.settings.datadir) {
      datadir = this.settings.datadir;
      if (this.settings.debug) console.debug('[FABRIC:BITCOIN]', 'Using custom datadir:', datadir);
    }

    if (this.settings.debug) console.debug('[FABRIC:BITCOIN]', 'Using datadir:', datadir);

    // If storage constraints are set, prune the blockchain
    if (this.settings.constraints.storage.size) {
      params.push(`-prune=${this.settings.constraints.storage.size}`);
    } else {
      params.push(`-txindex`);
    }

    // Set data directory
    params.push(`-datadir=${datadir}`);

    // Start bitcoind
    if (this.settings.managed) {
      // Ensure storage directory exists
      await mkdirp(datadir);
      if (this.settings.debug) console.debug('[FABRIC:BITCOIN]', 'Storage directory created:', datadir);

      // Spawn process
      if (this.settings.debug) console.debug('[FABRIC:BITCOIN]', 'Spawning bitcoind process...');
      const child = children.spawn('bitcoind', params);

      // Store the child process reference
      this._nodeProcess = child;

      // Handle process events
      child.stdout.on('data', (data) => {
        if (this.settings.debug) console.debug('[FABRIC:BITCOIN]', 'bitcoind stdout:', data.toString('utf8').trim());
        if (this.settings.debug) this.emit('debug', `[FABRIC:BITCOIN] ${data.toString('utf8').trim()}`);
      });

      child.stderr.on('data', (data) => {
        console.error('[FABRIC:BITCOIN]', '[ERROR]', data.toString('utf8').trim());
        this.emit('error', `[FABRIC:BITCOIN] ${data.toString('utf8').trim()}`);
      });

      child.on('close', (code) => {
        if (this.settings.debug) console.debug('[FABRIC:BITCOIN]', 'Bitcoin Core exited with code ' + code);
        this.emit('log', `[FABRIC:BITCOIN] Bitcoin Core exited with code ${code}`);
        this._nodeProcess = null;
      });

      child.on('error', (err) => {
        console.error('[FABRIC:BITCOIN]', 'Bitcoin Core process error:', err);
        this.emit('error', `[FABRIC:BITCOIN] Bitcoin Core process error: ${err}`);
        // Attempt to restart the process
        // this._restartBitcoind();
      });

      // Add cleanup handlers
      const cleanup = async () => {
        if (this._nodeProcess) {
          try {
            console.debug('[FABRIC:BITCOIN]', 'Cleaning up Bitcoin node...');
            this._nodeProcess.kill();
            await new Promise(resolve => {
              this._nodeProcess.on('close', () => resolve());
            });
          } catch (e) {
            console.error('[FABRIC:BITCOIN]', 'Error during cleanup:', e);
          }
        }
      };

      // Handle process termination signals
      process.on('SIGINT', cleanup);
      process.on('SIGTERM', cleanup);
      process.on('exit', cleanup);

      // Handle uncaught exceptions
      process.on('uncaughtException', async (err) => {
        console.error('[FABRIC:BITCOIN]', 'Uncaught exception:', err);
        await cleanup();
        this.emit('error', err);
      });

      // Handle unhandled promise rejections
      process.on('unhandledRejection', async (reason, promise) => {
        console.error('[FABRIC:BITCOIN]', 'Unhandled rejection at:', promise, 'reason:', reason);
        // await cleanup();
        this.emit('error', reason);
      });

      // Initialize RPC client
      const config = {
        host: '127.0.0.1',
        port: this.settings.rpcport,
        timeout: 300000 // 5 minute timeout for heavy operations
      };

      const auth = `${this.settings.username}:${this.settings.password}`;
      config.headers = { Authorization: `Basic ${Buffer.from(auth, 'utf8').toString('base64')}` };

      this.rpc = jayson.http(config);

      // Wait for bitcoind to be fully online
      await this._waitForBitcoind();

      return child;
    } else {
      return null;
    }
  }

  /**
   * Start the Bitcoin service, including the initiation of outbound requests.
   */
  async start () {
    this.emit('debug', `[SERVICES:BITCOIN] Starting for network "${this.settings.network}"...`);
    this.status = 'STARTING';

    // Create and wait for local node only if managed mode is enabled
    if (this.settings.managed) {
      const node = await this.createLocalNode();
      if (!node) {
        throw new Error('Failed to create local Bitcoin node');
      }
    }

    // Bitcoin events
    if (this.peer) {
      this.peer.on('error', this._handlePeerError.bind(this));
      this.peer.on('packet', this._handlePeerPacket.bind(this));
      this.peer.on('open', () => {
        let block = this.peer.getBlock([this.network.genesis.hash]);
      });
    }

    if (this.store) await this.store.open();

    // Set up wallet event handlers
    this.wallet.on('message', (msg) => {
      this.emit('log', `wallet msg: ${msg}`);
    });

    this.wallet.on('log', (msg) => {
      this.emit('log', `wallet log: ${msg}`);
    });

    this.wallet.on('warning', (msg) => {
      this.emit('warning', `wallet warning: ${msg}`);
    });

    this.wallet.on('error', (msg) => {
      this.emit('error', `wallet error: ${msg}`);
    });

    if (this.wallet.database) {
      this.wallet.database.on('tx', (tx) => {
        this.emit('debug', `wallet tx!!!!!! ${JSON.stringify(tx, null, '  ')}`);
      });
    }

    this.observer = monitor.observe(this._state.content);

    // Handle RPC mode
    if (this.settings.mode === 'rpc') {
      // If deprecated setting `authority` is provided, compose settings
      if (this.settings.authority) {
        const url = new URL(this.settings.authority);

        // Assign all parameters
        this.settings.username = url.username;
        this.settings.password = url.password;
        this.settings.host = url.hostname;
        this.settings.port = url.port;
        this.settings.secure = (url.protocol === 'https:') ? true : false;
      }

      const authority = `http${(this.settings.secure == true) ? 's': ''}://${this.settings.username}:${this.settings.password}@${this.settings.host}:${this.settings.rpcport}`;
      const provider = new URL(authority);
      const config = {
        host: provider.hostname,
        port: provider.port,
        timeout: 300000 // 5 minute timeout for heavy operations
      };

      const auth = provider.username + ':' + provider.password;
      config.headers = { Authorization: `Basic ${Buffer.from(auth, 'utf8').toString('base64')}` };

      if (provider.protocol === 'https:') {
        this.rpc = jayson.https(config);
      } else {
        this.rpc = jayson.http(config);
      }

      // Wait for bitcoind to be fully online
      await this._waitForBitcoind();
    }

    // Start services
    // await this.wallet.start();

    // Start ZMQ if enabled
    if (this.settings.zmq) await this._startZMQ();

    // Handle RPC mode operations
    if (this.settings.mode === 'rpc') {
      const wallet = await this._loadWallet();
      this._heart = setInterval(this.tick.bind(this), this.settings.interval);
      await this._syncWithRPC();
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
    if (this.settings.debug) console.debug('[FABRIC:BITCOIN]', 'Stopping Bitcoin service...');

    // Remove all event listeners
    this.removeAllListeners();

    // Stop the heartbeat interval if it exists
    if (this._heart) {
      clearInterval(this._heart);
      delete this._heart;
    }

    // Stop the wallet
    if (this.wallet) {
      if (this.settings.debug) console.debug('[FABRIC:BITCOIN]', 'Stopping wallet...');
      await this.wallet.stop();
    }

    // Stop the ZMQ service
    if (this.zmq) {
      if (this.settings.debug) console.debug('[FABRIC:BITCOIN]', 'Stopping ZMQ...');
      await this.zmq.stop();
    }

    // Kill the Bitcoin node process if it exists
    if (this._nodeProcess) {
      if (this.settings.debug) console.debug('[FABRIC:BITCOIN]', 'Killing Bitcoin node process...');
      try {
        this._nodeProcess.kill('SIGKILL');
      } catch (error) {
        console.error('[FABRIC:BITCOIN]', 'Error killing process:', error);
      }
      this._nodeProcess = null;
    }

    if (this.settings.debug) console.debug('[FABRIC:BITCOIN]', 'Service stopped');
    return this;
  }

  // Add cleanup method
  async cleanup () {
    console.log('[FABRIC:BITCOIN]', 'Cleaning up...');
    await this.stop();
    // Remove process event listeners
    process.removeAllListeners('uncaughtException');
    process.removeAllListeners('unhandledRejection');
    console.log('[FABRIC:BITCOIN]', 'Cleanup complete');
  }

  async getRootKeyAddress () {
    if (!this.settings.key) {
      throw new Error('No key provided for mining');
    }
    const rootKey = this.settings.key;
    const address = rootKey.deriveAddress(0, 0, 'p2pkh');
    return address.address;
  }

  async generateBlock () {
    if (!this.rpc) {
      throw new Error('RPC must be available to generate blocks');
    }

    const rootAddress = await this.getRootKeyAddress();
    await this._makeRPCRequest('generatetoaddress', [1, rootAddress]);
    return this._syncBestBlock();
  }
}

module.exports = Bitcoin;
