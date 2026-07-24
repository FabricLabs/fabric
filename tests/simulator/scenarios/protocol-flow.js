'use strict';

const { composeUseCases } = require('../usecases');

/**
 * General protocol flow: star mesh exercising session, chat, contracts,
 * documents/inventory, peering, state tips, and Bitcoin block gossip.
 * See docs/NETWORK_STATE_PROGRAM.md and contracts/protocol.dot.
 */
const packs = composeUseCases([
  'session',
  'chat',
  'contracts',
  'inventory',
  'gossip',
  'state',
  'bitcoin'
]);

module.exports = {
  name: 'protocol-flow',
  peerCount: 4,
  topology: 'star',
  steps: 160,
  seed: 2026,
  weightMaps: packs.weightMaps,
  setup: packs.setup,
  // Prefer the balanced protocol pack when merging (overrides thin packs)
  weights: require('../usecases/protocol').weights
};
