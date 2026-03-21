/**
 * Settings for a local Fabric node.
 */

// # Local Settings
// You can use the `settings/local.js` file to configure your local Fabric node.
'use strict';

// ## Contracts
// Contracts are imported from the `contracts` directory.
// TODO: test env variables with OP_TEST
const OP_TEST = require('../contracts/test');

// ## Settings
// Settings are exported as a module.
module.exports = {
  name: process.env['NAME'],
  namespace: process.env['NAMESPACE'],
  seed: process.env['FABRIC_SEED'],
  xprv: process.env['FABRIC_XPRV'],
  xpub: process.env['FABRIC_XPUB'],
  port: process.env['FABRIC_PORT'] || 7777,
  functions: {
    OP_TEST: JSON.stringify(OP_TEST)
  },
  // TODO: regtest, playnet, signet, testnet, mainnet (in order)
  network: 'regtest',
  debug: false,
  fullnode: true,
  listen: true,
  // Render UI?
  render: true,
  // Open outbound connections?
  peering: true,
  // Known Peers
  peers: [
    'hub.fabric.pub:7777',
    'goliath:7777',
    'pike:7777',
    'gamma:7777'
  ],
  // Bitcoin
  bitcoin: {
    enable: true,
    managed: true,
    fullnode: true,
    // SPV mode: use remote node instead of local bitcoind (no blockchain download)
    // Set spvNode: '192.168.50.5' or FABRIC_BITCOIN_NODE=192.168.50.5 for mainnet
    // spvNode: '192.168.50.5'
  },
  // Lightning
  lightning: {
    enable: true,
    managed: true
  },
  // Subservices
  services: [
    'bitcoin',
    'lightning'
  ],
  upnp: true,
  // Log Level
  verbosity: 3 // STDOUT
};
