'use strict';

const { composeUseCases } = require('../usecases');

const packs = composeUseCases(['contracts', 'chat', 'inventory']);

module.exports = {
  name: 'contract-mesh',
  peerCount: 4,
  topology: 'star',
  steps: 100,
  seed: 99,
  weightMaps: packs.weightMaps,
  setup: packs.setup
};
