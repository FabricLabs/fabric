'use strict';

// Contracts
// TODO: test env variables with OP_TEST
const OP_TEST = require('../contracts/test');

// Settings
module.exports = {
  name: process.env['NAME'],
  namespace: process.env['NAMESPACE'],
  seed: process.env['FABRIC_SEED'],
  xprv: process.env['FABRIC_XPRV'],
  xpub: process.env['FABRIC_XPUB'],
  port: process.env['FABRIC_PORT'],
  // Strict Functions
  functions: {
    OP_TEST: JSON.stringify(OP_TEST)
  },
  // TODO: regtest, playnet, signet, testnet, mainnet (in order)
  network: 'playnet',
  // TODO: test `true`
  fullnode: false,
  // Open listener?
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
    // 'bitcoin',
    // 'lightning',
    // 'matrix'
  ],
  // Log Level
  verbosity: 3 // STDOUT
};
