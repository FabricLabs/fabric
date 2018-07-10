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

  this.self = new Peer();
  // TODO: consider renaming to TX or `transaction`
  this.self.on('changes', function (changes) {
    console.log('[SWARM]', 'received changes:', changes);
  });
  this.self.start();

  this.self.on('ready', function () {
    for (let i = 0; i < self.config.peers.length; i++) {
      self.connect(self.config.peers[i]);
    }

    console.log('[SWARM]', 'started', 'peers:', self.peers);
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
