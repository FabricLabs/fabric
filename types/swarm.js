'use strict';

const {
  MAX_PEERS
} = require('../constants');

const Peer = require('./peer');
const Scribe = require('./scribe');

/**
 * Orchestrates a network of peers.
 * @type {String}
 */
class Swarm extends Scribe {
  /**
   * Create an instance of a {@link Swarm}.
   * @param  {Object} config Configuration object.
   * @return {Swarm}        Instance of the Swarm.
   */
  constructor (config = {}) {
    super(config);

    this.name = 'Swarm';
    this.settings = this.config = Object.assign({
      name: 'fabric',
      // TODO: define seed list
      seeds: [],
      peers: []
    }, config);

    // create a peer for one's own $self
    this.agent = new Peer(this.config);

    this.nodes = {};
    this.peers = {};

    return this;
  }

  broadcast (msg) {
    if (this.settings.verbosity >= 5) console.log('broadcasting:', msg);
    this.agent.broadcast(msg);
  }

  connect (address) {
    if (this.settings.verbosity >= 4) console.log('[FABRIC:SWARM]', `Connecting to: ${address}`);

    try {
      this.agent._connect(address);
    } catch (E) {
      this.error('Error connecting:', E);
    }
  }

  /**
   * Explicitly trust an {@link EventEmitter} to provide messages using
   * the expected {@link Interface}, providing {@link Message} objects as
   * the expected {@link Type}.
   * @param {EventEmitter} source {@link Actor} to utilize.
   */
  trust (source) {
    super.trust(source);
    const swarm = this;

    swarm.agent.on('ready', function (agent) {
      swarm.emit('agent', agent);
    });

    swarm.agent.on('state', function (state) {
      console.log('[FABRIC:SWARM]', 'Received state from agent:', state);
      swarm.emit('state', state);
    });

    swarm.agent.on('change', function (change) {
      console.log('[FABRIC:SWARM]', 'Received change from agent:', change);
      swarm.emit('change', change);
    });

    swarm.agent.on('patches', function (patches) {
      console.log('[FABRIC:SWARM]', 'Received patches from agent:', patches);
      swarm.emit('patches', patches);
    });

    // TODO: consider renaming this to JOIN
    swarm.agent.on('peer', function (peer) {
      console.log('[FABRIC:SWARM]', 'Received peer from agent:', peer);
      swarm._registerPeer(peer);
    });

    // Connections & Peering
    swarm.agent.on('connections:open', function (connection) {
      swarm.emit('connections:open', connection);
    });

    swarm.agent.on('connections:close', function (connection) {
      swarm.emit('connections:close', connection);
      swarm._fillPeerSlots();
    });

    swarm.agent.on('collections:post', function (message) {
      swarm.emit('collections:post', message);
    });

    // Final Notification
    swarm.agent.on('ready', function (info) {
      swarm.log(`swarm is ready (${info.id})`);
      swarm.emit('ready');
      swarm._fillPeerSlots();
    });

    return this;
  }

  _broadcastTypedMessage (type, msg) {
    if (!type) return new Error('Message type must be supplied.');
    this.agent._broadcastTypedMessage(type, msg);
  }

  _registerPeer (peer) {
    let swarm = this;
    if (!swarm.peers[peer.id]) swarm.peers[peer.id] = peer;
    swarm.emit('peer', peer);
  }

  _scheduleReconnect (peer) {
    let swarm = this;
    this.log('schedule reconnect:', peer);

    // TODO: store timers globally (ConnectionManager?)
    // TODO: exponential backoff for reconnections
    // starts at 60s timer
    if (swarm.peers[peer.id]) {
      if (swarm.peers[peer.id].timer) return true;
      swarm.peers[peer.id].timer = setTimeout(function () {
        clearTimeout(swarm.peers[peer.id].timer);
        swarm.connect(peer);
      }, 60000);
    }
  }

  _fillPeerSlots () {
    let swarm = this;
    let slots = MAX_PEERS - Object.keys(this.nodes).length;
    let peers = Object.keys(this.peers).map(function (id) {
      if (swarm.settings.verbosity >= 5) console.log('[FABRIC:SWARM]', '_fillPeerSlots()', 'Checking:', swarm.peers[id]);
      return swarm.peers[id].address;
    });
    let candidates = swarm.config.peers.filter(function (address) {
      return !peers.includes(address);
    });

    if (slots) {
      // TODO: use `slots` from above
      for (let i = 0; (i < candidates.length && i < slots); i++) {
        swarm._scheduleReconnect(candidates[i]);
      }
    }
  }

  async _connectSeedNodes () {
    console.log('[FABRIC:SWARM]', 'Connecting to seed nodes...', this.settings.seeds);
    for (let id in this.settings.seeds) {
      console.log('[FABRIC:SWARM]', 'Iterating on seed:', this.settings.seeds[id]);
      this.connect(this.settings.seeds[id]);
    }
  }

  /**
   * Begin computing.
   * @return {Promise} Resolves to instance of {@link Swarm}.
   */
  async start () {
    console.log('[FABRIC:SWARM]', 'Starting...');
    await super.start();
    await this.trust(this.agent);
    await this.agent.start();
    await this._connectSeedNodes();
    console.log('[FABRIC:SWARM]', 'Started!');
    return this;
  }

  async stop () {
    console.log('[FABRIC:SWARM]', 'Stopping...');
    await this.agent.stop();
    await super.stop();
    console.log('[FABRIC:SWARM]', 'Stopped!');
    return this;
  }
}

module.exports = Swarm;
