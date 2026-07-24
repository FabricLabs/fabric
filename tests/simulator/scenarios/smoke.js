'use strict';

const { composeUseCases } = require('../usecases');

const packs = composeUseCases(['chat', 'contracts', 'gossip', 'session']);

/** Short CI-friendly star mesh with a fixed seed. */
module.exports = {
  name: 'smoke',
  peerCount: 3,
  topology: 'star',
  steps: 48,
  seed: 42,
  weightMaps: packs.weightMaps,
  setup: packs.setup
};
