'use strict';

/**
 * Mocha smoke for the Fabric network simulator (opt-in via npm run test:simulator).
 */

const assert = require('assert');
const { runScenario, getScenario, listScenarios } = require('./index');
const { e2eRegtestEnabled } = require('./lib/regtestBeacon');

describe('fabric network simulator', function () {
  this.timeout(180000);

  async function runWithAssert (scenarioName, overrides = {}) {
    const scenario = getScenario(scenarioName);
    let captured = null;
    const wrapped = Object.assign({}, scenario, {
      async setup (ctx) {
        await scenario.setup(ctx);
        captured = ctx;
        if (typeof scenario.assert === 'function') scenario.assert(ctx);
      }
    });
    const { report } = await runScenario(wrapped, overrides);
    assert.strictEqual(report.hardErrors.length, 0, JSON.stringify(report.hardErrors));
    return { report, captured };
  }

  it('lists known scenarios', function () {
    const names = listScenarios();
    assert.ok(names.includes('smoke'));
    assert.ok(names.includes('document-swarm'));
    assert.ok(names.includes('document-relay-private'));
    assert.ok(names.includes('beacon-registry'));
    assert.ok(names.includes('mixed-fuzz'));
  });

  it('smoke scenario completes with actions and no hard errors', async function () {
    const { report } = await runWithAssert('smoke', {
      seed: 42,
      steps: 48,
      peers: 3,
      topology: 'star'
    });

    assert.strictEqual(report.scenario, 'smoke');
    assert.strictEqual(report.seed, 42);
    assert.ok(report.actionsExecuted > 0, 'expected actions to execute');
    assert.ok(report.elapsedMs != null && report.elapsedMs >= 0);
    assert.ok(
      report.maxConnectionsObserved >= 1,
      'expected at least one Fabric connection during the run'
    );
    assert.ok(report.actionCounts && typeof report.actionCounts === 'object');
  });

  it('mesh-chat / contract-mesh / protocol-flow complete without hard errors', async function () {
    for (const name of ['mesh-chat', 'contract-mesh', 'protocol-flow']) {
      const scenario = getScenario(name);
      const { report } = await runWithAssert(name, {
        seed: scenario.seed,
        steps: Math.min(scenario.steps || 40, 60),
        peers: scenario.peerCount,
        topology: scenario.topology
      });
      assert.strictEqual(report.scenario, name);
      assert.ok(report.actionsExecuted > 0);
    }
  });

  it('mixed-fuzz completes without hard errors', async function () {
    const scenario = getScenario('mixed-fuzz');
    const { report } = await runWithAssert('mixed-fuzz', {
      seed: scenario.seed,
      steps: 80,
      peers: scenario.peerCount,
      topology: scenario.topology
    });
    assert.ok(report.actionsExecuted > 0);
  });

  it('document-swarm seeds multi-seller catalog', async function () {
    const { captured } = await runWithAssert('document-swarm', {
      seed: 77,
      steps: 24,
      peers: 4,
      topology: 'star'
    });
    assert.ok(captured.state.documentMarket.sellerCount >= 2);
  });

  it('document-relay-private rewrites budgeted requests on the line', async function () {
    const { captured } = await runWithAssert('document-relay-private', {
      seed: 88,
      steps: 12,
      peers: 3,
      topology: 'line'
    });
    assert.ok(captured.state.documentMarket.metrics.relayFeesPaid >= 1);
    assert.ok(captured.state.documentMarket.metrics.relayHops >= 1);
  });

  (e2eRegtestEnabled() ? it : it.skip)('beacon-registry seals document registry on regtest Beacon', async function () {
    this.timeout(300000);
    const prevEpochs = process.env.FABRIC_SIM_BEACON_EPOCHS;
    process.env.FABRIC_SIM_BEACON_EPOCHS = '3';
    try {
      const scenario = getScenario('beacon-registry');
      let captured = null;
      const wrapped = Object.assign({}, scenario, {
        async setup (ctx) {
          await scenario.setup(ctx);
          captured = ctx;
          if (typeof scenario.assert === 'function') scenario.assert(ctx);
        }
      });
      const { report } = await runScenario(wrapped, {
        seed: 20260724,
        steps: 16,
        peers: 3,
        topology: 'star'
      });
      assert.strictEqual(report.hardErrors.length, 0, JSON.stringify(report.hardErrors));
      assert.ok(captured.state.beaconRegistry.metrics.sealed >= 3);
      assert.ok(captured.state.beaconRegistry.expectedDigest);
      assert.ok(report.beaconAudit, 'expected beaconAudit on report');
      assert.strictEqual(report.beaconAudit.auditable, true, JSON.stringify(report.beaconAudit.summary));
      assert.ok(report.beaconAudit.files && report.beaconAudit.files.jsonPath);
      assert.ok(report.beaconAuditFull && report.beaconAuditFull.epochs.length >= 3);
      const coinbases = report.beaconAuditFull.epochs.map((e) => e.l1.coinbase.txid);
      assert.ok(coinbases.every((t) => /^[0-9a-f]{64}$/i.test(t)), 'expected real coinbase txids');
      assert.strictEqual(new Set(coinbases).size, coinbases.length, 'coinbase txids must be unique per epoch');
    } finally {
      if (prevEpochs == null) delete process.env.FABRIC_SIM_BEACON_EPOCHS;
      else process.env.FABRIC_SIM_BEACON_EPOCHS = prevEpochs;
    }
  });
});
