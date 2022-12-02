'use strict';

const Environment = require('../types/environment');
const environment = new Environment({ namespace: 'fabric' });

const settings = {
  name: environment.readVariable('NAME'),
  seed: environment.readVariable('FABRIC_SEED'),
  xprv: environment.readVariable('FABRIC_XPRV'),
  xpub: environment.readVariable('FABRIC_XPUB'),
  public: '0223cffd5e94da3c8915c6b868f06d15183c1aeffad8ddf58fcb35a428e3158e71',
  authority: 'http://ahp7iuGhae8mooBahFaYieyaixei6too:naiRe9wo5vieFayohje5aegheenoh4ee@localhost:20444',
  network: 'playnet',
  fullnode: false,
  listen: true,
  render: true,
  peers: [
    '0223cffd5e94da3c8915c6b868f06d15183c1aeffad8ddf58fcb35a428e3158e71@hub.fabric.pub:7777'
  ],
  lightning: {
    host: 'localhost',
    macaroon: 'GET FROM CREST',
    mode: 'rest',
    path: './stores/lightning-playnet/regtest/lightning-rpc',
    port: 8181,
    secure: false
  },
  services: [
    // 'bitcoin',
    // 'lightning',
    // 'matrix'
  ],
  verbosity: 3
};

module.exports = settings;
