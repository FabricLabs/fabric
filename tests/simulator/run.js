#!/usr/bin/env node
'use strict';

/**
 * CLI: node tests/simulator/run.js [--scenario smoke] [--steps N] [--seed S] …
 */

const { EventEmitter } = require('events');
// Match tests/mocha-env.js so dense mesh dials do not trip MaxListeners warnings
// before Peer raises the floor (noise-protocol-stream shared handshake bus).
if ((EventEmitter.defaultMaxListeners || 10) < 96) {
  EventEmitter.defaultMaxListeners = 96;
}

const {
  runScenario,
  writeReport,
  getScenario,
  listScenarios
} = require('./index');

function parseArgs (argv) {
  const out = {
    scenario: process.env.FABRIC_SIM_SCENARIO || 'smoke',
    steps: process.env.FABRIC_SIM_STEPS ? Number(process.env.FABRIC_SIM_STEPS) : null,
    seed: process.env.FABRIC_SIM_SEED != null && process.env.FABRIC_SIM_SEED !== ''
      ? process.env.FABRIC_SIM_SEED
      : null,
    peers: process.env.FABRIC_SIM_PEERS ? Number(process.env.FABRIC_SIM_PEERS) : null,
    topology: process.env.FABRIC_SIM_TOPOLOGY || null,
    json: false,
    report: true,
    list: false,
    all: false,
    help: false
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--list') out.list = true;
    else if (a === '--all') out.all = true;
    else if (a === '--json') out.json = true;
    else if (a === '--no-report') out.report = false;
    else if (a === '--scenario' || a === '-s') out.scenario = argv[++i];
    else if (a === '--steps') out.steps = Number(argv[++i]);
    else if (a === '--seed') out.seed = argv[++i];
    else if (a === '--peers') out.peers = Number(argv[++i]);
    else if (a === '--topology') out.topology = argv[++i];
    else if (a.startsWith('--scenario=')) out.scenario = a.slice('--scenario='.length);
    else if (a.startsWith('--steps=')) out.steps = Number(a.slice('--steps='.length));
    else if (a.startsWith('--seed=')) out.seed = a.slice('--seed='.length);
    else if (a.startsWith('--peers=')) out.peers = Number(a.slice('--peers='.length));
    else if (a.startsWith('--topology=')) out.topology = a.slice('--topology='.length);
  }
  return out;
}

function printHelp () {
  console.log(`Fabric Core network simulator

Usage:
  node tests/simulator/run.js [options]

Options:
  --scenario <name>   ${listScenarios().join(' | ')}
  --all               run every scenario sequentially
  --steps <n>         action budget
  --seed <s>          PRNG seed
  --peers <n>         peer count
  --topology <t>      star | line | mesh
  --json              print full report JSON
  --no-report         do not write reports/simulator-latest.json
  --list              list scenarios
  -h, --help          this help

Env: FABRIC_SIM_SCENARIO, FABRIC_SIM_STEPS, FABRIC_SIM_SEED,
     FABRIC_SIM_PEERS, FABRIC_SIM_TOPOLOGY
`);
}

function formatSummary (report) {
  if (report.skipped) {
    return `scenario=${report.scenario} skipped=true`;
  }
  return [
    `scenario=${report.scenario}`,
    `seed=${report.seed}`,
    `peers=${report.peers}`,
    `topology=${report.topology}`,
    `steps=${report.steps}`,
    `actions=${report.actionsExecuted}`,
    `actionsPerSec=${report.actionsPerSec != null ? report.actionsPerSec.toFixed(1) : 'n/a'}`,
    `elapsedMs=${report.elapsedMs}`,
    `maxConnections=${report.maxConnectionsObserved}`,
    `hardErrors=${(report.hardErrors || []).length}`,
    `events=${JSON.stringify(report.events || {})}`
  ].join(' ');
}

async function runOne (name, args) {
  const scenario = getScenario(name);
  const { e2eRegtestEnabled } = require('./lib/regtestBeacon');
  if (name === 'beacon-registry' && !e2eRegtestEnabled()) {
    console.error(`[simulator] scenario=${name} skipped (set FABRIC_E2E_REGTEST=1)`);
    return {
      scenario: name,
      skipped: true,
      hardErrors: [],
      actionsExecuted: 0,
      events: {},
      seed: null,
      peers: scenario.peerCount,
      topology: scenario.topology,
      steps: 0,
      actionsPerSec: null,
      elapsedMs: 0,
      maxConnectionsObserved: 0
    };
  }

  const overrides = {};
  if (args.steps != null && Number.isFinite(args.steps)) overrides.steps = args.steps;
  if (args.seed != null) overrides.seed = args.seed;
  if (args.peers != null && Number.isFinite(args.peers)) overrides.peers = args.peers;
  if (args.topology) overrides.topology = args.topology;

  // Scenario assert (document / beacon) runs inside mocha; CLI still runs setup.
  const wrapped = Object.assign({}, scenario, {
    async setup (ctx) {
      await scenario.setup(ctx);
      if (typeof scenario.assert === 'function') scenario.assert(ctx);
    }
  });

  console.error(`[simulator] scenario=${scenario.name} …`);
  const { report } = await runScenario(wrapped, overrides);

  if (args.report && !args.all) {
    const file = writeReport(report);
    console.error(`[simulator] wrote ${file}`);
  }

  if (report.beaconAudit && report.beaconAudit.files) {
    console.error(
      `[simulator] beacon audit json=${report.beaconAudit.files.jsonPath} md=${report.beaconAudit.files.mdPath}`
    );
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatSummary(report));
    if (report.beaconAudit && report.beaconAudit.summary) {
      const s = report.beaconAudit.summary;
      const epochs = (report.beaconAuditFull && report.beaconAuditFull.epochs) || [];
      const camp = s.campaign || {};
      console.log([
        `beaconAudit auditable=${report.beaconAudit.auditable}`,
        `reportHash=${report.beaconAudit.reportHash}`,
        `epochs=${s.epochsSealed}`,
        `l1=${s.l1HeightFirst}->${s.l1HeightLast}`,
        `docsPub=${camp.documentsPublished}`,
        `bytes=${camp.bytesPublished}`,
        `connectivity=${camp.connectivityChanges}`,
        `tipDigest=${s.tipStateDigest}`,
        `merkle=${s.beaconMerkleRoot}`
      ].join(' '));
      if (epochs.length <= 32) {
        for (const e of epochs) {
          console.log([
            `  epoch clock=${e.beaconClock}`,
            `height=${e.l1 && e.l1.height}`,
            `block=${e.l1 && (e.l1.blockHash || e.l1.hash)}`,
            `coinbase=${e.l1 && e.l1.coinbase && e.l1.coinbase.txid}`,
            `sidechain=${e.sidechain && e.sidechain.stateDigest}`
          ].join(' '));
        }
      } else {
        console.log(`  (epoch L1 details in audit JSON; deep sample count=${s.deepSampleCount})`);
      }
    }
  }

  return report;
}

async function main () {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return 0;
  }
  if (args.list) {
    for (const name of listScenarios()) console.log(name);
    return 0;
  }

  const names = args.all ? listScenarios() : [args.scenario];
  let failed = 0;
  for (const name of names) {
    const report = await runOne(name, args);
    if (report.hardErrors.length) {
      console.error('[simulator] hard errors:', JSON.stringify(report.hardErrors, null, 2));
      failed += 1;
    }
  }
  return failed ? 1 : 0;
}

main()
  .then((code) => {
    // Peer TCP servers can keep the event loop alive after stop(); force exit.
    process.exit(code);
  })
  .catch((err) => {
    console.error('[simulator] fatal:', err && (err.stack || err.message || err));
    process.exit(1);
  });
