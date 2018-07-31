'use strict';

const util = require('util');
const Peer = require('./peer');

function Swarm (config) {
  this.config = Object.assign({
    peers: []
  }, config);
  this.peers = [];
  this.self = null;
}

util.inherits(Swarm, require('./vector'));

Swarm.prototype.start = function () {
  let swarm = this;

  // create a peer for one's own $self
  swarm.self = new Peer(swarm.config.peer);

  this.self.on('info', function (msg) {
    swarm.emit('info', msg);
  });

  // TODO: consider renaming this to JOIN
  this.self.on('peer', function (peer) {
    swarm.emit('peer', peer);
  });

  this.self.on('part', function (peer) {
    swarm.emit('part', peer);
  });

  this.self.on('connection', function (peer) {
    swarm.emit('connection', peer);
  });

  // TODO: consider renaming to TX or `transaction`
  this.self.on('changes', function (changes) {
    swarm.emit('changes', changes);
  });

  this.self.on('ready', function () {
    swarm.emit('ready');

    // TODO: set max connections
    for (let i = 0; i < swarm.config.peers.length; i++) {
      swarm.connect(swarm.config.peers[i]);
    }
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

module.exports = Swarm;
