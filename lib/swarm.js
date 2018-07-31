'use strict';

const util = require('util');
const Peer = require('./peer');

const MAX_PEERS = 8;

function Swarm (config) {
  this.name = 'Swarm';
  this.config = Object.assign({
    peers: []
  }, config);

  this.nodes = {};
  this.self = null;
}

util.inherits(Swarm, require('./vector'));

Swarm.prototype.broadcast = function broadcast (msg) {
  this.self.broadcast(msg);
};

Swarm.prototype.start = function () {
  let swarm = this;

  // create a peer for one's own $self
  swarm.self = new Peer(swarm.config.peer);

  swarm.self.on('info', function (msg) {
    swarm.emit('info', msg);
  });

  // TODO: consider renaming this to JOIN
  this.self.on('peer', function (peer) {
    swarm.emit('peer', peer);
  });

  swarm.self.on('part', function (peer) {
    swarm.emit('part', peer);
    swarm._fillPeerSlots();
  });

  swarm.self.on('connection', function (peer) {
    swarm.emit('connection', peer);
  });

  // TODO: consider renaming to TX or `transaction`
  this.self.on('changes', function (changes) {
    swarm.emit('changes', changes);
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
};

Swarm.prototype.connect = function (address) {
  this.log(`connecting to: ${address}`);

  try {
    this.self._connect(address);
  } catch (E) {
    console.log('Error connecting:', E);
  }
};

Swarm.prototype._broadcastTypedMessage = function broadcast (type, msg) {
  if (!type) return new Error('Message type must be supplied.');
  this.self._broadcastTypedMessage(type, msg);
};

Swarm.prototype._fillPeerSlots = function findPeers () {
  let swarm = this;
  let slots = MAX_PEERS - Object.keys(this.nodes).length;
  // TODO: use candidate array, filter exiting connections
  let candidates = swarm.config.peers;

  if (slots) {
    // TODO: use `slots` from above
    for (let i = 0; i < swarm.config.peers.length; i++) {
      swarm.connect(swarm.config.peers[i]);
    }
  }
};

module.exports = Swarm;
