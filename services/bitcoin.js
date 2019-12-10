'use strict';

// Types
const Collection = require('../types/collection');
const Entity = require('../types/entity');
const Service = require('../types/service');
const State = require('../types/state');
const Wallet = require('../types/wallet');

const BitcoinBlock = require('../types/bitcoin/block');

// External Dependencies
const bcoin = require('bcoin/lib/bcoin-browser').set('regtest');
const FullNode = bcoin.FullNode;
const WalletClient = require('bclient');

// TODO: import genesis hash from file / config
const network = bcoin.Network.get('regtest');

class Bitcoin extends Service {
  constructor (settings = {}) {
    super(settings);

    this.state = {
      blocks: {}
    };

    this.settings = Object.assign({
      name: '@services/bitcoin',
      network: 'regtest',
      nodes: ['127.0.0.1'],
      seeds: ['127.0.0.1'],
      port: 18444
    }, settings);

    this.wallet = new Wallet();

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

    this.fullnode = new FullNode({
      agent: this.UAString,
      // port: 48445,
      network: this.settings.network,
      bip37: true, // TODO: verify SPV implementation
      listen: true,
      http: false,
      logLevel: 'debug',
      memory: true,
      workers: true,
      loader: require
    });

    this.peer = bcoin.Peer.fromOptions({
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
      let block = this.peer.getBlock([network.genesis.hash]);
    });

    this.spv = new bcoin.SPVNode({
      agent: this.UAString + ' (SPV)',
      network: this.settings.network,
      httpPort: 48449, // TODO: disable HTTP entirely!
      memory: true,
      logLevel: 'spam',
      maxOutbound: 1,
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
  }

  async _prepareBlock (obj) {
    let entity = new Entity(obj);
    return Object.assign({}, obj, {
      id: entity.id
    });
  }

  async _handleCommittedBlock (block) {
    this.emit('block', block);
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

  async _connectToSeedNodes () {
    for (let i = 0; i < this.settings.seeds.length; i++) {
      let node = this.settings.seeds[i];
      this.connect(node);
    }
  }

  async _connectToEdgeNodes () {
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
        this.peer.getBlock([network.genesis.hash]);
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

  async connect (addr) {
    try {
      this.peer.connect(addr);
    } catch (E) {
      console.error('[SERVICES:BITCOIN]', 'Could not connect to peer:', E);
    }
  }

  async start () {
    await this.wallet.start();
    await this._startLocalNode();
    await this._connectSPV();

    return this;
  }

  async stop () {
    await this.peer.disconnect();
  }
}

module.exports = Bitcoin;
