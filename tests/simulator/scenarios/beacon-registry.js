'use strict';

const { composeUseCases } = require('../usecases');
const { e2eRegtestEnabled } = require('../lib/regtestBeacon');
const sidechainState = require('../../../functions/sidechainState');

const packs = composeUseCases(['beacon-registry', 'document-market']);

module.exports = {
  name: 'beacon-registry',
  peerCount: 5,
  topology: 'star',
  steps: 80,
  seed: 20260724,
  weightMaps: packs.weightMaps,
  setup: packs.setup,
  assert (ctx) {
    if (!e2eRegtestEnabled()) {
      if (!ctx.state || !ctx.state.beaconRegistry || !ctx.state.beaconRegistry.skipped) {
        throw new Error('expected skip flag when FABRIC_E2E_REGTEST unset');
      }
      return;
    }
    const br = ctx.state && ctx.state.beaconRegistry;
    const target = br && br.epochTarget ? br.epochTarget : 3;
    if (!br || br.metrics.sealed < target) {
      throw new Error(`expected ${target} sealed Beacon epochs, got ${br && br.metrics.sealed}`);
    }
    const last = br.epochs[br.epochs.length - 1];
    if (!last || !last.sidechain || !last.sidechain.stateDigest) {
      throw new Error('epoch missing sidechain seal');
    }
    if (last.sidechain.stateDigest !== br.expectedDigest) {
      throw new Error('sealed stateDigest does not match sidechain STATE');
    }
    const snap = sidechainState.loadSnapshotForBeaconClock(br.harness.fs, last.clock);
    if (!snap) throw new Error('missing sidechain snapshot for beacon clock');
    if (br.metrics.registryDocs < 2) throw new Error('expected registry documents after updates');

    const digests = br.epochs
      .map((e) => e && e.sidechain && e.sidechain.stateDigest)
      .filter(Boolean);
    if (digests.length >= 2 && digests[0] === digests[digests.length - 1]) {
      throw new Error('expected sidechain digest to change across registry updates');
    }
    const heights = br.epochs.map((e) => e.height).filter((h) => Number.isFinite(h));
    for (let i = 1; i < heights.length; i++) {
      if (!(heights[i] > heights[i - 1])) {
        throw new Error('expected strictly increasing L1 heights across epochs');
      }
    }
    if (target >= 100 && (br.metrics.documentsPublished || 0) < 50) {
      throw new Error('expected many document publishes during long campaign');
    }
    if (target >= 100 && (br.metrics.connectivityChanges || 0) < 3) {
      throw new Error('expected connectivity perturbations during long campaign');
    }
  }
};
