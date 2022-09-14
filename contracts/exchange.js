'use strict';

// Settings
// const defaults = require('../settings/default');
const playnet = require('../settings/playnet');

const settings = {
  debug: true,
  upnp: false,
  listen: true,
  persistent: false, // Loads from anchor chain
  // sideload playnet
  // peers: [].concat(playnet.peers),
  peers: [],
  services: [
    'exchange',
    'btca',
    'btcb',
    'lightning'
  ],
  key: {
    seed: playnet.seed
  },
  anchor: 'BTCA',
  bitcoin: false, // disable Bitcoin (for now)
  btca: playnet.btca || null, // Test Provider
  btcb: playnet.btcb || null, // Test Provider
  currencies: [].concat(playnet.currencies),
  orders: [
    {
      have: {
        symbol: 'BTCB',
        amount: 0.1
      },
      want: {
        symbol: 'BTCA',
        amount: 0.1
      }
    }
  ]
};

// Fabric Types
const CLI = require('../types/cli');

// Services
const Bitcoin = require('../services/bitcoin');
// const Ethereum = require('../services/ethereum');
// const Exchange = require('../services/exchange');
// const Lightning = require('../services/lightning');

// Program Definition
async function OP_EXCHANGE () {
  // Configure Earning
  if (this.earn) {
    console.log('[!!] earning enabled [!!!]');
    console.log('This node will attempt to bid on live contracts.  Beware of');
    console.log('the consequences of your actions!');
  }

  if (this.seed) {
    settings.key.seed = this.seed;
  } else if (process.env.FABRIC_SEED) {
    settings.key.seed = this.seed;
  }

  // Fabric CLI
  const exchange = new CLI(settings);

  // ## Services
  // TODO: reconcile API wth @fabric/doorman as appears at: https://github.com/FabricLabs/doorman
  // exchange._registerService('exchange', Exchange);
  exchange._registerService('btca', Bitcoin);
  exchange._registerService('btcb', Bitcoin);
  // exchange._registerService('eth', Ethereum);
  // exchange._registerService('lightning', Lightning);

  await exchange.start();

  // Resolves to 0 or <Hash256>
  return exchange.fingerprint();
}

// Module
module.exports = OP_EXCHANGE;
