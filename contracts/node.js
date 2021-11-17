// # Fabric Peer Contract
// Defines the behavior of a standard Fabric node.
//
// ## Quick Start
// Install Fabric using `npm i -g @fabric/core` then execute `fabric start` to
// run a local node.  See `fabric --help` for additional options.
'use strict';

// Fabric Types
const Node = require('../types/node');

// Program Definition
async function OP_START (input = {}) {
  const node = new Node(input);
  return node.start();
}

// Module
module.exports = OP_START;
