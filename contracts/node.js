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
async function OP_START () {
  const peer = new Peer({
    listen: true,
    networking: true,
    oracles: this.trust || [],
    port: this.port
  });

  peer.on('error', (msg) => {
    console.error('[FABRIC:CLI]', 'Peer emitted error:', msg);
  });

  peer.on('warning', (msg) => {
    console.warn('[FABRIC:CLI]', 'Peer emitted warning:', msg);
  });

  peer.on('message', (msg) => {
    console.log('[FABRIC:CLI]', 'Peer emitted message:', msg);
  });

  peer.on('peer', (peer) => {
    console.log('[FABRIC:CLI]', 'Peer event:', peer);
  });

  peer.on('ready', (info) => {
    console.log('[FABRIC:CLI]', 'Peer ready!', info);
  });

  await peer.start();
}

// Module
module.exports = OP_START;
