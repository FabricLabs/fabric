'use strict';

// Settings
const defaults = require('../settings/default');
const playnet = require('../settings/playnet');

const settings = {
  upnp: false,
  listen: true,
  // sideload playnet
  peers: [].concat(playnet.peers),
  services: [
    'exchange',
    'btca',
    'btcb',
  ],
  key: {
    seed: playnet.seed
  },
  bitcoin: {
    mode: 'rpc'
  },
  turntable: playnet.turntable || null
};

// Fabric Types
const CLI = require('../types/cli');

// Services
const Bitcoin = require('../services/bitcoin');
const Ethereum = require('../services/ethereum');
const Exchange = require('../services/exchange');

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
  exchange._registerService('exchange', Exchange);
  exchange._registerService('btca', Bitcoin);
  exchange._registerService('btcb', Bitcoin);
  // exchange._registerService('eth', Ethereum);

  await exchange.start();

  // Resolves to 0 or <Hash256>
  return exchange.fingerprint();
}

// Module
module.exports = OP_EXCHANGE;
