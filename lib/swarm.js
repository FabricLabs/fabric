'use strict';

const Peer = require('./peer');
const Scribe = require('./scribe');

const MAX_PEERS = 16;

class Swarm extends Scribe {
  constructor (config) {
    super(config);

    this.name = 'Swarm';
    this.config = Object.assign({
      peers: []
    }, config);

    this.nodes = {};
    this.peers = {};

    return this;
  }

  broadcast (msg) {
    this.self.broadcast(msg);
  }

  connect (address) {
    this.log(`connecting to: ${address}`);

    try {
      this.self._connect(address);
    } catch (E) {
      console.log('Error connecting:', E);
    }
  }

  trust (source) {
    super.trust(source);
  }

  _broadcastTypedMessage (type, msg) {
    if (!type) return new Error('Message type must be supplied.');
    this.self._broadcastTypedMessage(type, msg);
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
      swarm.log('checking:', swarm.peers[id]);
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

  async start () {
    await super.start();

    let swarm = this;

    // create a peer for one's own $self
    swarm.self = new Peer(swarm.config.peer);

    swarm.self.on('info', function (msg) {
      swarm.emit('info', msg);
    });

    // TODO: consider renaming this to JOIN
    swarm.self.on('peer', function (peer) {
      swarm._registerPeer(peer);
    });

    swarm.self.on('connections:open', function (connection) {
      swarm.emit('connections:open', connection);
    });

    swarm.self.on('connections:close', function (connection) {
      swarm.emit('connections:close', connection);
      swarm._fillPeerSlots();
    });

    swarm.self.on('collections:post', function (message) {
      swarm.emit('collections:post', message);
    });

    swarm.self.on('ready', function (info) {
      swarm.log(`swarm is ready (${info.id})`);
      swarm.emit('ready');
      swarm._fillPeerSlots();
    });

    return swarm.self.start();
  }
}

module.exports = Swarm;
