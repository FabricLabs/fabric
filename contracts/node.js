// # Fabric Peer Contract
// Defines the behavior of a standard Fabric node.
//
// ## Quick Start
// Install Fabric using `npm i -g @fabric/core` then execute `fabric start` to
// run a local node.  See `fabric --help` for additional options.
'use strict';

// Fabric Types
const Peer = require('../types/peer');

// Program Definition
async function OP_START (state = {}) {
  const peer = new Peer(state);

  peer.on('message', (msg) => {
    console.log('[FABRIC:CLI]', 'Peer emitted message:', msg);
  });

  peer.on('ready', () => {
    console.log('[FABRIC:CLI]', 'Peer ready!');
  });

  await peer.start();
}

// Module
module.exports = OP_START;