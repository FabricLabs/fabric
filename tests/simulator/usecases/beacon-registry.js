'use strict';

const { e2eRegtestEnabled, startRegtestBeaconHarness } = require('../lib/regtestBeacon');
const {
  buildBeaconAuditReport,
  writeBeaconAuditReport
} = require('../lib/beaconAuditReport');
const {
  beaconEpochTarget,
  runBeaconCampaign
} = require('../lib/beaconLongRun');

/**
 * Regtest Beacon + document registry seal (requires FABRIC_E2E_REGTEST=1).
 *
 * Long campaign (default FABRIC_SIM_BEACON_EPOCHS=1000): many L1 seals with
 * mixed-size document exchanges and connectivity perturbations between
 * transaction broadcasts. Mocha smoke sets FABRIC_SIM_BEACON_EPOCHS=3.
 */
module.exports = {
  name: 'beacon-registry',
  weights: {
    'document.publish': 3,
    'document.request': 2,
    'inventory.request': 2,
    'peer.ping': 1,
    'peer.disconnect': 1,
    'peer.reconnect': 1
  },

  async setup (ctx) {
    ctx.state = ctx.state || {};
    ctx.state.beaconRegistry = {
      skipped: !e2eRegtestEnabled(),
      epochs: [],
      metrics: {
        sealed: 0,
        registryDocs: 0,
        registryUpdates: 0,
        documentsPublished: 0,
        documentsRequested: 0,
        bytesPublished: 0,
        connectivityChanges: 0,
        sizeHistogram: Object.create(null)
      },
      auditReport: null,
      auditFiles: null,
      epochTarget: 0
    };

    if (!e2eRegtestEnabled()) {
      ctx.metrics.note('beacon-registry skipped (set FABRIC_E2E_REGTEST=1)');
      return;
    }

    const harness = await startRegtestBeaconHarness();
    ctx.state.beaconRegistry.harness = harness;

    const epochTarget = beaconEpochTarget();
    ctx.state.beaconRegistry.epochTarget = epochTarget;
    ctx.metrics.note(`beacon-registry campaign: ${epochTarget} epochs`);

    const campaign = await runBeaconCampaign(ctx, harness, {
      epochTarget,
      onProgress (p) {
        console.error(
          `[beacon-registry] epoch ${p.i}/${p.epochTarget}` +
          ` sealed=${p.sealed} height=${p.height}` +
          ` connectivity=${p.connectivity}` +
          ` docs=${p.docs} bytes=${p.bytes}`
        );
      }
    });

    ctx.state.beaconRegistry.epochs = campaign.epochs;
    ctx.state.beaconRegistry.metrics = Object.assign(
      ctx.state.beaconRegistry.metrics,
      campaign.metrics
    );
    ctx.state.beaconRegistry.connectivityLog = campaign.connectivityLog;
    ctx.state.beaconRegistry.exchangeLog = campaign.exchangeLog;
    ctx.state.beaconRegistry.expectedDigest = campaign.expectedDigest;
    ctx.state.beaconRegistry.sidechainClock = campaign.sidechainClock;

    ctx.state.beaconRegistry._finalizeAudit = async (simReport) => {
      const audit = await buildBeaconAuditReport(ctx, simReport || null);
      ctx.state.beaconRegistry.auditReport = audit;
      if (!audit.skipped) {
        ctx.state.beaconRegistry.auditFiles = writeBeaconAuditReport(audit);
        ctx.metrics.note(
          `beacon audit: ${ctx.state.beaconRegistry.auditFiles.jsonPath}`
        );
      }
      return audit;
    };

    const prevTeardown = ctx._beaconRegistryStop;
    ctx._beaconRegistryStop = async () => {
      if (typeof prevTeardown === 'function') await prevTeardown();
      await harness.stop();
    };
  }
};
