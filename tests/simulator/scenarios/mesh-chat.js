'use strict';

const { composeUseCases } = require('./packs');

const packs = composeUseCases(['chat', 'gossip']);

module.exports = {
  name: 'mesh-chat',
  peerCount: 4,
  topology: 'mesh',
  steps: 120,
  seed: 7,
  weightMaps: packs.weightMaps,
  setup: packs.setup
};
