'use strict';

/**
 * Compose network + weighted actions + metrics into one runnable simulation.
 */

const fs = require('fs');
const path = require('path');
const { createRng } = require('./rng');
const { Metrics } = require('./metrics');
const { NetworkHarness } = require('./network');
const { ActionScheduler } = require('./scheduler');
const { actionsWithWeights, mergeWeights } = require('./actions');

const DEFAULT_REPORT = path.join(__dirname, '../../../reports/simulator-latest.json');

/**
 * @param {object} scenario
 * @param {object} [overrides] CLI / env overrides
 */
async function runScenario (scenario, overrides = {}) {
  const cfg = Object.assign({}, scenario, overrides);
  const seed = cfg.seed != null ? cfg.seed : 42;
  const rng = createRng(seed);
  const metrics = new Metrics();
  const peerCount = cfg.peers != null ? Number(cfg.peers) : (cfg.peerCount || 3);
  const topology = cfg.topology || 'star';
  const steps = cfg.steps != null ? Number(cfg.steps) : 40;

  const weights = mergeWeights(
    ...(Array.isArray(cfg.weightMaps) ? cfg.weightMaps : []),
    cfg.weights || {}
  );
  const actions = actionsWithWeights(weights);
  if (!actions.length) {
    throw new Error('scenario has no positive-weight actions');
  }

  const network = new NetworkHarness({
    peerCount,
    topology,
    metrics,
    connectTimeoutMs: cfg.connectTimeoutMs || 30000
  });

  const ctx = {
    network,
    rng,
    metrics,
    contractIds: [],
    scenario: cfg.name || 'anonymous'
  };

  metrics.start();
  try {
    await network.start();

    if (typeof cfg.setup === 'function') {
      await cfg.setup(ctx);
    }

    const scheduler = new ActionScheduler({
      actions,
      rng,
      metrics,
      steps,
      yieldEvery: cfg.yieldEvery != null ? cfg.yieldEvery : 8
    });
    await scheduler.run(ctx);

    if (typeof cfg.teardown === 'function') {
      await cfg.teardown(ctx);
    }

    // Beacon audit report needs live bitcoind RPC — finalize before harness stop.
    metrics.end();
    const report = metrics.toReport({
      scenario: cfg.name || scenario.name || 'anonymous',
      seed: rng.seed,
      peers: peerCount,
      topology,
      steps,
      connectionsAtEnd: 0,
      maxConnectionsObserved: metrics.maxConnectionsObserved
    });

    if (ctx && ctx.state && ctx.state.beaconRegistry &&
        typeof ctx.state.beaconRegistry._finalizeAudit === 'function') {
      try {
        const audit = await ctx.state.beaconRegistry._finalizeAudit(report);
        report.beaconAudit = {
          auditable: !!(audit && audit.auditable),
          reportHash: audit && audit.reportHash,
          summary: audit && audit.summary,
          files: ctx.state.beaconRegistry.auditFiles || null
        };
        report.beaconAuditFull = audit;
      } catch (err) {
        metrics.recordHardError({
          peer: 'beacon-audit',
          msg: err && (err.message || String(err))
        });
        report.hardErrors = metrics.hardErrors.slice();
      }
    }

    return { report, metrics, cfg, ctx };
  } finally {
    if (ctx && typeof ctx._beaconRegistryStop === 'function') {
      try {
        await ctx._beaconRegistryStop();
      } catch (_) { /* ignore */ }
      ctx._beaconRegistryStop = null;
    }
    if (metrics.endedAt == null) metrics.end();
    await network.stop();
  }
}

/**
 * @param {object} report
 * @param {string} [file]
 */
function writeReport (report, file = DEFAULT_REPORT) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n', 'utf8');
  return file;
}

module.exports = {
  runScenario,
  writeReport,
  DEFAULT_REPORT
};
