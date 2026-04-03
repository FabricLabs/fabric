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
const fs = require('fs');
const path = require('path');

// External Dependencies
const jayson = require('jayson/lib/client');
const monitor = require('fast-json-patch');
const { mkdirp } = require('mkdirp');
const fetch = require('cross-fetch');

// crypto support libraries
// Use noble-curves-backed ECC shim instead of tiny-secp256k1
const ecc = require('../types/ecc');
const bip65 = require('bip65');
const bip68 = require('bip68');
const bitcoin = require('bitcoinjs-lib');

// Initialize bitcoinjs-lib with the ECC library
bitcoin.initEccLib(ecc);

// Services
const ZMQ = require('../services/zmq');

// Types
const Actor = require('../types/actor');
const Collection = require('../types/collection');
const Entity = require('../types/entity');
const Key = require('../types/key');
const Service = require('../types/service');
const State = require('../types/state');
const Wallet = require('../types/wallet');

// Special Types (internal to Bitcoin)
const BitcoinBlock = require('../types/bitcoin/block');
const BitcoinTransaction = require('../types/bitcoin/transaction');

function redactSensitiveCommandArg (arg) {
  return String(arg).replace(
    /((?:--?rpcpassword|--?rpcuser|--?rpcauth|--bitcoin-rpcpassword|--bitcoin-rpcuser)=).*/i,
    '$1[REDACTED]'
  );
}

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
      listen: true,
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
      // Optional HTTP origin for block/tx/address REST fallback (e.g. a Hub). Null = RPC only.
      explorerBaseUrl: null,
      zmq: {
        host: 'localhost',
        port: 29500
      },
      key: {
        mnemonic: null,
        seed: null,
        xprv: null,
        xpub: null,
        passphrase: null
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
      // After RPC is ready, call `addnode <host:port> add` for each entry (outbound P2P only).
      // Used for LAN "playnet" regtest sync. Ignored on mainnet unless p2pAddNodesAllowMainnet is true.
      p2pAddNodes: [],
      // When true, p2pAddNodes is applied even on mainnet (private deployments only).
      p2pAddNodesAllowMainnet: false,
      host: '127.0.0.1',
      port: 8333, // P2P port
      rpcport: 8332, // RPC port
      interval: 60000, // 10 * 60 * 1000, // every 10 minutes, write a checkpoint
      verbosity: 2,
      /** When true, flushChainToSnapshot is allowed on mainnet (dangerous). */
      flushChainAllowUnsafeNetworks: false,
      /** Safety cap for repeated `invalidateblock` steps when rewinding to a snapshot tip. */
      flushChainMaxSteps: 100000
    }, settings);

    const netNorm = this._normalizeChainName(this.settings.network || 'mainnet');
    if (this.settings.port === 8333 && netNorm !== 'mainnet') {
      this.settings.port = this._getDefaultP2PPort(netNorm);
    }
    if (this.settings.rpcport === 8332 && netNorm !== 'mainnet') {
      this.settings.rpcport = this._getDefaultRPCPort(netNorm);
    }

    // Initialize network configurations
    this._networkConfigs = {
      mainnet: bitcoin.networks.bitcoin,
      testnet: bitcoin.networks.testnet,
      regtest: bitcoin.networks.regtest,
      signet: bitcoin.networks.testnet // Signet uses testnet address format
    };

    if (this.settings.debug && this.settings.verbosity >= 4) this.emit('debug', '[DEBUG] Instance of Bitcoin service created');

    this._rootKey = new Key({
      ...this.settings.key
    });

    // Bcoin for JS full node
    // bcoin.set(this.settings.network);
    // this.network = bcoin.Network.get(this.settings.network);

    // Internal Services
    this.observer = null;
    // this.provider = new Consensus({ provider: 'bcoin' });
    this.wallet = new Wallet({ ...this.settings, key: { xprv: this._rootKey.xprv } });
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

    this.zmq = new ZMQ({ ...this.settings.zmq, key: { xprv: this._rootKey.xprv } });

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

    // Store handler references for cleanup
    this._errorHandlers = {
      uncaughtException: null,
      unhandledRejection: null,
      SIGINT: null,
      SIGTERM: null,
      exit: null
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

  get walletName () {
    const preimage = crypto.createHash('sha256').update(this._rootKey.xpub).digest('hex');
    const hash = crypto.createHash('sha256').update(preimage).digest('hex');
    return this.settings.walletName || hash;
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

  _getDefaultRPCPort (network = 'mainnet') {
    switch (network) {
      case 'regtest':
        return 18443;
      case 'testnet':
        return 18332;
      case 'testnet4':
        return 48332;
      case 'signet':
        return 38332;
      default:
        return 8332;
    }
  }

  _getDefaultP2PPort (network = 'mainnet') {
    switch (network) {
      case 'regtest':
        return 18444;
      case 'testnet':
        return 18333;
      case 'testnet4':
        return 48333;
      case 'signet':
        return 38333;
      default:
        return 8333;
    }
  }

  _normalizeChainName (chain) {
    switch (chain) {
      case 'main':
      case 'mainnet':
        return 'mainnet';
      case 'test':
      case 'testnet':
        return 'testnet';
      case 'signet':
        return 'signet';
      case 'regtest':
        return 'regtest';
      case 'testnet4':
        return 'testnet4';
      default:
        return chain;
    }
  }

  _rpcHostHasSingleNumericPortSuffix (host) {
    const s = String(host).trim();
    if (s.startsWith('[')) return false;
    const first = s.indexOf(':');
    const last = s.lastIndexOf(':');
    if (first === -1 || first !== last) return false;
    return /^\d+$/.test(s.slice(last + 1));
  }

  _normalizeRPCHost (value) {
    if (!value) return '127.0.0.1';
    const host = String(value).trim();
    if (!host) return '127.0.0.1';

    if (host.startsWith('[')) {
      const close = host.indexOf(']');
      if (close !== -1) return host.slice(0, close + 1);
      return host;
    }

    if (this._rpcHostHasSingleNumericPortSuffix(host)) {
      return host.slice(0, host.lastIndexOf(':'));
    }

    return host;
  }

  _buildRPCProbeCandidates () {
    const candidates = [];
    const seen = new Set();

    const pushCandidate = (candidate) => {
      if (!candidate || !candidate.host || !candidate.rpcport) return;
      const normalized = {
        ...candidate,
        host: this._normalizeRPCHost(candidate.host),
        rpcport: Number(candidate.rpcport)
      };
      if (!Number.isFinite(normalized.rpcport)) return;
      const key = [
        normalized.host,
        normalized.rpcport,
        normalized.network || '',
        normalized.username || '',
        normalized.password || ''
      ].join('|');
      if (seen.has(key)) return;
      seen.add(key);
      candidates.push(normalized);
    };

    if (Array.isArray(this.settings.rpcProbeCandidates)) {
      for (const candidate of this.settings.rpcProbeCandidates) {
        pushCandidate(candidate);
      }
    }

    if (this.settings.host && this.settings.rpcport) {
      pushCandidate({
        source: 'settings',
        host: this.settings.host,
        rpcport: Number(this.settings.rpcport),
        network: this.settings.network,
        username: this.settings.username,
        password: this.settings.password,
        secure: this.settings.secure === true
      });
    }

    const allNetworks = ['mainnet', 'testnet', 'signet', 'regtest', 'testnet4'];
    const preferred = [];
    if (this.settings.network) preferred.push(this.settings.network);

    for (const network of allNetworks) {
      if (!preferred.includes(network)) preferred.push(network);
    }

    for (const network of preferred) {
      const rpcport = this._getDefaultRPCPort(network);

      if (this.settings.username && this.settings.password) {
        pushCandidate({
          source: 'settings.credentials',
          host: this.settings.host || '127.0.0.1',
          rpcport,
          network,
          username: this.settings.username,
          password: this.settings.password,
          secure: this.settings.secure === true
        });
      }

      pushCandidate({
        source: `localhost:${network}`,
        host: this.settings.host || '127.0.0.1',
        rpcport,
        network,
        username: this.settings.username,
        password: this.settings.password,
        secure: this.settings.secure === true
      });
    }

    return candidates;
  }

  _createRPCClientForCandidate (candidate) {
    const config = {
      host: candidate.host,
      port: Number(candidate.rpcport),
      timeout: 2500
    };

    if (candidate.username && candidate.password) {
      const auth = `${candidate.username}:${candidate.password}`;
      config.headers = { Authorization: `Basic ${Buffer.from(auth, 'utf8').toString('base64')}` };
    }

    return (candidate.secure === true) ? jayson.https(config) : jayson.http(config);
  }

  _requestWithRPCClient (client, method, params = []) {
    return new Promise((resolve, reject) => {
      client.request(method, params, (err, response) => {
        if (err) return reject(err);
        if (!response) return reject(new Error(`No response from RPC call ${method}`));
        if (response.error) return reject(response.error);
        return resolve(response.result);
      });
    });
  }

  async _detectExistingBitcoind () {
    const candidates = this._buildRPCProbeCandidates();

    for (const candidate of candidates) {
      try {
        const client = this._createRPCClientForCandidate(candidate);
        const [chainInfo] = await Promise.all([
          this._requestWithRPCClient(client, 'getblockchaininfo', []),
          this._requestWithRPCClient(client, 'getnetworkinfo', [])
        ]);

        const detectedNetwork = this._normalizeChainName(chainInfo.chain || candidate.network);
        const targetNetwork = this._normalizeChainName(this.settings.network || 'mainnet');

        // Never reuse a daemon from a different chain.
        if (detectedNetwork && targetNetwork && detectedNetwork !== targetNetwork) {
          if (this.settings.debug) {
            this.emit(
              'debug',
              `[FABRIC:BITCOIN] Ignoring external ${detectedNetwork} daemon while target network is ${targetNetwork}`
            );
          }
          continue;
        }
        if (this.settings.debug) {
          this.emit(
            'debug',
            `[FABRIC:BITCOIN] Reusing existing bitcoind (${candidate.source}) at ${candidate.host}:${candidate.rpcport} on ${detectedNetwork}`
          );
        }

        this.settings.host = candidate.host;
        this.settings.rpcport = Number(candidate.rpcport);
        this.settings.network = detectedNetwork || this.settings.network;
        this.settings.port = this._getDefaultP2PPort(this.settings.network);
        this.settings.secure = candidate.secure === true;

        if (candidate.username && candidate.password) {
          this.settings.username = candidate.username;
          this.settings.password = candidate.password;
          this.settings.authority = `http${this.settings.secure ? 's' : ''}://${candidate.host}:${candidate.rpcport}`;
        }

        this.rpc = client;
        this._usingExternalNode = true;
        return true;
      } catch (error) {
        if (this.settings.debug) {
          this.emit(
            'debug',
            `[FABRIC:BITCOIN] RPC probe failed for ${candidate.host}:${candidate.rpcport} (${candidate.source}): ${error.message || error}`
          );
        }
      }
    }

    return false;
  }

  validateAddress (address) {
    try {
      // Get the correct network configuration
      const network = this._networkConfigs[this.settings.network];
      if (!network) {
        throw new Error(`Invalid network: ${this.settings.network}`);
      }

      try {
        bitcoin.address.toOutputScript(address, network);
        return true;
      } catch (e) {
        return false;
      }

      // Try to convert the address to an output script
      bitcoin.address.toOutputScript(address, network);
      return true;
    } catch (e) {
      if (this.settings.debug) {
        if (this.settings.debug) this.emit('debug', `[FABRIC:BITCOIN] Address validation failed: ${e.message}`);
      }
      return false;
    }
  }

  async tick () {
    const self = this;
    const now = (new Date()).toISOString();
    ++this._clock;

    if (this.settings.mode === 'rpc' && this._rpcReady === false) {
      // Degraded mode: no reachable RPC endpoint, skip sync work.
      return this;
    }

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
    if (this.settings.debug) this.emit('debug', `[SERVICES:BITCOIN] Broadcasting message: ${JSON.stringify(msg)}`);
    const verify = await msg.verify();
    if (this.settings.debug) this.emit('debug', `[SERVICES:BITCOIN] Verified TX: ${JSON.stringify(verify)}`);

    await this.spv.sendTX(msg);
    // await this.spv.broadcast(msg);
    await this.spv.relay(msg);
    if (this.settings.debug) this.emit('debug', '[SERVICES:BITCOIN] Broadcast complete');
  }

  async processSpendMessage (message) {
    return this._processSpendMessage(message);
  }

  async _processRawBlock (raw) {
    const block = bcoin.Block.fromRaw(raw);
    if (this.settings.debug) this.emit('debug', `[SERVICES:BITCOIN] rawBlock: ${JSON.stringify(block)}`);
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
      const parsed = Number(message.amount.valueOf());
      if (!Number.isFinite(parsed)) throw new Error('Message amount must be numeric.');
      message.amount = parsed.toFixed(8); // normalize boxed string amounts to fixed BTC precision
    }

    const actor = new Actor(message);
    // Bitcoin Core 0.21+ does not load a default wallet; ensure our wallet is loaded and use wallet RPC
    await this._loadWallet(this.walletName);
    const txid = await this._makeWalletRequest('sendtoaddress', [
      message.destination,
      message.amount,
      message.comment || `_processSendMessage ${actor.id} ${message.created}`,
      message.recipient || 'Unknown Recipient',
      false,
      false,
      1,
      'conservative',
      true
    ], this.walletName);

    if (txid && typeof txid === 'object' && txid.error) {
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
    if (this.settings.debug) this.emit('debug', `WARNING [!!!]: double check that: ${obj.headers.hash('hex')} === ${hash}`);

    try {
      // TODO: verify block hash!!!
      prior = await this._GET(path);
    } catch (E) {
      this.emit('warning', `[SERVICES:BITCOIN] No previous block (registering as new): ${E.message || E}`);
    }

    if (prior) {
      this.emit('debug', `[SERVICES:BITCOIN] block seen before: ${prior.id || prior.hash || 'unknown'}`);
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
      this.emit('error', `[SERVICES:BITCOIN] Cannot register block: ${E.message || E}`);
      return null;
    }

    for (let i = 0; i < obj.transactions.length; i++) {
      let tx = obj.transactions[i];
      this.emit('debug', `[AUDIT] tx found in block: ${tx.txid || tx.hash || 'unknown'}`);
      let transaction = await this._registerTransaction({
        id: tx.txid + '',
        hash: tx.hash + '',
        confirmations: 1
      });
      this.emit('debug', `[SERVICES:BITCOIN] registered transaction ${transaction.hash || transaction.id || 'unknown'}`);
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
    this.emit('debug', `[SERVICES:BITCOIN] registered tx ${tx.hash || tx.id || 'unknown'}`);

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
    this.emit('error', `[SERVICES:BITCOIN] Peer generated error: ${err.message || err}`);
  }

  /**
   * Process a message from a peer in the Bitcoin network.
   * @param {PeerPacket} msg Message from peer.
   */
  async _handlePeerPacket (msg) {
    if (this.settings.debug) this.emit('debug', `[SERVICES:BITCOIN] Peer sent packet: ${JSON.stringify(msg)}`);

    switch (msg.cmd) {
      default:
        this.emit('warning', `[SERVICES:BITCOIN] unhandled peer packet: ${msg.cmd}`);
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

        if (this.settings.debug) this.emit('debug', `[SERVICES:BITCOIN] registered block: ${block.hash || block.id || 'unknown'}`);
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
        if (this.settings.debug) this.emit('debug', `[SERVICES:BITCOIN] regtest tx: ${JSON.stringify(transaction)}`);
        break;
    }

    if (this.settings.debug) this.emit('debug', `[SERVICES:BITCOIN] State: ${JSON.stringify(this.state)}`);
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
    if (this.settings.verbosity >= 5) this.emit('debug', `[AUDIT] SPV received block ${msg.hash('hex')}`);
    let block = await this.blocks.create({
      hash: msg.hash('hex'),
      parent: msg.prevBlock.toString('hex'),
      transactions: msg.hashes,
      block: msg
    });

    // Update state with new block
    this._state.content.blocks[block.hash] = block;

    // if (this.settings.verbosity >= 5) this.emit('debug', `created block: ${block.hash}`);
    if (this.settings.verbosity >= 5) this.emit('debug', `[SERVICES:BITCOIN] block count: ${Object.keys(this.blocks.list()).length}`);

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
    if (this.settings.verbosity >= 5) this.emit('debug', `[AUDIT] SPV received tx ${tx.hash('hex')}`);
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

  _keyNetworkNameForWif () {
    const n = this.settings.network;
    return n === 'signet' ? 'testnet' : n;
  }

  async _dumpKeyPair (address) {
    const wif = await this._makeRPCRequest('dumpprivkey', [address]);
    const k = Key.fromWIF(wif, { network: this._keyNetworkNameForWif() });
    const priv = k.private;
    const pubHex = k.public.encodeCompressed('hex');
    return {
      privateKey: Buffer.isBuffer(priv) ? priv : Buffer.from(priv, 'hex'),
      publicKey: Buffer.from(pubHex, 'hex')
    };
  }

  async _dumpPrivateKey (address) {
    const wif = await this._makeRPCRequest('dumpprivkey', [address]);
    const k = Key.fromWIF(wif, { network: this._keyNetworkNameForWif() });
    const priv = k.private;
    return Buffer.isBuffer(priv) ? priv : Buffer.from(priv, 'hex');
  }

  async _loadPrivateKey (key) {
    return this._makeRPCRequest('importprivkey', [key]);
  }

  async _loadWallet (name) {
    if (!name) name = this.walletName;
    try {
      const info = await this._makeRPCRequest('getnetworkinfo');
      const version = parseInt(info.version);
      const useDescriptors = version >= 240000; // Descriptors became stable in v24.0

      if (this.settings.debug) this.emit('debug', `[FABRIC:BITCOIN] Loading wallet: ${name}, version: ${version}, descriptors: ${useDescriptors}`);

      const walletParams = [
        name,
        false, // disable_private_keys
        false, // TODO: enable blank, import _rootKey
        null,  // passphrase
        true,  // avoid_reuse
        useDescriptors // descriptors - only enable for newer versions
      ];

      // First try to load an existing wallet
      try {
        await this._makeRPCRequest('loadwallet', [name]);
        if (this.settings.debug) this.emit('debug', `[FABRIC:BITCOIN] Successfully loaded existing wallet: ${name}`);
        return { name };
      } catch (loadError) {
        if (this.settings.debug) this.emit('debug', `[FABRIC:BITCOIN] Load error for wallet ${name}: ${loadError.message}`);

        // If wallet doesn't exist (-18) or path doesn't exist, we need to create it
        if (loadError.code === -18 || loadError.message.includes('does not exist')) {
          if (this.settings.debug) this.emit('debug', `[FABRIC:BITCOIN] Wallet path does not exist, creating new wallet: ${name}`);

          try {
            await this._makeRPCRequest('createwallet', walletParams);
            if (this.settings.debug) this.emit('debug', `[FABRIC:BITCOIN] Successfully created wallet: ${name}`);
            return { name };
          } catch (createError) {
            if (createError.code === -4 || (createError.message && createError.message.includes('Database already exists'))) {
              if (this.settings.debug) this.emit('debug', `[FABRIC:BITCOIN] Wallet DB already exists, loading: ${name}`);
              await this._makeRPCRequest('loadwallet', [name]);
              return { name };
            }
            if (this.settings.debug) this.emit('debug', `[FABRIC:BITCOIN] Create error for wallet ${name}: ${createError.message}`);
            throw createError;
          }
        }

        // If wallet is already loaded (-35), that's fine
        if (loadError.code === -35) {
        if (this.settings.debug) this.emit('debug', `[FABRIC:BITCOIN] Wallet ${name} already loaded`);
          return { name };
        }

        // For any other error where the wallet might be in a bad state, try unloading and recreating
        try {
          if (this.settings.debug) this.emit('debug', `[FABRIC:BITCOIN] Attempting to unload and recreate wallet: ${name}`);
          try {
            await this._makeRPCRequest('unloadwallet', [name]);
          } catch (unloadError) {
            if (this.settings.debug) this.emit('debug', `[FABRIC:BITCOIN] Unload failed (wallet may not be loaded): ${unloadError.message}`);
          }

          await this._makeRPCRequest('createwallet', walletParams);
          if (this.settings.debug) this.emit('debug', `[FABRIC:BITCOIN] Successfully recreated wallet: ${name}`);
          return { name };
        } catch (recreateError) {
          if (recreateError.code === -4 || (recreateError.message && recreateError.message.includes('Database already exists'))) {
            if (this.settings.debug) this.emit('debug', `[FABRIC:BITCOIN] Wallet DB already exists, loading: ${name}`);
            await this._makeRPCRequest('loadwallet', [name]);
            return { name };
          }
          if (this.settings.debug) this.emit('debug', `[FABRIC:BITCOIN] Recreate error for wallet ${name}: ${recreateError.message}`);
          throw recreateError;
        }
      }
    } catch (error) {
      if (this.settings.debug) this.emit('debug', `[FABRIC:BITCOIN] Wallet loading sequence error: ${error.message || error}`);
      throw error;
    }
  }

  async _unloadWallet (name) {
    if (!name) name = this.walletName;
    try {
      if (this.settings.debug) this.emit('debug', `[FABRIC:BITCOIN] Attempting to unload wallet: ${name}`);
      await this._makeRPCRequest('unloadwallet', [name]);
      if (this.settings.debug) this.emit('debug', `[FABRIC:BITCOIN] Successfully unloaded wallet: ${name}`);
      return { name };
    } catch (error) {
      if (this.settings.debug) this.emit('debug', `[FABRIC:BITCOIN] Wallet unloading sequence: ${error.message}`);
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
      if (this.settings.verbosity >= 4) this.emit('debug', `[DEBUG] [@0x${slice.string}] === ${slice.string}`);
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
    if (this.settings.verbosity >= 4) this.emit('debug', `[SERVICES:BITCOIN] Peer connection created: ${peer.host || 'unknown'}`);
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
        if (this.settings.verbosity >= 4) this.emit('debug', `[SERVICES:BITCOIN] wallet balance: ${JSON.stringify(balance)}`);
      } catch (E) {
        this.emit('error', `[SERVICES:BITCOIN] Could not connect to trusted node: ${E.message || E}`);
      } */
    }
  }

  async _handleZMQMessage (msg) {
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
      this.emit('error', `[BITCOIN] Invalid message format: ${JSON.stringify(msg)}`);
      return;
    }

    if (this.settings.debug) this.emit('debug', '[ZMQ] Received message on topic:', topic, 'Message length:', content && (Buffer.isBuffer(content) ? content.length : (typeof content === 'object' ? JSON.stringify(content).length : String(content).length)));

    try {
      switch (topic) {
        case 'BitcoinBlock':
        case 'BitcoinTransactionHash':
          break;
        case 'BitcoinBlockHash': {
          const blockHashHex = (content && typeof content === 'object' && content.content)
            ? content.content
            : (JSON.parse(Buffer.isBuffer(content) ? content.toString() : String(content))).content;
          const supply = await this._makeRPCRequest('gettxoutsetinfo', []);
          this._state.content.height = supply.height;
          this._state.content.tip = blockHashHex;
          this._state.content.supply = supply.total_amount;
          this.commit();
          this.emit('block', {
            tip: blockHashHex,
            height: supply.height,
            supply: supply.total_amount
          });
          break;
        }
        case 'BitcoinTransaction': {
          try {
            const balance = await this._makeRPCRequest('getbalances', []).catch(() => null);
            if (balance != null) {
              this._state.balances.mine.trusted = balance;
              this.commit();
              this.emit('transaction', { balance: this._state.balances.mine.trusted });
            }
          } catch (e) {
            if (this.settings.debug) this.emit('debug', `[FABRIC:BITCOIN] ZMQ BitcoinTransaction handler: ${e.message || e}`);
          }
          break;
        }
        default:
          if (this.settings.verbosity >= 5) this.emit('debug', `[AUDIT] Unknown ZMQ topic: ${topic}`);
      }
    } catch (exception) {
      //', `Could not process ZMQ message: ${exception}`);
    }
  }

  async _startZMQ () {
    if (this.settings.verbosity >= 5) this.emit('debug', '[AUDIT] Starting ZMQ service...');
    this.zmq.on('log', (msg) => {
      if (this.settings.debug) this.emit('debug', `[ZMQ] ${msg}`);
    });

    this.zmq.on('message', this._handleZMQMessage.bind(this));

    this.zmq.on('error', (err) => {
      this.emit('error', `[ZMQ] Error: ${err.message || err}`);
    });

    this.zmq.on('connect', () => {
      this.emit('debug', '[ZMQ] Connected to Bitcoin node');
    });

    this.zmq.on('disconnect', () => {
      this.emit('debug', '[ZMQ] Disconnected from Bitcoin node');
    });

    await this.zmq.start();
    if (this.settings.debug) this.emit('debug', '[AUDIT] ZMQ Started.');
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
      try {
        await this._loadWallet(this.walletName);
        const info = await this._makeRPCRequest('getnetworkinfo');
        const version = parseInt(info.version);
        const address = await this._makeWalletRequest('getnewaddress', [
          '', // label
          version >= 240000 ? 'legacy' : 'legacy' // address type
        ], this.walletName);

        if (!address) throw new Error('No address returned from getnewaddress');
        return address;
      } catch (error) {
      if (this.settings.debug) this.emit('debug', `[FABRIC:BITCOIN] Error getting unused address: ${error.message || error}`);
        throw error;
      }
    } else if (this.settings.key || this._rootKey) {
      // In fabric mode, derive from a Key instance; settings.key may be plain config.
      const keySource = (this.settings.key && typeof this.settings.key.deriveAddress === 'function')
        ? this.settings.key
        : this._rootKey;
      const target = keySource.deriveAddress(this.settings.state.walletIndex);
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
      this.emit('error', `[SERVICES:BITCOIN] Could not connect to peer: ${E.message || E}`);
    }
  }

  async _listAddresses () {
    return this._makeRPCRequest('listreceivedbyaddress', [1, true]);
  }

  /**
   * Make a single RPC request to the Bitcoin node.
   * Retries on "Work queue depth exceeded" (bitcoind temporary backpressure).
   * @param {String} method The RPC method to call.
   * @param {Array} params The parameters to pass to the RPC method.
   * @param {Object} [opts] Options. retries: max retries for work-queue errors (default 5).
   * @returns {Promise} A promise that resolves to the RPC response.
   */
  async _makeRPCRequest (method, params = [], opts = {}) {
    const maxRetries = opts.retries != null ? opts.retries : 5;
    let lastError;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await this._makeRPCRequestOnce(method, params);
        return result;
      } catch (err) {
        lastError = err;
        const msg = err && (err.message || err);
        const isWorkQueue = typeof msg === 'string' && msg.includes('Work queue depth exceeded');
        if (!isWorkQueue || attempt === maxRetries) {
          throw err;
        }
        if (this.settings.debug) this.emit('debug', `[FABRIC:BITCOIN] Work queue depth exceeded, retrying ${method} in 100ms (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    throw lastError;
  }

  /**
   * Base URL for Bitcoin REST paths (`/services/bitcoin/...`) when using explorer fallback.
   * @returns {String|null} Origin + `/services/bitcoin`, or null if fallback disabled.
   * @private
   */
  _explorerRestBase () {
    const raw = this.settings.explorerBaseUrl;
    if (raw == null) return null;
    const trimmed = String(raw).trim();
    if (!trimmed) return null;
    return trimmed.replace(/\/+$/, '') + '/services/bitcoin';
  }

  /**
   * Blockchain explorer: fetch block info by hash or height.
   * Uses RPC when available; optional HTTP API when `explorerBaseUrl` is set.
   * @param {String|Number} hashOrHeight Block hash (hex) or block height.
   * @returns {Promise<Object>} Block info { hash, height, time, txcount, size, ... }.
   */
  async getBlockInfo (hashOrHeight) {
    if (this._rpcReady && this.rpc) {
      try {
        const hash = typeof hashOrHeight === 'number'
          ? await this._makeRPCRequest('getblockhash', [hashOrHeight])
          : hashOrHeight;
        const block = await this._makeRPCRequest('getblock', [hash, 1]);
        return {
          hash: block.hash,
          height: block.height,
          time: block.time,
          txcount: block.tx ? block.tx.length : 0,
          size: block.size,
          strippedsize: block.strippedsize,
          weight: block.weight,
          mediantime: block.mediantime,
          difficulty: block.difficulty,
          chainwork: block.chainwork,
          previousblockhash: block.previousblockhash,
          nextblockhash: block.nextblockhash
        };
      } catch (e) {
        if (this.settings.debug) this.emit('debug', `[FABRIC:BITCOIN] RPC getBlockInfo failed: ${e.message}`);
      }
    }
    const base = this._explorerRestBase();
    if (!base) {
      throw new Error('Bitcoin getBlockInfo: RPC unavailable and no explorerBaseUrl configured (set bitcoin.explorerBaseUrl or FABRIC_EXPLORER_URL for HTTP fallback).');
    }
    const url = typeof hashOrHeight === 'number'
      ? `${base}/blocks/height/${hashOrHeight}`
      : `${base}/blocks/${hashOrHeight}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Block not found: ${hashOrHeight}`);
    const block = await res.json();
    return {
      hash: block.hash,
      height: block.height,
      time: block.time,
      txcount: block.tx ? block.tx.length : 0,
      size: block.size,
      strippedsize: block.strippedsize,
      weight: block.weight,
      mediantime: block.mediantime,
      difficulty: block.difficulty,
      previousblockhash: block.previousblockhash,
      nextblockhash: block.nextblockhash
    };
  }

  /**
   * Blockchain explorer: fetch transaction info by txid.
   * Uses RPC when available; optional HTTP API when `explorerBaseUrl` is set.
   * @param {String} txid Transaction ID (hex).
   * @returns {Promise<Object>} Transaction info.
   */
  async getTransactionInfo (txid) {
    if (this._rpcReady && this.rpc) {
      try {
        const tx = await this._makeRPCRequest('getrawtransaction', [txid, true]);
        return {
          txid: tx.txid,
          hash: tx.hash,
          version: tx.version,
          size: tx.size,
          vsize: tx.vsize,
          weight: tx.weight,
          locktime: tx.locktime,
          vin: tx.vin,
          vout: tx.vout,
          blockhash: tx.blockhash,
          confirmations: tx.confirmations,
          time: tx.time,
          blocktime: tx.blocktime
        };
      } catch (e) {
        if (this.settings.debug) this.emit('debug', `[FABRIC:BITCOIN] RPC getTransactionInfo failed: ${e.message}`);
      }
    }
    const base = this._explorerRestBase();
    if (!base) {
      throw new Error('Bitcoin getTransactionInfo: RPC unavailable and no explorerBaseUrl configured (set bitcoin.explorerBaseUrl or FABRIC_EXPLORER_URL for HTTP fallback).');
    }
    const res = await fetch(`${base}/transactions/${txid}`);
    if (!res.ok) throw new Error(`Transaction not found: ${txid}`);
    return res.json();
  }

  /**
   * Blockchain explorer: fetch address info (balance, tx count, recent txs).
   * Requires `explorerBaseUrl` (Core has no generic address index over RPC alone).
   * @param {String} address Bitcoin address.
   * @returns {Promise<Object>} Address info { address, chain_stats, mempool_stats, recent_txs }.
   */
  async getAddressInfo (address) {
    const base = this._explorerRestBase();
    if (!base) {
      throw new Error('Bitcoin getAddressInfo requires explorerBaseUrl (set bitcoin.explorerBaseUrl or FABRIC_EXPLORER_URL).');
    }
    const res = await fetch(`${base}/addresses/${encodeURIComponent(address)}`);
    if (!res.ok) throw new Error(`Address not found: ${address}`);
    const data = await res.json();
    return {
      address: data.address,
      chain_stats: data.chain_stats || {},
      mempool_stats: data.mempool_stats || {},
      recent_txs: data.recent_txs || []
    };
  }

  /**
   * Single attempt at an RPC request (no retries).
   * @private
   */
  _makeRPCRequestOnce (method, params = []) {
    return new Promise((resolve, reject) => {
      if (!this.rpc) return reject(new Error('RPC manager does not exist'));
      this.rpc.request(method, params, (err, response) => {
        if (err) {
          if (this.settings.debug) this.emit('debug', `[FABRIC:BITCOIN] RPC error for ${method}(${params.join(', ')}): ${err.message || err}`);
          return reject(err);
        }

        if (!response) {
          return reject(new Error(`No response from RPC call ${method}`));
        }

        if (response.error) {
          const re = response.error;
          const msg = typeof re === 'object' && re !== null && re.message
            ? (re.code != null ? `[${re.code}] ${re.message}` : re.message)
            : JSON.stringify(re);
          if (this.settings.debug) this.emit('debug', `[FABRIC:BITCOIN] RPC response error for ${method}: ${msg}`);
          const err = re instanceof Error ? re : new Error(msg);
          if (typeof re === 'object' && re !== null && re.code != null) err.code = re.code;
          return reject(err);
        }

        if (this.settings.debug) this.emit('debug', `[FABRIC:BITCOIN] RPC response for ${method}`);
        return resolve(response.result);
      });
    });
  }

  async _makeWalletRequest (method, params = [], wallet) {
    if (!wallet) throw new Error('Wallet name is required for wallet-specific requests');

    return new Promise((resolve, reject) => {
      if (!this.rpc) return reject(new Error('RPC manager does not exist'));

      // Reuse existing RPC config but change the URL to target the specific wallet
      const protocol = this.settings.secure ? 'https' : 'http';
      const host = this.settings.host;
      const port = this.settings.rpcport;
      const auth = `${this.settings.username}:${this.settings.password}`;

      const config = {
        host: host,
        port: port,
        timeout: 300000, // 5 minute timeout for heavy operations
        headers: { Authorization: `Basic ${Buffer.from(auth, 'utf8').toString('base64')}` },
        path: `/wallet/${wallet}`
      };

      let walletRpc;
      if (this.settings.secure) {
        walletRpc = jayson.https(config);
      } else {
        walletRpc = jayson.http(config);
      }

      walletRpc.request(method, params, (err, response) => {
        if (err) {
          if (this.settings.debug) this.emit('debug', `[FABRIC:BITCOIN] Wallet RPC error for ${method}(${params.join(', ')}) on wallet ${wallet}: ${err.message || err}`);
          return reject(err);
        }

        if (!response) {
          return reject(new Error(`No response from wallet RPC call ${method} on wallet ${wallet}`));
        }

        if (response.error) {
          const re = response.error;
          const msg = typeof re === 'object' && re !== null && re.message
            ? (re.code != null ? `[${re.code}] ${re.message}` : re.message)
            : JSON.stringify(re);
          if (this.settings.debug) this.emit('debug', `[FABRIC:BITCOIN] Wallet RPC response error for ${method} on wallet ${wallet}: ${msg}`);
          const err = re instanceof Error ? re : new Error(msg);
          if (typeof re === 'object' && re !== null && re.code != null) err.code = re.code;
          return reject(err);
        }

        if (this.settings.debug) this.emit('debug', `[FABRIC:BITCOIN] Wallet RPC response for ${method} on wallet ${wallet}`);
        return resolve(response.result);
      });
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
      if (this.settings.debug) this.emit('debug', `[FABRIC:BITCOIN] Error requesting best block hash: ${error.message}`);
      throw error;
    }
  }

  /**
   * Rewind the attached Bitcoin Core node to a known-good tip by repeatedly calling `invalidateblock`
   * on the current best block until `getbestblockhash` matches `snapshotBlockHash`.
   * Allowed on regtest, playnet, signet, testnet, testnet4 unless settings.flushChainAllowUnsafeNetworks.
   * @param {string} snapshotBlockHash - 64-char hex block hash to keep as the active tip.
   * @returns {Promise<{ ok: boolean, steps: number, snapshotBlockHash: string }>}
   */
  async flushChainToSnapshot (snapshotBlockHash) {
    const run = () => this._flushChainToSnapshotBody(snapshotBlockHash);
    const p = (this._flushChainQueue || Promise.resolve())
      .catch(() => {})
      .then(run);
    this._flushChainQueue = p.catch(() => {});
    return p;
  }

  /**
   * @private
   */
  async _flushChainToSnapshotBody (snapshotBlockHash) {
    const hex = String(snapshotBlockHash || '').trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(hex)) {
      throw new Error('flushChainToSnapshot: snapshotBlockHash must be 64 hex characters');
    }
    const net = this._normalizeChainName(this.settings.network || 'mainnet');
    const allowed =
      net === 'regtest' ||
      net === 'playnet' ||
      net === 'signet' ||
      net === 'testnet' ||
      net === 'testnet4';
    if (!allowed && !this.settings.flushChainAllowUnsafeNetworks) {
      throw new Error(`flushChainToSnapshot: not allowed for network "${net}" (set flushChainAllowUnsafeNetworks to override)`);
    }
    const maxSteps = (typeof this.settings.flushChainMaxSteps === 'number' && this.settings.flushChainMaxSteps > 0)
      ? this.settings.flushChainMaxSteps
      : 100000;

    let cursor = String(await this._makeRPCRequest('getbestblockhash', [])).trim().toLowerCase();
    let reachable = false;
    for (let i = 0; i < maxSteps; i++) {
      if (cursor === hex) {
        reachable = true;
        break;
      }
      const header = await this._makeRPCRequest('getblockheader', [cursor]);
      const prev = header && header.previousblockhash
        ? String(header.previousblockhash).trim().toLowerCase()
        : null;
      if (!prev) break;
      cursor = prev;
    }
    if (!reachable) {
      throw new Error('flushChainToSnapshot: snapshot is not an ancestor of the active tip');
    }

    let steps = 0;
    while (steps < maxSteps) {
      const best = String(await this._makeRPCRequest('getbestblockhash', [])).trim().toLowerCase();
      if (best === hex) {
        const out = { ok: true, steps, snapshotBlockHash: hex };
        this.emit('message', { type: 'BitcoinFlushChain', data: out });
        return out;
      }
      await this._makeRPCRequest('invalidateblock', [best]);
      steps++;
    }
    throw new Error(`flushChainToSnapshot: exceeded flushChainMaxSteps=${maxSteps} before reaching snapshot`);
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
    try {
      // Ensure a wallet is loaded
      await this._loadWallet(this.walletName);
      return this._makeRPCRequest('listunspent', []);
    } catch (error) {
      if (this.settings.debug) this.emit('debug', `[FABRIC:BITCOIN] Error listing unspent outputs: ${error.message}`);
      // Return empty array on error
      return [];
    }
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
   * @param {Object} options Options for the transaction.
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

  async _estimateFeeRate (withinBlocks = 1) {
    const estimate = await this._makeRPCRequest('estimatesmartfee', [withinBlocks]);
    return estimate.feerate;
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

    // Calculate total input amount
    let inputAmount = 0;
    for (const input of options.inputs) {
      const utxo = await this._makeRPCRequest('gettxout', [input.txid, input.vout]);
      if (utxo) {
        inputAmount += utxo.value * 100000000; // Convert BTC to satoshis
      }
    }

    // Calculate total output amount
    let outputAmount = 0;
    for (const output of options.outputs) {
      outputAmount += output.value;
    }

    // TODO: add change output

    // Create the PSBT
    const psbt = new bitcoin.Psbt({ network });

    for (let i = 0; i < options.inputs.length; i++) {
      const input = options.inputs[i];
      const data = {
        hash: input.txid,
        index: input.vout,
        sequence: 0xffffffff
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
          if (this.settings.debug) this.emit('debug', `[FABRIC:BITCOIN] Failed to add output: ${e.message}`);
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
      if (this.settings.debug) this.emit('debug', `[FABRIC:BITCOIN] Error syncing best block hash: ${error.message}`);
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

  async _syncBalances () {
    try {
      await this._loadWallet(this.walletName);
      const balances = await this._makeRPCRequest('getbalances');
      this._state.balances = balances;
      this.commit();
      return balances;
    } catch (error) {
      if (this.settings.debug) this.emit('debug', `[FABRIC:BITCOIN] Error syncing balances: ${error.message}`);
      return this._state.balances;
    }
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

    this.commit();

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
    await this._syncSupply();
    await this._syncBalances();
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

  async _syncSupply () {
    const supply = await this._makeRPCRequest('gettxoutsetinfo');
    this._state.content.supply = supply.total_amount;
    this.commit();
    return this;
  }

  async _syncWithRPC () {
    try {
      await this._syncChainOverRPC();
      await this.commit();
    } catch (error) {
      // Route sync failures into Fabric's error channel instead of stderr to avoid TUI corruption
      this.emit('error', `[FABRIC:BITCOIN] Sync failed: ${error.message || error}`);
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
      if (this.settings.debug) this.emit('debug', `[FABRIC:BITCOIN] Bitcoind not yet ready: ${error.message}`);
      return false;
    }
  }

  async _waitForBitcoind (maxAttempts = 32, initialDelay = 2000) {
    if (this.settings.debug) this.emit('debug', '[FABRIC:BITCOIN] Waiting for bitcoind to be ready...');
    let attempts = 0;
    let delay = initialDelay;

    while (attempts < maxAttempts) {
      try {
        if (this.settings.debug) this.emit('debug', `[FABRIC:BITCOIN] Attempt ${attempts + 1}/${maxAttempts} to connect to bitcoind on port ${this.settings.rpcport}...`);

        // Check multiple RPC endpoints to ensure full readiness
        const checks = [
          this._makeRPCRequest('getblockchaininfo'),
          this._makeRPCRequest('getnetworkinfo')
        ];

        // Wait for all checks to complete
        const results = await Promise.all(checks);

        if (this.settings.debug) {
          this.emit('debug', '[FABRIC:BITCOIN] Successfully connected to bitcoind');
        }

        return true;
      } catch (error) {
        if (this.settings.debug) this.emit('debug', `[FABRIC:BITCOIN] Connection attempt ${attempts + 1} failed: ${error.message}`);
        attempts++;

        // If we've exceeded max attempts, stop waiting but do not throw
        if (attempts >= maxAttempts) {
          this.emit('warning', `[FABRIC:BITCOIN] Failed to connect to bitcoind after ${maxAttempts} attempts: ${error.message}`);
          return false;
        }

        // Wait before next attempt with exponential backoff
        if (this.settings.debug) this.emit('debug', `[FABRIC:BITCOIN] Waiting ${delay}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        delay = Math.min(delay * 1.5, 10000); // Exponential backoff with max 10s delay
        continue; // Continue to next attempt
      }
    }

    // Should never reach here due to maxAttempts check in catch block
    return false;
  }

  _defaultBitcoinP2pPort (network) {
    const n = String(network || '').toLowerCase();
    if (n === 'regtest') return 18444;
    if (n === 'testnet' || n === 'testnet4') return 18333;
    if (n === 'signet') return 38333;
    return 8333;
  }

  /**
   * Normalize `host` or `host:port` for Bitcoin Core `addnode`.
   * IPv6 must use brackets: `[::1]:18444`. If port is omitted, the default P2P port for {@link settings.network} is appended.
   * @param {string} peer
   * @returns {string|null}
   */
  _normalizeP2pPeerAddress (peer) {
    const raw = String(peer || '').trim();
    if (!raw) return null;
    if (raw.startsWith('[')) {
      const close = raw.indexOf(']');
      if (close === -1) return null;
      if (raw[close + 1] === ':' && /^\d+$/.test(raw.slice(close + 2))) return raw;
      return `${raw.slice(0, close + 1)}:${this._defaultBitcoinP2pPort(this.settings.network)}`;
    }
    if (!raw.includes(':')) {
      return `${raw}:${this._defaultBitcoinP2pPort(this.settings.network)}`;
    }
    const lastColon = raw.lastIndexOf(':');
    const hostPart = raw.slice(0, lastColon);
    const portPart = raw.slice(lastColon + 1);
    if (/^\d+$/.test(portPart) && (hostPart.includes(':') === false || hostPart.startsWith('['))) {
      return raw;
    }
    return raw;
  }

  _shouldApplyP2pAddNodes () {
    if (this.settings.p2pAddNodesAllowMainnet) return true;
    const n = String(this.settings.network || '').toLowerCase();
    return n === 'regtest' || n === 'signet' || n === 'testnet' || n === 'testnet4' || n === 'playnet';
  }

  /**
   * Connect to Bitcoin P2P peers via RPC (`addnode`). Best-effort per peer; failures emit `warning`.
   * @param {string[]} peers
   * @param {string} [command='add'] add | onetry | remove
   * @returns {Promise<string[]>} Peers successfully passed to `addnode`
   */
  async applyP2pAddNodes (peers, command = 'add') {
    const list = Array.isArray(peers) ? peers : [];
    const cmd = ['add', 'onetry', 'remove'].includes(String(command)) ? String(command) : 'add';
    const done = [];
    for (const p of list) {
      const addr = this._normalizeP2pPeerAddress(p);
      if (!addr) continue;
      try {
        await this._makeRPCRequest('addnode', [addr, cmd]);
        done.push(addr);
        this.emit('log', `[FABRIC:BITCOIN] addnode ${cmd} ${addr}`);
      } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        this.emit('warning', `[FABRIC:BITCOIN] addnode failed ${addr}: ${msg}`);
      }
    }
    return done;
  }

  async createLocalNode () {
    if (this.settings.debug) this.emit('debug', '[FABRIC:BITCOIN] Creating local node...');
    let datadir = './stores/bitcoin';
    const zmqPort = this.settings.zmq && this.settings.zmq.port ? this.settings.zmq.port : 29500;

    // TODO: use RPC auth
    const params = [
      `-port=${this.settings.port}`,
      '-rpcbind=127.0.0.1',
      '-rpcallowip=127.0.0.1',
      `-rpcport=${this.settings.rpcport}`,
      `-rpcworkqueue=128`, // Default is 16
      `-rpcthreads=8`, // Default is 4
      '-server',
      `-zmqpubrawblock=tcp://127.0.0.1:${zmqPort}`,
      `-zmqpubrawtx=tcp://127.0.0.1:${zmqPort}`,
      `-zmqpubhashtx=tcp://127.0.0.1:${zmqPort}`,
      `-zmqpubhashblock=tcp://127.0.0.1:${zmqPort}`,
      // Add reindex parameter to handle witness data
      // '-reindex',
      // Add memory management parameters
      // '-dbcache=512',
      // '-maxmempool=100',
      // '-maxconnections=10',
      // Reduce memory usage for validation
      // '-par=1'
    ];

    const useCookieAuth = !(this.settings.username && this.settings.password);
    if (this.settings.username && this.settings.password) {
      params.push(`-rpcuser=${this.settings.username}`);
      params.push(`-rpcpassword=${this.settings.password}`);
    }
    // When no credentials are set, we do not pass -rpcuser/-rpcpassword so bitcoind
    // uses cookie auth; we then read the cookie file and use it for the RPC client.

    // Configure network
    switch (this.settings.network) {
      default:
      case 'mainnet':
        datadir = (this.settings.constraints.storage.size) ? './stores/bitcoin-mainnet-pruned' : './stores/bitcoin-mainnet';
        break;
      case 'testnet':
        datadir = './stores/bitcoin-testnet';
        params.push('-testnet');
        break;
      case 'testnet4':
        datadir = './stores/bitcoin-testnet4';
        params.push('-testnet4');
        break;
      case 'signet':
        datadir = './stores/bitcoin-signet';
        params.push('-signet');
        break;
      case 'regtest':
        datadir = './stores/bitcoin-regtest';
        params.push('-regtest');
        params.push('-fallbackfee=1.0');
        params.push('-maxtxfee=1.1');
        break;
      case 'playnet':
        datadir = './stores/bitcoin-playnet';
        break;
    }

    if (this.settings.listen === 0 || this.settings.listen === false) {
      params.push('-listen=0');
    }

    if (this.settings.datadir) {
      datadir = this.settings.datadir;
      if (this.settings.debug) this.emit('debug', `[FABRIC:BITCOIN] Using custom datadir: ${datadir}`);
    }

    if (this.settings.debug) this.emit('debug', `[FABRIC:BITCOIN] Using datadir: ${datadir}`);
    this.settings.datadir = datadir; // for downstream users accessing the settings property, e.g. for lightning nodes

    // If storage constraints are set, prune the blockchain
    if (this.settings.network !== 'regtest' && this.settings.constraints.storage.size) {
      params.push(`-prune=${this.settings.constraints.storage.size}`);
    } else {
      params.push(`-txindex`);
    }

    // Set data directory
    params.push(`-datadir=${datadir}`);

    if (this.settings.debug) {
      const safeParams = params.map(redactSensitiveCommandArg);
      this.emit('debug', `[FABRIC:BITCOIN] Bitcoind parameters: ${safeParams.join(' ')}`);
    }

    // Start bitcoind
    if (this.settings.managed) {
      // Ensure storage directory exists
      await mkdirp(datadir);
      if (this.settings.debug) this.emit('debug', `[FABRIC:BITCOIN] Storage directory created: ${datadir}`);

      // Allow caller to add extra args (e.g. -dnsseed=0 to avoid DNS in sandboxed environments)
      if (this.settings.bitcoinExtraParams && Array.isArray(this.settings.bitcoinExtraParams)) {
        params.push(...this.settings.bitcoinExtraParams);
      }

      // Spawn process
      if (this.settings.debug) this.emit('debug', '[FABRIC:BITCOIN] Spawning bitcoind process...');
      const child = children.spawn('bitcoind', params);

      // Store the child process reference
      this._nodeProcess = child;

      // Handle process events
      child.stdout.on('data', (data) => {
        const line = data.toString('utf8').trim();
        if (!line) return;
        if (this.settings.debug) this.emit('debug', `[FABRIC:BITCOIN] ${line}`);
      });

      child.stderr.on('data', (data) => {
        const line = data.toString('utf8').trim();
        if (!line) return;
        // Route bitcoind stderr into Fabric's error channel instead of terminal stderr
        this.emit('error', `[FABRIC:BITCOIN] ${line}`);
      });

      child.on('close', (code) => {
        if (this.settings.debug) this.emit('debug', `[FABRIC:BITCOIN] Bitcoin Core exited with code ${code}`);
        this.emit('log', `[FABRIC:BITCOIN] Bitcoin Core exited with code ${code}`);
        this._nodeProcess = null;
      });

      child.on('error', (err) => {
        // Route child process errors into Fabric's error channel; avoid writing to stderr.
        this.emit('error', `[FABRIC:BITCOIN] Bitcoin Core process error: ${err.message || err}`);
        // Attempt to restart the process
        // this._restartBitcoind();
      });

      // Fail fast if the process exits/errors immediately after spawn.
      const earlyFailure = await new Promise((resolve) => {
        const timer = setTimeout(() => {
          child.off('error', onError);
          child.off('exit', onExit);
          resolve(null);
        }, 1000);

        const onError = (err) => {
          clearTimeout(timer);
          child.off('error', onError);
          child.off('exit', onExit);
          resolve(new Error(`Bitcoin Core failed to spawn: ${err.message || err}`));
        };

        const onExit = (code, signal) => {
          clearTimeout(timer);
          child.off('error', onError);
          child.off('exit', onExit);
          resolve(new Error(`Bitcoin Core exited early with code ${code}${signal ? ` (signal ${signal})` : ''}`));
        };

        child.on('error', onError);
        child.once('exit', onExit);
      });

      if (earlyFailure) {
        this._nodeProcess = null;
        throw earlyFailure;
      }

      // Add cleanup handlers
      const cleanup = async () => {
        if (this._nodeProcess) {
          try {
            if (this.settings.debug) this.emit('debug', '[FABRIC:BITCOIN] Cleaning up Bitcoin node...');
            this._nodeProcess.kill();
            await new Promise(resolve => {
              this._nodeProcess.on('close', () => resolve());
            });
          } catch (e) {
            this.emit('error', `[FABRIC:BITCOIN] Error during cleanup: ${e.message || e}`);
          }
        }
      };

      // Store and attach handlers with proper error attribution
      this._errorHandlers.SIGINT = cleanup;
      this._errorHandlers.SIGTERM = cleanup;
      this._errorHandlers.exit = cleanup;
      this._errorHandlers.uncaughtException = async (err) => {
        // Only handle errors from this service's child process
        if (err.source === 'bitcoin' || (this._nodeProcess && err.pid === this._nodeProcess.pid)) {
          // Avoid console.trace to keep TUI clean; surface via error channel instead.
          this.emit('error', `[FABRIC:BITCOIN] Uncaught exception from Bitcoin service: ${err.message || err}`);
          // await cleanup();
        }
      };
      this._errorHandlers.unhandledRejection = async (reason, promise) => {
        // Only handle rejections from this service's operations
        if (reason.source === 'bitcoin' || (this._nodeProcess && reason.pid === this._nodeProcess.pid)) {
          this.emit('error', '[FABRIC:BITCOIN] Unhandled rejection from Bitcoin service');
          // await cleanup();
        }
      };

      // Attach the handlers
      process.on('SIGINT', this._errorHandlers.SIGINT);
      process.on('SIGTERM', this._errorHandlers.SIGTERM);
      process.on('exit', this._errorHandlers.exit);
      process.on('uncaughtException', this._errorHandlers.uncaughtException);
      process.on('unhandledRejection', this._errorHandlers.unhandledRejection);

      // When using cookie auth, wait for bitcoind to create the cookie file then read credentials
      if (useCookieAuth) {
        const chainSubdir = (() => {
          const n = (this.settings.network || '').toLowerCase();
          if (n === 'regtest') return 'regtest';
          if (n === 'testnet') return 'testnet3';
          if (n === 'signet') return 'signet';
          return '';
        })();
        const cookiePath = path.resolve(process.cwd(), datadir, chainSubdir, '.cookie');
        const cookieTimeoutMs = 15000;
        const cookiePollMs = 100;
        const cookieDeadline = Date.now() + cookieTimeoutMs;
        while (Date.now() < cookieDeadline) {
          try {
            if (fs.existsSync(cookiePath)) {
              const raw = fs.readFileSync(cookiePath, 'utf8').trim();
              const colon = raw.indexOf(':');
              if (colon !== -1) {
                this.settings.username = raw.slice(0, colon);
                this.settings.password = raw.slice(colon + 1);
                this.settings.authority = `http://127.0.0.1:${this.settings.rpcport}`;
                if (this.settings.debug) this.emit('debug', '[FABRIC:BITCOIN] Read RPC credentials from cookie file');
                break;
              }
            }
          } catch (e) {
            // ignore read errors, keep polling
          }
          await new Promise(r => setTimeout(r, cookiePollMs));
        }
        if (!this.settings.username || !this.settings.password) {
          throw new Error(`[FABRIC:BITCOIN] Cookie file did not appear at ${cookiePath} within ${cookieTimeoutMs}ms`);
        }
      }

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
      // Unmanaged: configure authority and credentials for connecting to external node
      const host = this.settings.host || '127.0.0.1';
      const rpcport = this.settings.rpcport || 18443;
      this.settings.authority = `http://${host}:${rpcport}`;
      if (!this.settings.username || !this.settings.password) {
        const chainSubdir = (() => {
          const n = (this.settings.network || '').toLowerCase();
          if (n === 'regtest') return 'regtest';
          if (n === 'testnet') return 'testnet3';
          if (n === 'signet') return 'signet';
          return '';
        })();
        const cookiePath = path.resolve(process.cwd(), datadir, chainSubdir, '.cookie');
        try {
          if (fs.existsSync(cookiePath)) {
            const raw = fs.readFileSync(cookiePath, 'utf8').trim();
            const colon = raw.indexOf(':');
            if (colon !== -1) {
              this.settings.username = raw.slice(0, colon);
              this.settings.password = raw.slice(colon + 1);
              if (this.settings.debug) this.emit('debug', '[FABRIC:BITCOIN] Read RPC credentials from cookie file (unmanaged)');
            }
          }
        } catch (e) {
          // Cookie not available
        }
        if (!this.settings.username || !this.settings.password) {
          this.settings.username = `fabric_${crypto.randomBytes(8).toString('hex')}`;
          this.settings.password = crypto.randomBytes(32).toString('hex');
          if (this.settings.debug) this.emit('debug', '[FABRIC:BITCOIN] Generated placeholder RPC credentials (unmanaged, no cookie)');
        }
      }
      return null;
    }
  }

  /**
   * Start the Bitcoin service, including the initiation of outbound requests.
   */
  async start () {
    this.emit('debug', `[SERVICES:BITCOIN] Starting for network "${this.settings.network}"...`);
    this.status = 'STARTING';

    const shouldProbeExternalNode = !(
      this.settings.enforceIsolatedRegtest &&
      this.settings.managed &&
      this.settings.network === 'regtest'
    );
    const existingBitcoindFound = shouldProbeExternalNode ? await this._detectExistingBitcoind() : false;
    if (existingBitcoindFound && this.settings.managed) {
      this.emit('log', '[FABRIC:BITCOIN] Existing bitcoind detected; not starting another managed instance');
      this.settings.managed = false;
    }

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
      // If deprecated setting `authority` is provided, compose settings (host, port, secure).
      // Only take username/password from the URL when the URL actually contains them (e.g. http://user:pass@host);
      // otherwise leave existing credentials (e.g. from cookie auth in createLocalNode) intact.
      if (this.settings.authority) {
        const url = new URL(this.settings.authority);
        if (url.username || url.password) {
          this.settings.username = url.username;
          this.settings.password = url.password;
        }
        this.settings.host = url.hostname;
        this.settings.port = url.port;
        this.settings.secure = (url.protocol === 'https:') ? true : false;
      }

      const protocol = (this.settings.secure === true) ? 'https' : 'http';
      const host = this.settings.host || '127.0.0.1';
      const port = this.settings.rpcport || this._getDefaultRPCPort(this.settings.network);
      const config = {
        host: host,
        port: port,
        // Keep RPC timeout modest so CLI stays responsive even if bitcoind is slow/offline
        timeout: 15000
      };

      if (this.settings.username && this.settings.password) {
        const auth = `${this.settings.username}:${this.settings.password}`;
        config.headers = { Authorization: `Basic ${Buffer.from(auth, 'utf8').toString('base64')}` };
      }

      if (protocol === 'https') {
        this.rpc = jayson.https(config);
      } else {
        this.rpc = jayson.http(config);
      }

      // Brief delay so bitcoind's HTTP server is ready to accept authenticated RPC after "Done loading"
      if (this._nodeProcess && this.settings.username && this.settings.password) {
        await new Promise(r => setTimeout(r, 600));
      }

      // Wait for bitcoind to be fully online; if it isn't, continue in degraded mode
      this._rpcReady = await this._waitForBitcoind();
      if (!this._rpcReady) {
        this.emit('warning', '[FABRIC:BITCOIN] bitcoind not reachable; running in degraded mode');
      } else if (this._shouldApplyP2pAddNodes() && Array.isArray(this.settings.p2pAddNodes) && this.settings.p2pAddNodes.length) {
        try {
          await this.applyP2pAddNodes(this.settings.p2pAddNodes);
        } catch (e) {
          this.emit('warning', `[FABRIC:BITCOIN] p2pAddNodes: ${e.message || e}`);
        }
      }
    }

    // Start services
    // await this.wallet.start();

    // Start ZMQ if enabled
    if (this.settings.zmq) await this._startZMQ();

    // Handle RPC mode operations
    if (this.settings.mode === 'rpc') {
      if (this._rpcReady !== false) {
        this._heart = setInterval(this.tick.bind(this), this.settings.interval);
        await this._syncWithRPC();
      } else {
        this.emit('warning', '[FABRIC:BITCOIN] Skipping RPC sync/heartbeat until bitcoind is reachable');
      }
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
    if (this.settings.debug) this.emit('debug', '[FABRIC:BITCOIN] Stopping Bitcoin service...');

    // Remove all event listeners
    this.removeAllListeners();

    // Stop the heartbeat interval if it exists
    if (this._heart) {
      clearInterval(this._heart);
      delete this._heart;
    }

    // Stop the wallet
    if (this.wallet) {
      if (this.settings.debug) this.emit('debug', '[FABRIC:BITCOIN] Stopping wallet...');
      await this.wallet.stop();
    }

    // Stop the ZMQ service
    if (this.zmq) {
      if (this.settings.debug) this.emit('debug', '[FABRIC:BITCOIN] Stopping ZMQ...');
      await this.zmq.stop();
    }

    // Kill the Bitcoin node process if it exists
    if (this._nodeProcess) {
      if (this.settings.debug) this.emit('debug', '[FABRIC:BITCOIN] Stopping Bitcoin node process...');
      try {
        // First try SIGTERM for graceful shutdown
        this._nodeProcess.kill('SIGTERM');

        // Wait up to 10 seconds for graceful shutdown
        const terminated = await Promise.race([
          new Promise(resolve => this._nodeProcess.once('exit', () => resolve(true))),
          new Promise(resolve => setTimeout(() => resolve(false), 10000))
        ]);

        // If graceful shutdown failed, force kill
        if (!terminated && this._nodeProcess) {
          if (this.settings.debug) this.emit('debug', '[FABRIC:BITCOIN] Graceful shutdown failed, using SIGKILL...');
          this._nodeProcess.kill('SIGKILL');
          await new Promise(resolve => this._nodeProcess.once('exit', resolve));
        }
      } catch (error) {
        this.emit('error', `[FABRIC:BITCOIN] Error stopping process: ${error.message || error}`);
      }
      this._nodeProcess = null;
    }

    if (this.settings.debug) this.emit('debug', '[FABRIC:BITCOIN] Service stopped');
    return this;
  }

  // Add cleanup method
  async cleanup () {
    this.emit('debug', '[FABRIC:BITCOIN] Cleaning up...');
    await this.stop();

    // Remove process event listeners if they exist
    if (this._errorHandlers) {
      Object.entries(this._errorHandlers).forEach(([event, handler]) => {
        if (handler) {
          process.removeListener(event, handler);
          this._errorHandlers[event] = null;
        }
      });
    }

    this.emit('debug', '[FABRIC:BITCOIN] Cleanup complete');
  }

}

module.exports = Bitcoin;
