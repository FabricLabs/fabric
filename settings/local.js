'use strict';

// Environment
const Environment = require('../types/environment');
const environment = new Environment({ namespace: 'fabric' });

// Contracts
// TODO: test env variables with OP_TEST
const OP_TEST = require('../contracts/test');

// Settings
module.exports = {
  name: environment.readVariable('NAME'),
  namespace: environment.readVariable('NAMESPACE'),
  // TODO: replace with `key` Object({ seed, xprv, xpub })
  seed: environment.readVariable('FABRIC_SEED'),
  xprv: environment.readVariable('FABRIC_XPRV'),
  xpub: environment.readVariable('FABRIC_XPUB'),
  // Strict Functions
  functions: {
    OP_TEST: JSON.stringify(OP_TEST)
  },
  // TODO: derive from `key` property
  public: '0375f7cfc3fa3bc9ed621019018fca678da404a29c8dfec4350855b5ad2f0a42d7',
  // @deprecated
  authority: 'http://ahp7iuGhae8mooBahFaYieyaixei6too:naiRe9wo5vieFayohje5aegheenoh4ee@localhost:20444',
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
