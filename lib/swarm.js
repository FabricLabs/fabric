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
  let self = this;

  this.self = new Peer(this.config.peer);

  // TODO: consider renaming to TX or `transaction`
  this.self.on('changes', function (changes) {
    self.emit('changes', changes);
  });

  this.self.start();

  this.self.on('ready', function () {
    self.emit('ready');

    // TODO: set max connections
    for (let i = 0; i < self.config.peers.length; i++) {
      self.connect(self.config.peers[i]);
    }
  });
};

Swarm.prototype.connect = function (address) {
  console.log('[SWARM]', 'connecting to:', address);
  try {
    this.self._connect(address);
  } catch (E) {
    console.log('Error connecting:', E);
  }
};

module.exports = Swarm;
