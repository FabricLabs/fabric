'use strict';

const { composeUseCases } = require('../usecases');

const packs = composeUseCases([
  'chat',
  'contracts',
  'gossip',
  'inventory',
  'session',
  'state',
  'bitcoin',
  'chaos'
]);

module.exports = {
  name: 'mixed-fuzz',
  peerCount: 5,
  topology: 'mesh',
  steps: 200,
  seed: 12345,
  weightMaps: packs.weightMaps,
  setup: packs.setup,
  weights: {
    'peer.disconnect': 3,
    'peer.reconnect': 4,
    'chaos.raw': 2,
    'contract.proposal': 2,
    'bitcoin.block': 3,
    'state.change': 3
  }
};
