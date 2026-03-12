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
    '0223cffd5e94da3c8915c6b868f06d15183c1aeffad8ddf58fcb35a428e3158e71@hub.fabric.pub:7777'
  ],
  // Bitcoin
  bitcoin: {
    host: 'localhost',
    port: 8443,
    username: 'polaruser',
    password: 'polarpass',
    secure: false
  },
  // Lightning
  lightning: {
    host: 'localhost',
    macaroon: 'GET FROM CREST',
    mode: 'rest',
    path: './stores/lightning-playnet/regtest/lightning-rpc',
    port: 8181,
    secure: false
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
