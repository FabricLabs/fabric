'use strict';

const { composeUseCases } = require('../usecases');

const packs = composeUseCases(['document-market']);

module.exports = {
  name: 'document-relay-private',
  peerCount: 3,
  topology: 'line',
  steps: 12,
  seed: 88,
  weightMaps: packs.weightMaps,
  setup: packs.setup,
  assert (ctx) {
    const m = ctx.state && ctx.state.documentMarket && ctx.state.documentMarket.metrics;
    if (!m) throw new Error('documentMarket metrics missing');
    if (!(m.relayFeesPaid >= 1) || !(m.relayHops >= 1)) {
      throw new Error('expected private DocumentRequest rewrite on line topology');
    }
    if (m.buyerUnlinkable !== 1) throw new Error('buyer unlinkability flag missing');
  }
};
