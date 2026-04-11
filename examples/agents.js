'use strict';

/**
 * Multi-core {@link Service} distributor with optional managed Bitcoin (regtest) + dual Lightning nodes.
 *
 * ## CLI (preferred)
 *
 * | Flag | Purpose |
 * |------|---------|
 * | `--help`, `-h` | Usage and environment reference |
 * | `--smoke` | One-shot distributor smoke (drain queue, exit 0); same idea as skip-chain |
 * | `--distributor-only` | Distributor + workers + producer loop until SIGINT/ SIGTERM (no Bitcoin / Lightning) |
 * | `--bitcoin-only` | Regtest Bitcoin + distributor + producer; no Lightning (lighter “real” stack) |
 * | `--work-ms=<n>` | Worker simulated job duration (also `FABRIC_AGENTS_WORK_MS`) |
 * | `--status-json` | Emit machine-readable status lines (also `FABRIC_AGENTS_STATUS_JSON=1`) |
 *
 * ## Environment
 *
 * - **`FABRIC_AGENTS_SKIP_CHAIN=1`** — CI-style smoke (exit after queue drains); same worker caps as `--smoke` unless `--distributor-only` / `--bitcoin-only`.
 * - **`FABRIC_AGENTS_WORK_MS`** — per-job delay inside workers (default `1200` full stack, `25` when skip-chain).
 * - **`FABRIC_AGENTS_PRODUCER_TARGET`** — number of accepted jobs to process before stopping (default `1000`).
 * - **`FABRIC_AGENTS_MAX_QUEUE`** — queue capacity before unpaid jobs must rebid (default `64`).
 * - **`FABRIC_AGENTS_PRODUCER_INTERVAL_MS`** — producer tick interval in ms (default `100`).
 * - **`FABRIC_AGENTS_PRODUCER_BATCH_SIZE`** — jobs attempted per producer tick (default `max(4, cores)`).
 * - **`FABRIC_AGENTS_FAST_BID_EVERY`** — submit a pre-paid fast-lane bid every N jobs (default `25`).
 * - **`FABRIC_AGENTS_FAST_BID_AMOUNT`** — sats used for periodic fast-lane bids (default `3`).
 * - **`FABRIC_AGENTS_STATUS_JSON=1`** — emit JSON status snapshots (plus normal human-readable logs).
 * - **`FABRIC_AGENTS_BOOT_IDLE_MS`** — max wait (ms) for initial queue drain after startup (default `120000`).
 * - **`FABRIC_AGENTS_WORK_SHA256_ITERS`** — optional CPU work per job (SHA-256 loop, capped at 2M) for load testing.
 * - **`FABRIC_MNEMONIC`** — optional; smoke / distributor-only use {@link FIXTURE_SEED} when unset.
 * - **`FABRIC_CLEAN_ALICE=1`** — remove Alice CLN datadir before start (stale socket recovery).
 * - **`FABRIC_BITCOIN_COOKIE_FILE`** — path to `bitcoind` `.cookie` when reusing a regtest node on `:18443` outside `./stores/bitcoin-regtest` (see {@link Bitcoin} RPC probe).
 *
 * ## npm scripts
 *
 * - `npm run example:agents:smoke` — `FABRIC_AGENTS_SKIP_CHAIN=1 node examples/agents.js`
 * - `npm run example:agents:distributor` — long-running distributor-only demo
 * - `npm run example:agents:bitcoin` — Bitcoin regtest + distributor (no Lightning)
 */

// Parse argv before constants that read `process.env` (e.g. `FABRIC_AGENTS_WORK_MS`).
// Use globalThis: local `const process = require('process')` below is still in TDZ during this IIFE.
const AGENTS_CLI = (function parseAgentsCli () {
  const flags = {
    help: false,
    smoke: false,
    distributorOnly: false,
    bitcoinOnly: false,
    statusJson: false
  };
  const proc = globalThis.process;
  const argv = proc.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') flags.help = true;
    else if (a === '--smoke') flags.smoke = true;
    else if (a === '--distributor-only') flags.distributorOnly = true;
    else if (a === '--bitcoin-only') flags.bitcoinOnly = true;
    else if (a === '--status-json') flags.statusJson = true;
    else if (a === '--work-ms') {
      const next = argv[i + 1];
      if (next != null && next !== '' && !String(next).startsWith('-')) {
        proc.env.FABRIC_AGENTS_WORK_MS = String(argv[++i]);
      }
    } else if (/^--work-ms=/.test(a)) {
      const v = a.replace(/^--work-ms=/, '');
      if (v !== '') proc.env.FABRIC_AGENTS_WORK_MS = v;
    }
  }
  return flags;
})();

// Dependencies
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const process = require('process');
const { encodeCheck, decodeCheck } = require('../functions/base58');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const { FIXTURE_SEED } = require('../constants');
// TODO: ensure utilization of multiple cores

// Fabric Types
const Service = require('../types/service');
const Entity = require('../types/entity');
const State = require('../types/state');
const Tree = require('../types/tree');

// Services
const Bitcoin = require('../services/bitcoin');
const Lightning = require('../services/lightning');

// Configuration
const _cpuCount = Math.max(1, os.cpus().length);
/**
 * Light paths cap workers / shorten delays: explicit `--smoke`, or skip-chain env when not running
 * distributor-only / bitcoin-only full demos (those intentionally use all CPUs).
 */
const _agentsLightWorkerProfile = AGENTS_CLI.smoke ||
  (process.env.FABRIC_AGENTS_SKIP_CHAIN === '1' &&
    !AGENTS_CLI.distributorOnly &&
    !AGENTS_CLI.bitcoinOnly);
/** Full stack uses all CPUs; smoke / skip-chain caps workers so CI / laptops do not spawn dozens of threads. */
const numberOfCores = _agentsLightWorkerProfile
  ? Math.min(4, _cpuCount)
  : _cpuCount;
const workDelayMsEnv = Number(process.env.FABRIC_AGENTS_WORK_MS);
const AGENT_WORK_DELAY_MS = (Number.isFinite(workDelayMsEnv) && workDelayMsEnv >= 0)
  ? workDelayMsEnv
  : (_agentsLightWorkerProfile ? 25 : 1200);
const maxQueueEnv = Number(process.env.FABRIC_AGENTS_MAX_QUEUE);
const DEFAULT_MAX_QUEUE = (Number.isFinite(maxQueueEnv) && maxQueueEnv > 0)
  ? Math.floor(maxQueueEnv)
  : 64;
const BITCOIN_NETWORK = 'regtest';
const bootIdleMsEnv = Number(process.env.FABRIC_AGENTS_BOOT_IDLE_MS);
const FABRIC_AGENTS_BOOT_IDLE_MS = (Number.isFinite(bootIdleMsEnv) && bootIdleMsEnv > 0)
  ? bootIdleMsEnv
  : 120000;
const producerIntervalEnv = Number(process.env.FABRIC_AGENTS_PRODUCER_INTERVAL_MS);
const PRODUCER_INTERVAL_MS = (Number.isFinite(producerIntervalEnv) && producerIntervalEnv > 0)
  ? Math.floor(producerIntervalEnv)
  : 100;
const producerBatchEnv = Number(process.env.FABRIC_AGENTS_PRODUCER_BATCH_SIZE);
const PRODUCER_BATCH_SIZE = (Number.isFinite(producerBatchEnv) && producerBatchEnv > 0)
  ? Math.floor(producerBatchEnv)
  : Math.max(4, numberOfCores);
const producerTargetEnv = Number(process.env.FABRIC_AGENTS_PRODUCER_TARGET);
const PRODUCER_TARGET = (Number.isFinite(producerTargetEnv) && producerTargetEnv > 0)
  ? Math.floor(producerTargetEnv)
  : 1000;
const fastBidEveryEnv = Number(process.env.FABRIC_AGENTS_FAST_BID_EVERY);
const PRODUCER_FAST_BID_EVERY = (Number.isFinite(fastBidEveryEnv) && fastBidEveryEnv > 0)
  ? Math.floor(fastBidEveryEnv)
  : 25;
const fastBidAmountEnv = Number(process.env.FABRIC_AGENTS_FAST_BID_AMOUNT);
const PRODUCER_FAST_BID_AMOUNT = (Number.isFinite(fastBidAmountEnv) && fastBidAmountEnv >= 1)
  ? Math.floor(fastBidAmountEnv)
  : 3;

/** Initial queue-drain deadline: respect `FABRIC_AGENTS_BOOT_IDLE_MS` but keep a sensible floor. */
function agentsBootstrapDrainDeadlineMs (waves, delayMs) {
  const computed = 3000 + waves * delayMs + 2000;
  return Math.min(FABRIC_AGENTS_BOOT_IDLE_MS, Math.max(25000, computed));
}
const INITIAL_SPENDABLE_BLOCKS = 101;
const BLOCK_INTERVAL_MS = 10000;
const LIGHTNING_FUNDING_RATIO = 0.5;
const LIGHTNING_DEPOSIT_CONFIRM_BLOCKS = 6;
const FABRIC_MNEMONIC = process.env.FABRIC_MNEMONIC || null;
const ALICE_LIGHTNING_PORT = 19735;
const MIN_CHANNEL_FUNDING_SATS = 10000;
const MAX_ALICE_DEPOSIT_BTC = 1;

const workShaEnv = Number(process.env.FABRIC_AGENTS_WORK_SHA256_ITERS);
const WORK_SHA256_ITERS = (Number.isFinite(workShaEnv) && workShaEnv > 0)
  ? Math.min(Math.floor(workShaEnv), 2_000_000)
  : 0;
const AGENTS_STATUS_JSON = AGENTS_CLI.statusJson || process.env.FABRIC_AGENTS_STATUS_JSON === '1';

// Work Function
const work = function (payload = {}) {
  this.queueProcessed = (this.queueProcessed || 0) + 1;
  this.lastPayload = payload.index;
  const workSha256Iters = (Number.isFinite(Number(this.workSha256Iters)) && Number(this.workSha256Iters) > 0)
    ? Math.min(Math.floor(Number(this.workSha256Iters)), 2_000_000)
    : 0;
  const workDelayMs = (Number.isFinite(Number(this.workDelayMs)) && Number(this.workDelayMs) >= 0)
    ? Number(this.workDelayMs)
    : 0;

  console.debug(`[WORKER:INNER] Worker #${this.workerIndex} Starting work...`, payload.index);
  return new Promise((resolve) => {
    if (workSha256Iters > 0) {
      let buf = crypto.randomBytes(32);
      for (let i = 0; i < workSha256Iters; i++) {
        buf = crypto.createHash('sha256').update(buf).update(Buffer.from(String(i % 65536))).digest();
      }
      this.lastWorkDigest = buf.toString('hex', 0, 8);
    }
    const newState = { ...payload.state, workerIndex: this.workerIndex, incrementor: this.queueProcessed };
    const entityID = `${newState.workerIndex}:${newState.incrementor}:${payload.index}`;
    setTimeout(() => {
      console.log('[WORKER:INNER] Work complete:', payload);
      resolve({
        depth: payload.state.depth,
        parent: payload.state.parent,
        output: payload.index,
        entity: entityID,
        state: { ...newState, id: entityID }
      });
    }, workDelayMs);
  });
};

// Settings
const configuration = {
  function: work,
  maxQueue: DEFAULT_MAX_QUEUE,
  wallet: {
    keys: [
      { name: 'primary', seed: FABRIC_MNEMONIC }
    ]
  }
};

// Functions
// TODO: move these to `functions/`
function cloneState (value) {
  try {
    return JSON.parse(JSON.stringify(value || {}));
  } catch {
    return {};
  }
}

function compileWorkerFunction (source) {
  if (!source) return null;
  try {
    // Example-only trusted code path to preserve settings.function behavior.
    return new Function(`return (${source});`)();
  } catch {
    return null;
  }
}

function createJobID (payload = {}, paymentSats = 0) {
  const envelope = {
    type: 'DistributorWork',
    created: Date.now(),
    paymentSats: Number(paymentSats) || 0,
    entropy: crypto.randomBytes(16).toString('hex'),
    payload
  };

  return new Entity(envelope).id;
}

function computeWorkerStateID (state = {}) {
  return new Entity({
    workerIndex: state.workerIndex,
    processed: state.processed,
    depth: state.depth,
    errors: state.errors,
    lastJobID: state.lastJobID,
    queueProcessed: state.queueProcessed,
    lastPayload: state.lastPayload,
    parentStateID: state.parentStateID
  }).id;
}

async function mineBlocksToAddress (bitcoin, address, count = 1) {
  if (!bitcoin || !address) throw new Error('Bitcoin instance and address are required for mining.');
  const blocks = await bitcoin._makeRPCRequest('generatetoaddress', [count, address]);
  return blocks;
}

async function listSpendableUTXOs (bitcoin) {
  let utxos;
  try {
    utxos = await bitcoin._makeWalletRequest('listunspent', [1], bitcoin.walletName);
  } catch (error) {
    const msg = String((error && error.message) || error);
    if (msg.includes('not found') || msg.includes('does not exist')) {
      try {
        utxos = await bitcoin._makeRPCRequest('listunspent', [1]);
      } catch (e2) {
        const m2 = String((e2 && e2.message) || e2);
        if (m2.includes('Multiple wallets')) {
          console.warn('[DEVELOP] listunspent needs a wallet context; using Fabric wallet only.');
          return [];
        }
        throw e2;
      }
    } else {
      throw error;
    }
  }
  if (!Array.isArray(utxos)) return [];
  return utxos.filter((utxo) => {
    return utxo && utxo.spendable !== false && Number(utxo.amount || 0) > 0;
  });
}

function msatToBTC (value) {
  if (typeof value === 'number') return value / 100000000000;
  if (typeof value === 'string') {
    const numeric = value.endsWith('msat') ? value.slice(0, -4) : value;
    const parsed = Number(numeric);
    if (Number.isFinite(parsed)) return parsed / 100000000000;
  }
  return 0;
}

function msatToSats (value) {
  if (typeof value === 'number') return Math.floor(value / 1000);
  if (typeof value === 'string') {
    const numeric = value.endsWith('msat') ? value.slice(0, -4) : value;
    const parsed = Number(numeric);
    if (Number.isFinite(parsed)) return Math.floor(parsed / 1000);
  }
  return 0;
}

function requiredBidFromQueueError (error) {
  const message = String((error && error.message) || error || '');
  const match = message.match(/Pay\s+(\d+)\s+satoshi/i);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

function listLightningOutputs (funds) {
  if (!funds || !Array.isArray(funds.outputs)) return [];
  return funds.outputs.filter((output) => output && output.status !== 'spent');
}

function outputValueBTC (output) {
  if (typeof output.amount_msat !== 'undefined') return msatToBTC(output.amount_msat);
  if (typeof output.amount !== 'undefined') return Number(output.amount || 0);
  if (typeof output.value !== 'undefined') return Number(output.value || 0);
  return 0;
}

function outputValueSats (output) {
  if (typeof output.amount_msat !== 'undefined') return msatToSats(output.amount_msat);
  if (typeof output.amount !== 'undefined') return Math.floor(Number(output.amount || 0) * 100000000);
  if (typeof output.value !== 'undefined') return Number(output.value || 0);
  return 0;
}

async function sumLightningOutputs (lightning, projector) {
  const funds = await lightning.listFunds();
  return listLightningOutputs(funds).reduce((sum, output) => sum + projector(output), 0);
}

async function getLightningDepositedBTC (lightning) {
  return sumLightningOutputs(lightning, outputValueBTC);
}

async function getLightningSpendableSats (lightning) {
  return sumLightningOutputs(lightning, outputValueSats);
}

async function connectLightningIfNeeded (lightning, remote) {
  try {
    await lightning.connectTo(remote);
  } catch (error) {
    const message = (error && error.message) ? error.message : '';
    if (!message.includes('already connected')) throw error;
  }
}

async function ensureAliceLightningFunds (bitcoin, aliceLightning, miningAddress) {
  let aliceDeposited = 0;
  try {
    aliceDeposited = await getLightningDepositedBTC(aliceLightning);
  } catch (error) {
    console.warn('[DEVELOP] Could not check Alice Lightning deposited funds:', error.message);
  }

  if (aliceDeposited > 0) {
    console.log(`[DEVELOP] Alice Lightning already has deposited funds (${aliceDeposited.toFixed(8)} BTC); skipping bootstrap funding.`);
    return;
  }

  const aliceDepositAddress = await aliceLightning.newDepositAddress();
  const balances = await bitcoin.getBalances();
  const spendable = Number((balances && balances.trusted) ? balances.trusted : 0);
  const rawDeposit = Number((spendable * LIGHTNING_FUNDING_RATIO).toFixed(8));
  const depositAmount = Math.min(rawDeposit, MAX_ALICE_DEPOSIT_BTC);

  if (depositAmount <= 0) {
    console.warn('[DEVELOP] No spendable Bitcoin balance for Alice Lightning funding.');
    return;
  }

  const fundingTxID = await bitcoin.processSpendMessage({
    amount: depositAmount,
    destination: aliceDepositAddress,
    comment: `Funding Alice Lightning at ${LIGHTNING_FUNDING_RATIO * 100}%`,
    recipient: 'Alice Lightning Node'
  });
  console.log(`[DEVELOP] Funded Alice Lightning address ${aliceDepositAddress} with ${depositAmount} BTC (txid: ${fundingTxID}).`);
  console.log(`[DEVELOP] Confirming Alice Lightning deposit with ${LIGHTNING_DEPOSIT_CONFIRM_BLOCKS} block(s)...`);
  await mineBlocksToAddress(bitcoin, miningAddress, LIGHTNING_DEPOSIT_CONFIRM_BLOCKS);
  console.log('[DEVELOP] Alice Lightning deposit confirmation blocks mined.');
}

async function ensureAliceChannel (lightning, aliceLightning) {
  const [localInfo, aliceInfo] = await Promise.all([
    lightning._makeRPCRequest('getinfo'),
    aliceLightning._makeRPCRequest('getinfo')
  ]);

  const remote = `${aliceInfo.id}@127.0.0.1:${aliceLightning.settings.port}`;
  const masterRemote = `${localInfo.id}@127.0.0.1:${lightning.settings.port || 9735}`;

  await connectLightningIfNeeded(lightning, remote);
  await connectLightningIfNeeded(aliceLightning, masterRemote);

  const [masterSpendable, aliceSpendable] = await Promise.all([
    getLightningSpendableSats(lightning),
    getLightningSpendableSats(aliceLightning)
  ]);

  const masterChannelSats = Math.floor(masterSpendable * LIGHTNING_FUNDING_RATIO);
  const aliceChannelSats = Math.floor(aliceSpendable * LIGHTNING_FUNDING_RATIO);

  let masterFunded = 0;
  let aliceFunded = 0;

  if (masterChannelSats >= MIN_CHANNEL_FUNDING_SATS) {
    const pushMsat = Math.floor((masterChannelSats * 1000) * LIGHTNING_FUNDING_RATIO);
    try {
      await lightning.createChannel(aliceInfo.id, String(masterChannelSats), pushMsat);
      masterFunded = masterChannelSats;
      console.log(`[PAYMENTS] Master opened channel to Alice: ${masterChannelSats} sats (pushed ${pushMsat} msat to Alice).`);
    } catch (error) {
      const message = (error && error.message) ? error.message : '';
      if (!message.includes('already')) throw error;
      console.log('[PAYMENTS] Master→Alice channel already exists.');
    }
  } else {
    console.warn(`[PAYMENTS] Skipping Master→Alice channel; master spendable=${masterSpendable} sats below threshold.`);
  }

  if (aliceChannelSats >= MIN_CHANNEL_FUNDING_SATS) {
    const pushMsat = Math.floor((aliceChannelSats * 1000) * LIGHTNING_FUNDING_RATIO);
    try {
      await aliceLightning.createChannel(localInfo.id, String(aliceChannelSats), pushMsat);
      aliceFunded = aliceChannelSats;
      console.log(`[PAYMENTS] Alice opened channel to Master: ${aliceChannelSats} sats (pushed ${pushMsat} msat to Master).`);
    } catch (error) {
      const message = (error && error.message) ? error.message : '';
      if (!message.includes('already')) throw error;
      console.log('[PAYMENTS] Alice→Master channel already exists.');
    }
  } else {
    console.warn(`[PAYMENTS] Skipping Alice→Master channel; alice spendable=${aliceSpendable} sats below threshold.`);
  }

  return { localInfo, aliceInfo, channelSats: masterFunded + aliceFunded, masterFunded, aliceFunded };
}

async function logChannelSnapshot (lightning, aliceLightning) {
  try {
    const [masterFunds, aliceFunds] = await Promise.all([
      lightning.listFunds(),
      aliceLightning.listFunds()
    ]);

    const masterChannels = (masterFunds && masterFunds.channels) ? masterFunds.channels : [];
    const aliceChannels = (aliceFunds && aliceFunds.channels) ? aliceFunds.channels : [];

    console.log(`[PAYMENTS] Channel snapshot: master_channels=${masterChannels.length} alice_channels=${aliceChannels.length}`);

    if (masterChannels.length) {
      const channel = masterChannels[0];
      console.log(`[PAYMENTS] Master first channel peer=${channel.peer_id || '-'} amount=${channel.amount_msat || channel.amount || '-'}`);
    }

    if (aliceChannels.length) {
      const channel = aliceChannels[0];
      console.log(`[PAYMENTS] Alice first channel peer=${channel.peer_id || '-'} amount=${channel.amount_msat || channel.amount || '-'}`);
    }
  } catch (error) {
    console.warn('[PAYMENTS] Could not fetch channel snapshot:', error.message);
  }
}

async function getLightningStatusSnapshot (lightning, aliceLightning) {
  const safeFunds = async (instance) => {
    try {
      const funds = await instance.listFunds();
      return funds || {};
    } catch {
      return {};
    }
  };

  const [masterFunds, aliceFunds] = await Promise.all([
    safeFunds(lightning),
    safeFunds(aliceLightning)
  ]);

  return {
    masterFunds,
    aliceFunds,
    masterChannels: Array.isArray(masterFunds.channels) ? masterFunds.channels : [],
    aliceChannels: Array.isArray(aliceFunds.channels) ? aliceFunds.channels : [],
    updatedAt: new Date().toISOString()
  };
}

function printAgentsHelp () {
  console.log(`
Fabric agents example — multi-core work distributor (+ optional regtest Bitcoin / Lightning)

Usage:
  node examples/agents.js [options]

Options:
  --help, -h           Show this message
  --smoke              Drain the queue once and exit (distributor smoke test)
  --distributor-only   Distributor + periodic work until SIGINT (no Bitcoin / Lightning)
  --bitcoin-only       Managed regtest bitcoind + distributor until SIGINT (no Lightning)
  --work-ms=<n>        Per-job worker delay in ms (same as FABRIC_AGENTS_WORK_MS)
  --status-json        Emit JSON status snapshots (same as FABRIC_AGENTS_STATUS_JSON=1)

Environment:
  FABRIC_AGENTS_SKIP_CHAIN=1   CI-style smoke (exit after drain); ignored if --distributor-only / --bitcoin-only
  FABRIC_AGENTS_WORK_MS        Worker simulated job duration
  FABRIC_AGENTS_PRODUCER_TARGET  Accepted jobs target before stopping (default 1000)
  FABRIC_AGENTS_MAX_QUEUE        Queue capacity before unpaid jobs must rebid (default 64)
  FABRIC_AGENTS_PRODUCER_INTERVAL_MS Producer tick interval in ms (default 100)
  FABRIC_AGENTS_PRODUCER_BATCH_SIZE  Jobs attempted each producer tick (default max(4, cores))
  FABRIC_AGENTS_FAST_BID_EVERY   Submit a fast-lane paid bid every N jobs (default 25)
  FABRIC_AGENTS_FAST_BID_AMOUNT  Sats for periodic fast-lane bids (default 3)
  FABRIC_AGENTS_STATUS_JSON=1  Emit JSON status snapshots
  FABRIC_AGENTS_BOOT_IDLE_MS   Max ms to wait for initial queue drain (default 120000)
  FABRIC_AGENTS_WORK_SHA256_ITERS  Optional SHA-256 iterations per job (load test; cap 2M)
  FABRIC_MNEMONIC              Optional BIP-39 mnemonic for keys
  FABRIC_CLEAN_ALICE=1         Delete Alice Lightning datadir before start (full stack only)

npm run example:agents:smoke
npm run example:agents:distributor
npm run example:agents:bitcoin
`);
}

/**
 * @param {{ master: Distributor, lightning?: object, aliceLightning?: object }} opts
 * @returns {{ producerTimer: NodeJS.Timeout, statusTimer: NodeJS.Timeout }}
 */
function scheduleAgentProducers ({ master, lightning, aliceLightning }) {
  let producerSequence = 0;
  let completed = false;
  let producing = false;
  const metrics = {
    target: PRODUCER_TARGET,
    submitted: 0,
    accepted: 0,
    queueFull: 0,
    rebidSuccess: 0,
    rebidFailure: 0,
    maxBid: 0
  };
  let resolveDone;
  const done = new Promise((resolve) => {
    resolveDone = resolve;
  });

  const trySubmitWork = (jobIndex) => {
    const occasionalFastLane = PRODUCER_FAST_BID_EVERY > 0 && (jobIndex % PRODUCER_FAST_BID_EVERY === 0);
    const initialBid = occasionalFastLane ? PRODUCER_FAST_BID_AMOUNT : 0;
    metrics.submitted++;

    try {
      master.requestWork({ index: `work-${jobIndex}` }, initialBid);
      metrics.accepted++;
      if (initialBid > metrics.maxBid) metrics.maxBid = initialBid;
      return true;
    } catch (error) {
      const requiredBid = requiredBidFromQueueError(error);
      if (requiredBid == null) {
        return false;
      }

      metrics.queueFull++;
      const escalatedBid = Math.max(requiredBid, initialBid + 1);
      try {
        master.requestWork({ index: `work-${jobIndex}` }, escalatedBid);
        metrics.accepted++;
        metrics.rebidSuccess++;
        if (escalatedBid > metrics.maxBid) metrics.maxBid = escalatedBid;
        return true;
      } catch {
        metrics.rebidFailure++;
        return false;
      }
    }
  };

  const producerTimer = setInterval(() => {
    if (completed || producing) return;
    producing = true;
    try {
      for (let i = 0; i < PRODUCER_BATCH_SIZE; i++) {
        if (metrics.accepted >= metrics.target) break;
        const submitted = trySubmitWork(producerSequence++);
        if (!submitted) break;
      }
    } finally {
      producing = false;
    }

    if (metrics.accepted >= metrics.target) {
      completed = true;
      clearInterval(producerTimer);
    }
  }, PRODUCER_INTERVAL_MS);

  const statusTimer = setInterval(() => {
    Promise.resolve().then(async () => {
      let snapshot = {
        masterFunds: {},
        aliceFunds: {},
        masterChannels: [],
        aliceChannels: [],
        updatedAt: null
      };
      if (lightning && aliceLightning) {
        snapshot = await getLightningStatusSnapshot(lightning, aliceLightning);
      }
      master.setExternalStatus(snapshot);

      const status = master.status();
      const aliceChannels = Array.isArray(snapshot.aliceChannels) ? snapshot.aliceChannels : [];
      const masterChannels = Array.isArray(snapshot.masterChannels) ? snapshot.masterChannels : [];
      const aliceFunds = snapshot.aliceFunds || {};
      const masterFunds = snapshot.masterFunds || {};
      const workerSummary = status.workers.map((worker) => {
        const state = worker.state || {};
        return `w${worker.index}:done=${worker.processed},err=${worker.errors},earned=${worker.earnedSats || 0}sats,paid=${worker.paidJobs || 0},${worker.busy ? 'busy' : 'idle'},state.jobs=${state.queueProcessed || 0},state.depth=${state.depth || 0},state.last=${state.lastPayload || '-'}`;
      }).join(' | ');

      if (AGENTS_STATUS_JSON) {
        console.log(JSON.stringify({
          type: 'agents_status',
          timestamp: new Date().toISOString(),
          queueDepth: status.queueDepth,
          completed: status.completed,
          failed: status.failed,
          paymentCreditSats: status.paymentCreditSats,
          paidJobsCompleted: status.paidJobsCompleted,
          paidJobsFailed: status.paidJobsFailed,
          totalPaidSatsEarned: status.totalPaidSatsEarned,
          processed: status.processed,
          workersBusy: status.workersBusy,
          workersTotal: status.workersTotal,
          stateDepth: status.stateDepth,
          stateTip: status.stateTip,
          historyRoot: status.historyRoot,
          lightning: {
            masterChannels: masterChannels.length,
            aliceChannels: aliceChannels.length,
            masterFunds: masterFunds.total_msat || masterFunds.total || null,
            aliceFunds: aliceFunds.total_msat || aliceFunds.total || null
          }
        }));
      }

      console.log(
        `[MASTER] [STATUS] queue=${status.queueDepth} completed=${status.completed} failed=${status.failed} processed=${status.processed} paid_done=${status.paidJobsCompleted} paid_fail=${status.paidJobsFailed} earned=${status.totalPaidSatsEarned}sats credit=${status.paymentCreditSats}sats busy=${status.workersBusy}/${status.workersTotal} ${workerSummary}`
      );

      if (lightning && aliceLightning) {
        console.log(
          `[ALICE] [STATUS:LIGHTNING] channels=${aliceChannels.length} funds=${aliceFunds.total_msat || aliceFunds.total || '-'}`
        );
        console.log(
          `[MASTER] [STATUS:LIGHTNING] channels=${masterChannels.length} funds=${masterFunds.total_msat || masterFunds.total || '-'}`
        );
      }

      console.log(
        `[MASTER] [MERKLE] depth=${status.stateDepth} root=${status.historyRoot || '-'} tip=${status.stateTip || '-'} parent=${status.stateParent || '-'}`
      );

      console.log(
        `[MASTER] [BIDDING] accepted=${metrics.accepted}/${metrics.target} submitted=${metrics.submitted} queue_full=${metrics.queueFull} rebid_ok=${metrics.rebidSuccess} rebid_fail=${metrics.rebidFailure} max_bid=${metrics.maxBid}`
      );

      if (completed && status.queueDepth === 0 && status.workersBusy === 0) {
        clearInterval(statusTimer);
        resolveDone(Object.assign({}, metrics));
      }
    }).catch((error) => {
      console.warn('[STATUS]', 'Status tick failed:', error.message);
    });
  }, 5000);

  return { producerTimer, statusTimer, done };
}

/**
 * Long-running distributor + workers only (no Bitcoin / Lightning).
 * @param {object} [input]
 */
async function runDistributorOnlyDemo (input = {}) {
  const skipKey = Object.assign({ network: BITCOIN_NETWORK },
    FABRIC_MNEMONIC ? { mnemonic: FABRIC_MNEMONIC } : { mnemonic: FIXTURE_SEED });
  console.log('[DEVELOP] --distributor-only — Fabric distributor + workers (Ctrl+C to stop).');

  let producerTimer = null;
  let statusTimer = null;
  const master = new Distributor(Object.assign({}, input, { key: skipKey }));

  const shutdown = async (signal) => {
    console.log(`[DEVELOP] Received ${signal}, shutting down...`);
    if (producerTimer) clearInterval(producerTimer);
    if (statusTimer) clearInterval(statusTimer);
    try {
      await master.stop();
    } catch (error) {
      console.error('[DEVELOP] Distributor shutdown error:', error && error.message ? error.message : error);
    }
    process.exit(0);
  };
  process.once('SIGINT', () => { void shutdown('SIGINT'); });
  process.once('SIGTERM', () => { void shutdown('SIGTERM'); });

  await master.start();
  for (let i = 0; i < numberOfCores; i++) {
    master.requestWork({ index: i }, 0);
  }
  master.requestWork({ index: 'priority' }, 1);
  const queuedJobs = numberOfCores + 1;
  const waves = Math.ceil(queuedJobs / Math.max(1, numberOfCores));
  const delayMs = Math.max(AGENT_WORK_DELAY_MS, 1);
  const idleDeadline = agentsBootstrapDrainDeadlineMs(waves, delayMs);
  const drained = await master.waitForIdle(idleDeadline);
  if (!drained) {
    throw new Error(`Bootstrap queue did not drain within ${idleDeadline}ms`);
  }
  console.log('[DEVELOP] Initial queue drained; starting producer loop.');

  const timers = scheduleAgentProducers({ master, lightning: null, aliceLightning: null });
  producerTimer = timers.producerTimer;
  statusTimer = timers.statusTimer;
  const summary = await timers.done;

  console.log(`[DEVELOP] Distributor-only producer complete: accepted=${summary.accepted}/${summary.target} rebid_ok=${summary.rebidSuccess} max_bid=${summary.maxBid}`);
  await master.stop();
  return summary;
}

/**
 * Managed regtest Bitcoin + distributor until SIGINT (no Lightning).
 * @param {object} [input]
 */
async function runBitcoinOnlyDemo (input = {}) {
  const staticKey = Object.assign({ network: BITCOIN_NETWORK }, FABRIC_MNEMONIC ? { mnemonic: FABRIC_MNEMONIC } : {});

  let producerTimer = null;
  let statusTimer = null;
  let blockTimer = null;
  let bitcoin = null;
  const master = new Distributor(Object.assign({}, input, { key: staticKey || input.key || null }));

  const shutdown = async (signal) => {
    console.log(`[DEVELOP] Received ${signal}, shutting down...`);
    if (producerTimer) clearInterval(producerTimer);
    if (statusTimer) clearInterval(statusTimer);
    if (blockTimer) clearInterval(blockTimer);
    try {
      await master.stop();
    } catch (error) {
      console.error('[DEVELOP] Distributor shutdown error:', error && error.message ? error.message : error);
    }
    if (bitcoin) {
      try {
        await bitcoin.stop();
      } catch (error) {
        console.error('[DEVELOP] Bitcoin shutdown error:', error && error.message ? error.message : error);
      }
      try {
        if (bitcoin._nodeProcess && bitcoin._nodeProcess.exitCode === null) {
          bitcoin._nodeProcess.kill('SIGKILL');
        }
      } catch {
        /* ignore */
      }
    }
    process.exit(0);
  };
  process.once('SIGINT', () => { void shutdown('SIGINT'); });
  process.once('SIGTERM', () => { void shutdown('SIGTERM'); });

  bitcoin = new Bitcoin({
    network: BITCOIN_NETWORK,
    mode: 'rpc',
    managed: true,
    rpcport: 18443,
    zmq: null,
    key: staticKey
  });
  bitcoin.on('error', (error) => {
    console.error('[DEVELOP]', 'Bitcoin emitted error:', error);
  });
  bitcoin.on('warning', (warning) => {
    console.warn('[DEVELOP]', 'Bitcoin emitted warning:', warning);
  });

  console.log('[DEVELOP] --bitcoin-only — starting managed regtest bitcoind...');
  try {
    await bitcoin.start();
  } catch (error) {
    console.error('[DEVELOP] Bitcoin service failed to start:', error.message);
    console.error('[DEVELOP] Hint: free port 18443, or use --distributor-only / FABRIC_AGENTS_SKIP_CHAIN=1');
    throw error;
  }

  const miningAddress = await bitcoin.getUnusedAddress();
  let spendableUTXOs = [];
  try {
    spendableUTXOs = await listSpendableUTXOs(bitcoin);
  } catch (error) {
    console.warn('[DEVELOP] Could not list spendable UTXOs yet:', error.message);
  }

  if (!spendableUTXOs.length) {
    console.log(`[DEVELOP] Mining initial ${INITIAL_SPENDABLE_BLOCKS} regtest blocks to ${miningAddress}...`);
    await mineBlocksToAddress(bitcoin, miningAddress, INITIAL_SPENDABLE_BLOCKS);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  } else {
    console.log('[DEVELOP] Spendable UTXOs present; skipping bootstrap mining.');
  }

  blockTimer = setInterval(async () => {
    try {
      const hashes = await mineBlocksToAddress(bitcoin, miningAddress, 1);
      const hash = (hashes && hashes[0]) ? hashes[0] : null;
      console.log(`[DEVELOP] Mined regtest block: ${hash}`);
    } catch (error) {
      console.error('[DEVELOP] Failed to mine periodic block:', error.message);
    }
  }, BLOCK_INTERVAL_MS);

  await master.start();
  for (let i = 0; i < numberOfCores; i++) {
    master.requestWork({ index: i }, 0);
  }
  master.requestWork({ index: 'priority' }, 1);
  const bootDrained = await master.waitForIdle(FABRIC_AGENTS_BOOT_IDLE_MS);
  if (!bootDrained) {
    console.warn(`[DEVELOP] Initial queue still busy after ${FABRIC_AGENTS_BOOT_IDLE_MS}ms; continuing with producer.`);
  }

  const timers = scheduleAgentProducers({ master, lightning: null, aliceLightning: null });
  producerTimer = timers.producerTimer;
  statusTimer = timers.statusTimer;
  const summary = await timers.done;

  console.log(`[DEVELOP] Bitcoin+distributor producer complete: accepted=${summary.accepted}/${summary.target} rebid_ok=${summary.rebidSuccess} max_bid=${summary.maxBid}`);
  await master.stop();
  if (blockTimer) {
    clearInterval(blockTimer);
    blockTimer = null;
  }
  if (bitcoin) {
    await bitcoin.stop();
  }
  return summary;
}

async function payRequestedAmount (lightning, aliceLightning, request = {}) {
  const sats = Math.max(1, Number(request.amount) || 1);
  const amountMsat = sats * 1000;
  const label = `priority-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  const description = request.description || 'Priority work payment';

  const invoice = await aliceLightning.createInvoice(amountMsat, label, description);
  const payment = await lightning._makeRPCRequest('pay', [invoice.bolt11]);
  return { sats, invoice, payment };
}

async function ensureWalletHasXpub (bitcoin, xpub, _label = 'master-xpub') {
  if (!bitcoin || !xpub) throw new Error('Bitcoin instance and xpub are required.');

  const normalizedXpub = normalizeXpubForNetwork(xpub, bitcoin.settings.network);
  await bitcoin._loadWallet(bitcoin.walletName);

  let targetWallet = bitcoin.walletName;
  let walletInfo = null;
  try {
    walletInfo = await bitcoin._makeWalletRequest('getwalletinfo', [], bitcoin.walletName);
  } catch {
    // Continue with default wallet target.
  }

  // Descriptor imports of xpub watch-only keys are rejected on private-key wallets.
  if (walletInfo && walletInfo.private_keys_enabled) {
    targetWallet = `${bitcoin.walletName}-watch`;
    try {
      await bitcoin._makeRPCRequest('loadwallet', [targetWallet]);
    } catch (error) {
      const message = (error && error.message) ? error.message : '';
      if (!message.includes('already loaded') && !message.includes('not found')) {
        // Ignore and try create flow below.
      }

      try {
        await bitcoin._makeRPCRequest('createwallet', [
          targetWallet,
          true,  // disable_private_keys
          false, // blank
          null,  // passphrase
          true,  // avoid_reuse
          true   // descriptors
        ]);
      } catch (createError) {
        const createMessage = (createError && createError.message) ? createError.message : '';
        if (!createMessage.includes('Database already exists') && !createMessage.includes('already exists')) {
          throw createError;
        }
      }
    }
  }

  const receiveDescriptor = `wpkh(${normalizedXpub}/0/*)`;
  const changeDescriptor = `wpkh(${normalizedXpub}/1/*)`;
  const receiveInfo = await bitcoin._makeRPCRequest('getdescriptorinfo', [receiveDescriptor]);
  const changeInfo = await bitcoin._makeRPCRequest('getdescriptorinfo', [changeDescriptor]);

  // TODO: document all descriptors
  const descriptors = [
    {
      desc: receiveInfo.descriptor,
      active: true,
      internal: false,
      timestamp: 'now',
      range: [0, 1000]
    },
    {
      desc: changeInfo.descriptor,
      active: true,
      internal: true,
      timestamp: 'now',
      range: [0, 1000]
    }
  ];

  const result = await bitcoin._makeWalletRequest('importdescriptors', [descriptors], targetWallet);
  const ok = Array.isArray(result) && result.every((entry) => entry && entry.success);
  if (!ok) {
    throw new Error(`Could not import master xpub descriptors: ${JSON.stringify(result)}`);
  }

  return `importdescriptors:${targetWallet}`;
}

function normalizeXpubForNetwork (xpub, network = 'mainnet') {
  if (!xpub) return xpub;
  const decoded = decodeCheck(xpub);
  const bytes = Buffer.from(decoded);
  if (bytes.length < 4) return xpub;

  // BIP32 version bytes for public extended keys.
  const MAINNET_XPUB = Buffer.from([0x04, 0x88, 0xB2, 0x1E]);
  const TESTNET_XPUB = Buffer.from([0x04, 0x35, 0x87, 0xCF]);
  const current = bytes.subarray(0, 4);

  const target = (network === 'regtest' || network === 'testnet' || network === 'signet')
    ? TESTNET_XPUB
    : MAINNET_XPUB;

  if (current.equals(target)) return xpub;

  const remapped = Buffer.concat([target, bytes.subarray(4)]);
  return encodeCheck(remapped);
}

function runWorkerLoop () {
  const run = compileWorkerFunction(workerData && workerData.functionSource);
  const boundState = Object.assign({
    workerIndex: workerData && workerData.workerIndex,
    processed: 0,
    depth: 0,
    errors: 0,
    lastJobID: null,
    parentStateID: null,
    stateID: null,
    workSha256Iters: Number(workerData && workerData.workSha256Iters) || 0,
    workDelayMs: Number(workerData && workerData.workDelayMs) || 0
  }, cloneState(workerData && workerData.initialState));

  boundState.stateID = computeWorkerStateID(boundState);

  if (!parentPort) return;

  // TODO: migrate this to `functions/onParentMessage.js`
  parentPort.on('message', async (message) => {
    if (!message) return;
    if (message.type === 'shutdown') {
      process.exit(0);
      return;
    }
    if (message.type !== 'start') return;

    try {
      boundState.lastJobID = message.id || null;
      boundState.parentStateID = boundState.stateID || message.parentStateID || boundState.parentStateID || null;
      boundState.parent = boundState.parentStateID;
      boundState.depth = (boundState.depth || 0) + 1;
      if (typeof run === 'function') {
        const result = await run.call(boundState, Object.assign({}, message.payload, {
          state: boundState
        }));

        if (result && typeof result === 'object' && result.state && typeof result.state === 'object') {
          Object.assign(boundState, result.state);
        }
      }

      boundState.processed++;
      boundState.stateID = computeWorkerStateID(boundState);

      parentPort.postMessage({
        type: 'done',
        id: message.id,
        pid: process.pid,
        state: cloneState(boundState)
      });
    } catch (error) {
      boundState.errors++;
      parentPort.postMessage({
        type: 'error',
        id: message.id,
        error: error.message,
        state: cloneState(boundState)
      });
    }
  });
}

/**
 * A Distributor is a service that distributes work to multiple agents.
 */
class Distributor extends Service {
  /**
   * @constructor
   * @param {Object} settings Settings for the Distributor.
   * @param {Function} settings.function Function to distribute work to the agents.
   */
  constructor (settings = {}) {
    super(settings);

    // Arbitrary state
    this._state = {
      clock: 0,
      epochs: {},
      history: [],
      services: {},
      // Internal state
      content: {
        function: (settings.function) ? settings.function.bind({}) : (() => {}).bind({}),
        queue: [],
        maxQueue: settings.maxQueue || DEFAULT_MAX_QUEUE,
        completed: 0,
        failed: 0,
        paymentCreditSats: 0,
        paidJobsCompleted: 0,
        paidJobsFailed: 0,
        totalPaidSatsEarned: 0,
        nextWorkerIndex: 0,
        stateTip: null,
        externalStatus: {
          masterFunds: {},
          aliceFunds: {},
          masterChannels: [],
          aliceChannels: [],
          updatedAt: null
        }
      },
      cores: [],
      status: 'PAUSED',
      version: 0
    };

    this._snapshotGlobalState('init');
  }

  get address () {
    return this.identity.address;
  }

  tick () {
    this._dispatchWork();
    this._snapshotGlobalState('tick');
  }

  /**
   * Internal snapshot function.
   * @param {String} reason The reason for the snapshot.
   * @returns {String} The snapshot ID.
   */
  _snapshotGlobalState (reason = 'update') {
    const parent = this._state.id || null;
    const snapshotBody = {
      type: 'DistributorState',
      reason,
      created: new Date().toISOString(),
      parent,
      state: cloneState(this.state)
    };

    const snapshot = new State(snapshotBody);
    const id = snapshot.id;

    this._state.id = id;
    this._state.epochs[id] = snapshotBody;
    this._state.history.push(id);

    return id;
  }

  async start () {
    if (this._state.status === 'STARTED' || this._state.status === 'STARTING' || this._state.cores.length) {
      this.emit('debug', 'Distributor already started; ignoring duplicate start() call.');
      return this;
    }
    this.emit('debug', 'Starting Distributor...');
    this._state.status = 'STARTING';

    try {
      for (let i = 0; i < numberOfCores; i++) {
        const core = new Worker(__filename, {
          workerData: {
            workerIndex: i,
            initialState: {
              queueProcessed: 0,
              lastPayload: null,
              workSha256Iters: WORK_SHA256_ITERS,
              workDelayMs: AGENT_WORK_DELAY_MS
            },
            workSha256Iters: WORK_SHA256_ITERS,
            workDelayMs: AGENT_WORK_DELAY_MS,
            functionSource: (this.settings.function && this.settings.function.toString)
              ? this.settings.function.toString()
              : null
          }
        });

        core.__index = i;
        core.__busy = false;
        core.__processed = 0;
        core.__errors = 0;
        core.__lastJobID = null;
        core.__activePaymentSats = 0;
        core.__earnedSats = 0;
        core.__paidJobs = 0;
        core.__state = {};
        this._state.cores.push(core);

        core.on('message', (message) => {
          this.emit('debug', 'Core message:', message);

          if (message && message.type === 'done') {
            core.__processed++;
            core.__lastJobID = message.id || null;
            core.__state = message.state || core.__state;
            this._state.content.completed++;
            if (core.__activePaymentSats > 0) {
              core.__earnedSats += core.__activePaymentSats;
              core.__paidJobs++;
              this._state.content.paidJobsCompleted++;
              this._state.content.totalPaidSatsEarned += core.__activePaymentSats;
            }
            this._snapshotGlobalState('worker-done');
            core.__activePaymentSats = 0;
            core.__busy = false;
            this._dispatchWork();
          }

          if (message && message.type === 'error') {
            core.__errors++;
            core.__lastJobID = message.id || null;
            core.__state = message.state || core.__state;
            this._state.content.failed++;
            if (core.__activePaymentSats > 0) {
              this._state.content.paidJobsFailed++;
            }
            this._snapshotGlobalState('worker-error');
            const errDetail = (message && message.error != null)
              ? message.error
              : (message && message.message) || 'worker error';
            this.emit('workerJobFailed', {
              workerIndex: core.__index,
              jobId: core.__lastJobID,
              detail: errDetail,
              state: core.__state
            });
            console.warn('[DEVELOP] Worker job failed:', errDetail);
            core.__activePaymentSats = 0;
            core.__busy = false;
            this._dispatchWork();
          }
        });

        core.on('error', (error) => {
          this.emit('error', 'Core error:', error);
        });

        core.on('exit', (code, signal) => {
          this.emit('debug', 'Core exited:', code, signal);
          const idx = this._state.cores.indexOf(core);
          if (idx !== -1) this._state.cores.splice(idx, 1);
          if (core.__busy) {
            this._state.content.failed = (this._state.content.failed || 0) + 1;
            const detail = `code=${code} signal=${signal} lastJobID=${core.__lastJobID}`;
            this.emit('error', `Core exited while busy (job may be lost): ${detail}`);
          }
          try {
            core.terminate();
          } catch {
            /* ignore */
          }
          const orphaned = this._state.content.queue.length;
          if (orphaned > 0 && this._state.cores.length === 0) {
            this.emit('error', `All worker threads exited with ${orphaned} job(s) still queued (work will not run until restart).`);
            if (this._state.status === 'STARTED') this._state.status = 'PAUSED';
          }
          this._dispatchWork();
        });
      }
    } catch (error) {
      const cores = this._state.cores.splice(0, this._state.cores.length);
      await Promise.all(cores.map((c) => c.terminate().catch(() => {})));
      this._state.status = 'PAUSED';
      throw error;
    }

    this.emit('debug', `Distributor started.  Fund this address: ${this.address}`);
    this._state.status = 'STARTED';
    this._snapshotGlobalState('start');

    return this;
  }

  async stop () {
    if (this._state.status === 'STOPPING' || this._state.status === 'STOPPED') {
      this.emit('debug', 'Distributor already stopping/stopped; ignoring duplicate stop() call.');
      return this;
    }
    this.emit('debug', 'Stopping Distributor...');
    this._state.status = 'STOPPING';

    for (const core of this._state.cores) {
      if (!core) continue;

      if (core.threadId) {
        try {
          core.postMessage({ type: 'shutdown' });
        } catch (error) {
          this.emit('error', 'Failed to send shutdown signal to core:', error.message);
        }

        try {
          await core.terminate();
        } catch (error) {
          this.emit('error', 'Failed to terminate core:', error.message);
        }
      }
    }

    this._state.cores = [];
    this._state.content.queue = [];
    this._state.status = 'STOPPED';
    this._snapshotGlobalState('stop');

    this.emit('debug', 'Distributor stopped');
  }

  /**
   * Request work from the distributor.
   * @param {Object} payload The payload to send to the worker.
   * @param {number} paymentSats The payment amount in satoshis.
   * @returns {string} The job ID.
   */
  requestWork (payload = {}, paymentSats = 0) {
    const queue = this._state.content.queue;
    const maxQueue = this._state.content.maxQueue;
    const paidPriority = Number(paymentSats) >= 1;

    if (queue.length >= maxQueue && !paidPriority) {
      const topCost = queue[0].paymentSats;
      const cost = topCost + 1;
      const availableCredit = Number(this._state.content.paymentCreditSats || 0);

      if (availableCredit >= cost) {
        this._state.content.paymentCreditSats = availableCredit - cost;
        paymentSats = cost;
      } else {
        this.emit('payments:request', {
          amount: cost,
          description: 'Priority work payment',
          recipient: 'Priority work payment',
          payload
        });

        throw new Error(`Queue full (${maxQueue}).  Pay ${cost} satoshi for priority.`);
      }
    }

    const job = {
      id: createJobID(payload, paymentSats),
      payload,
      paymentSats: Number(paymentSats) || 0
    };

    if (paidPriority) {
      // Paid work skips the line when queue capacity is exhausted.
      queue.unshift(job);
    } else {
      queue.push(job);
    }

    this._snapshotGlobalState('enqueue');

    // Dispatch work to the workers.
    this._dispatchWork();

    // Return the job ID.
    return job.id;
  }

  _dispatchWork () {
    const queue = this._state.content.queue;
    const cores = this._state.cores;
    const coreCount = cores.length;
    if (!queue.length || !coreCount) return;

    let scanned = 0;
    while (queue.length && scanned < coreCount) {
      const index = this._state.content.nextWorkerIndex % coreCount;
      const core = cores[index];

      this._state.content.nextWorkerIndex = (index + 1) % coreCount;
      scanned++;

      if (!core || core.__busy) continue;

      // Take job from queue and dispatch to worker.
      const job = queue.shift();
      core.__busy = true;
      core.__activePaymentSats = Number(job.paymentSats) || 0;
      try {
        core.postMessage({
          type: 'start',
          id: job.id,
          payload: job.payload,
          parentStateID: this._state.id
        });
      } catch (error) {
        queue.unshift(job);
        core.__activePaymentSats = 0;
        core.__busy = false;
        this.emit('error', 'Failed to dispatch job:', error.message);
      }
    }
  }

  async waitForIdle (timeoutMs = 15000) {
    const start = Date.now();

    while (true) {
      const q = this._state.content.queue.length;
      if (this._state.cores.length === 0 && q > 0) return false;
      const queueEmpty = q === 0;
      const workersBusy = this._state.cores.some((core) => core && core.__busy);

      if (queueEmpty && !workersBusy) return true;
      if (Date.now() - start > timeoutMs) return false;

      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  setExternalStatus (snapshot = {}) {
    this._state.content.externalStatus = Object.assign({
      masterFunds: {},
      aliceFunds: {},
      masterChannels: [],
      aliceChannels: [],
      updatedAt: null
    }, snapshot);
    return this;
  }

  creditPayment (amountSats = 0, metadata = {}) {
    const amount = Math.max(0, Math.floor(Number(amountSats) || 0));
    if (amount <= 0) return this._state.content.paymentCreditSats;
    this._state.content.paymentCreditSats += amount;
    this.emit('payments:credited', {
      amount,
      availableCredit: this._state.content.paymentCreditSats,
      metadata
    });
    this._snapshotGlobalState('payment-credited');
    return this._state.content.paymentCreditSats;
  }

  status () {
    const workers = this._state.cores.map((core) => ({
      index: core.__index,
      busy: !!core.__busy,
      processed: core.__processed || 0,
      errors: core.__errors || 0,
      lastJobID: core.__lastJobID || null,
      earnedSats: core.__earnedSats || 0,
      paidJobs: core.__paidJobs || 0,
      state: core.__state || {}
    }));

    const historyRoot = this._computeHistoryRoot();
    const externalStatus = this._state.content.externalStatus || {};

    return {
      status: this._state.status,
      queueDepth: this._state.content.queue.length,
      completed: this._state.content.completed,
      failed: this._state.content.failed || 0,
      paymentCreditSats: this._state.content.paymentCreditSats || 0,
      paidJobsCompleted: this._state.content.paidJobsCompleted || 0,
      paidJobsFailed: this._state.content.paidJobsFailed || 0,
      totalPaidSatsEarned: this._state.content.totalPaidSatsEarned || 0,
      processed: (this._state.content.completed || 0) + (this._state.content.failed || 0),
      stateTip: this._state.id,
      stateParent: this._state.history.length > 1 ? this._state.history[this._state.history.length - 2] : null,
      stateDepth: this._state.history.length,
      historyRoot,
      workersBusy: workers.filter((x) => x.busy).length,
      workersTotal: workers.length,
      workers,
      masterFunds: externalStatus.masterFunds || {},
      aliceFunds: externalStatus.aliceFunds || {},
      masterChannels: Array.isArray(externalStatus.masterChannels) ? externalStatus.masterChannels : [],
      aliceChannels: Array.isArray(externalStatus.aliceChannels) ? externalStatus.aliceChannels : [],
      externalStatusUpdatedAt: externalStatus.updatedAt || null
    };
  }

  _computeHistoryRoot () {
    if (!this._state.history.length) return null;
    const tree = new Tree({ leaves: this._state.history });
    const root = tree.root;
    if (!root) return null;
    return Buffer.isBuffer(root) ? root.toString('hex') : String(root);
  }
}

async function main (input = {}) {
  if (!isMainThread) {
    runWorkerLoop(input);
    return;
  }

  if (AGENTS_CLI.help) {
    printAgentsHelp();
    return 'no-complete-log';
  }

  if (AGENTS_CLI.distributorOnly) {
    await runDistributorOnlyDemo(input);
    return;
  }

  if (AGENTS_CLI.bitcoinOnly) {
    await runBitcoinOnlyDemo(input);
    return;
  }

  const skipChainEnv = process.env.FABRIC_AGENTS_SKIP_CHAIN === '1';
  const smokeExit = (AGENTS_CLI.smoke || skipChainEnv) && !AGENTS_CLI.distributorOnly && !AGENTS_CLI.bitcoinOnly;

  let shuttingDown = false;
  let producerTimer = null;
  let statusTimer = null;
  let blockTimer = null;
  let master = null;
  let lightning = null;
  let aliceLightning = null;
  let bitcoin = null;

  const staticKey = Object.assign({
    network: BITCOIN_NETWORK
  }, FABRIC_MNEMONIC ? { mnemonic: FABRIC_MNEMONIC } : {});
  const aliceKey = Object.assign({}, staticKey, {
    passphrase: 'alice'
  });

  if (smokeExit) {
    const skipKey = Object.assign({ network: BITCOIN_NETWORK },
      FABRIC_MNEMONIC ? { mnemonic: FABRIC_MNEMONIC } : { mnemonic: FIXTURE_SEED });
    console.log('[DEVELOP] Smoke mode — distributor + workers only (no Bitcoin / Lightning). Use --smoke or FABRIC_AGENTS_SKIP_CHAIN=1.');
    const skipMaster = new Distributor(Object.assign({}, input, { key: skipKey }));
    try {
      await skipMaster.start();
      for (let i = 0; i < numberOfCores; i++) {
        skipMaster.requestWork({ index: i }, 0);
      }
      skipMaster.requestWork({ index: 'priority' }, 1);
      const queuedJobs = numberOfCores + 1;
      const waves = Math.ceil(queuedJobs / Math.max(1, numberOfCores));
      const delayMs = Math.max(AGENT_WORK_DELAY_MS, 1);
      const idleDeadline = agentsBootstrapDrainDeadlineMs(waves, delayMs);
      const drained = await skipMaster.waitForIdle(idleDeadline);
      if (!drained) {
        throw new Error(`Skip-chain smoke: queue did not drain within ${idleDeadline}ms`);
      }
      const status = skipMaster.status();
      console.log(`[DEVELOP] Skip-chain smoke earnings: paid_done=${status.paidJobsCompleted} earned=${status.totalPaidSatsEarned}sats credit=${status.paymentCreditSats}sats`);
      console.log('[DEVELOP] Skip-chain smoke: initial queue drained OK.');
      console.log('[DEVELOP] Skip-chain smoke: complete.');
      return;
    } finally {
      try {
        await skipMaster.stop();
      } catch (err) {
        console.error('[DEVELOP] Skip-chain cleanup failed:', err && err.message ? err.message : err);
      }
    }
  }

  const withTimeout = async (promise, label, timeoutMs = 6000) => {
    return Promise.race([
      promise,
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      })
    ]);
  };

  const shutdown = async (signal = 'SIGTERM') => {
    if (shuttingDown) return;
    shuttingDown = true;

    console.log(`[DEVELOP] Received ${signal}, shutting down...`);

    const forceExitTimer = setTimeout(() => {
      console.error('[DEVELOP] Forced exit: shutdown exceeded timeout.');
      process.exit(1);
    }, 12000);
    forceExitTimer.unref();

    if (producerTimer) clearInterval(producerTimer);
    if (statusTimer) clearInterval(statusTimer);
    if (blockTimer) clearInterval(blockTimer);

    if (master) {
      try {
        await withTimeout(master.stop(), 'Distributor shutdown');
      } catch (error) {
        console.error('[DEVELOP] Distributor shutdown error:', error.message);
      }
    }
    if (lightning) {
      try {
        await withTimeout(lightning.stop(), 'Lightning shutdown');
      } catch (error) {
        console.error('[DEVELOP] Lightning shutdown error:', error.message);
      }
    }
    if (aliceLightning) {
      try {
        await withTimeout(aliceLightning.stop(), 'Alice Lightning shutdown');
      } catch (error) {
        console.error('[DEVELOP] Alice Lightning shutdown error:', error.message);
      }
    }

    if (bitcoin) {
      try {
        await withTimeout(bitcoin.stop(), 'Bitcoin shutdown');
      } catch (error) {
        console.error('[DEVELOP] Bitcoin shutdown error:', error.message);
      }
    }

    // Last-resort cleanup to avoid orphaned managed daemons.
    try {
      if (lightning && lightning._child && lightning._child.exitCode === null) {
        lightning._child.kill('SIGKILL');
      }
    } catch (error) {
      console.error('[DEVELOP] Lightning force-kill error:', error.message);
    }

    try {
      if (aliceLightning && aliceLightning._child && aliceLightning._child.exitCode === null) {
        aliceLightning._child.kill('SIGKILL');
      }
    } catch (error) {
      console.error('[DEVELOP] Alice Lightning force-kill error:', error.message);
    }

    try {
      if (bitcoin && bitcoin._nodeProcess && bitcoin._nodeProcess.exitCode === null) {
        bitcoin._nodeProcess.kill('SIGKILL');
      }
    } catch (error) {
      console.error('[DEVELOP] Bitcoin force-kill error:', error.message);
    }

    clearTimeout(forceExitTimer);
    process.exit(0);
  };

  process.once('SIGINT', () => {
    shutdown('SIGINT').catch((error) => {
      console.error('[DEVELOP] SIGINT shutdown failed:', error);
      process.exit(1);
    });
  });

  process.once('SIGTERM', () => {
    shutdown('SIGTERM').catch((error) => {
      console.error('[DEVELOP] SIGTERM shutdown failed:', error);
      process.exit(1);
    });
  });

  const cleanupBootstrapFailure = async () => {
    if (blockTimer) {
      clearInterval(blockTimer);
      blockTimer = null;
    }
    if (master) {
      try {
        await master.stop();
      } catch (e) {
        console.error('[DEVELOP] Bootstrap cleanup: distributor stop failed:', e && e.message ? e.message : e);
      }
      master = null;
    }
    if (aliceLightning) {
      try {
        await aliceLightning.stop();
      } catch (e) {
        console.error('[DEVELOP] Bootstrap cleanup: Alice Lightning stop failed:', e && e.message ? e.message : e);
      }
      try {
        if (aliceLightning._child && aliceLightning._child.exitCode === null) {
          aliceLightning._child.kill('SIGKILL');
        }
      } catch { /* ignore */ }
      aliceLightning = null;
    }
    if (lightning) {
      try {
        await lightning.stop();
      } catch (e) {
        console.error('[DEVELOP] Bootstrap cleanup: Lightning stop failed:', e && e.message ? e.message : e);
      }
      try {
        if (lightning._child && lightning._child.exitCode === null) {
          lightning._child.kill('SIGKILL');
        }
      } catch { /* ignore */ }
      lightning = null;
    }
    if (bitcoin) {
      try {
        await bitcoin.stop();
      } catch (e) {
        console.error('[DEVELOP] Bootstrap cleanup: Bitcoin stop failed:', e && e.message ? e.message : e);
      }
      try {
        if (bitcoin._nodeProcess && bitcoin._nodeProcess.exitCode === null) {
          bitcoin._nodeProcess.kill('SIGKILL');
        }
      } catch { /* ignore */ }
      bitcoin = null;
    }
  };

  try {
  bitcoin = new Bitcoin({
    network: BITCOIN_NETWORK,
    mode: 'rpc',
    managed: true,
    rpcport: 18443,
    zmq: null,
    key: staticKey
  });

  bitcoin.on('message', (message) => {
    console.debug('[DEVELOP]', 'Bitcoin emitted message:', message);
  });

  bitcoin.on('block', (block) => {
    console.debug('[DEVELOP]', 'Bitcoin emitted block:', block);
  });

  bitcoin.on('tx', (tx) => {
    console.debug('[DEVELOP]', 'Bitcoin emitted tx:', tx);
  });

  bitcoin.on('error', (error) => {
    console.error('[DEVELOP]', 'Bitcoin emitted error:', error);
  });

  bitcoin.on('warning', (warning) => {
    console.warn('[DEVELOP]', 'Bitcoin emitted warning:', warning);
  });

  bitcoin.on('debug', (debug) => {
    console.debug('[DEVELOP]', 'Bitcoin emitted debug:', debug);
  });

  bitcoin.on('log', (log) => {
    console.debug('[DEVELOP]', 'Bitcoin emitted log:', log);
  });

  try {
    await bitcoin.start();
  } catch (error) {
    console.error('[DEVELOP] Bitcoin service failed to start:', error.message);
    console.error('[DEVELOP] Hint: use a working regtest bitcoind on port 18443, or distributor-only smoke: FABRIC_AGENTS_SKIP_CHAIN=1 node examples/agents.js');
    throw error;
  }

  const miningAddress = await bitcoin.getUnusedAddress();
  let spendableUTXOs = [];
  try {
    spendableUTXOs = await listSpendableUTXOs(bitcoin);
  } catch (error) {
    console.warn('[DEVELOP] Could not list spendable UTXOs yet:', error.message);
  }

  const spendableFunds = spendableUTXOs.reduce((sum, utxo) => sum + Number(utxo.amount || 0), 0);

  if (spendableUTXOs.length) {
    console.log(`[DEVELOP] Found ${spendableFunds.toFixed(8)} BTC in ${spendableUTXOs.length} spendable UTXO(s); skipping bootstrap mining.`);
  } else {
    console.log(`[DEVELOP] No spendable UTXOs found. Mining initial ${INITIAL_SPENDABLE_BLOCKS} regtest blocks to ${miningAddress}...`);
    await mineBlocksToAddress(bitcoin, miningAddress, INITIAL_SPENDABLE_BLOCKS);
    console.log('[DEVELOP] Initial spendable UTXO window prepared.');
    console.log('[DEVELOP] Waiting for Bitcoin RPC queue to settle...');
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  lightning = new Lightning({
    network: BITCOIN_NETWORK,
    managed: true,
    datadir: `./stores/lightning-${BITCOIN_NETWORK}`,
    key: staticKey,
    bitcoin: {
      host: '127.0.0.1',
      rpcport: bitcoin.settings.rpcport,
      rpcuser: bitcoin.settings.username,
      rpcpassword: bitcoin.settings.password,
      datadir: bitcoin.settings.datadir
    }
  });
  await lightning.start();

  await new Promise((resolve) => setTimeout(resolve, 3000));

  const aliceDatadir = path.resolve(`./stores/lightning-alice-${BITCOIN_NETWORK}`);
  if (process.env.FABRIC_CLEAN_ALICE === '1' && fs.existsSync(aliceDatadir)) {
    fs.rmSync(aliceDatadir, { recursive: true });
    console.log('[DEVELOP] Cleaned Alice Lightning datadir (FABRIC_CLEAN_ALICE=1)');
  }

  aliceLightning = new Lightning({
    network: BITCOIN_NETWORK,
    managed: true,
    datadir: aliceDatadir,
    port: ALICE_LIGHTNING_PORT,
    key: aliceKey,
    disablePlugins: ['cln-grpc'],
    bitcoin: {
      host: '127.0.0.1',
      rpcport: bitcoin.settings.rpcport,
      rpcuser: bitcoin.settings.username,
      rpcpassword: bitcoin.settings.password,
      datadir: bitcoin.settings.datadir
    }
  });
  await aliceLightning.start();
  try {
    const aliceInfo = await aliceLightning._makeRPCRequest('getinfo');
    console.log(`[PAYMENTS] Alice Lightning pubkey: ${aliceInfo.id}`);
  } catch (error) {
    console.warn('[PAYMENTS] Could not read Alice Lightning pubkey:', error.message);
  }

  let lightningDeposited = 0;
  try {
    lightningDeposited = await getLightningDepositedBTC(lightning);
    console.log(`[DEVELOP] Lightning deposited funds: ${lightningDeposited.toFixed(8)} BTC`);
  } catch (error) {
    console.warn('[DEVELOP] Could not check Lightning deposited funds:', error.message);
  }

  if (lightningDeposited > 0) {
    console.log('[DEVELOP] Lightning already has deposited funds; skipping additional bootstrap funding.');
  } else {
    const lightningDepositAddress = await lightning.newDepositAddress();
    const balances = await bitcoin.getBalances();
    const spendable = Number((balances && balances.trusted) ? balances.trusted : 0);
    const depositAmount = Number((spendable * LIGHTNING_FUNDING_RATIO).toFixed(8));

    if (depositAmount > 0) {
      const fundingTxID = await bitcoin.processSpendMessage({
        amount: depositAmount,
        destination: lightningDepositAddress,
        comment: `Funding Lightning at ${LIGHTNING_FUNDING_RATIO * 100}%`,
        recipient: 'Lightning Node'
      });

      console.log(`[DEVELOP] Funded Lightning address ${lightningDepositAddress} with ${depositAmount} BTC (txid: ${fundingTxID}).`);
      console.log(`[DEVELOP] Confirming Lightning deposit with ${LIGHTNING_DEPOSIT_CONFIRM_BLOCKS} block(s)...`);
      await mineBlocksToAddress(bitcoin, miningAddress, LIGHTNING_DEPOSIT_CONFIRM_BLOCKS);
      console.log('[DEVELOP] Lightning deposit confirmation blocks mined.');
    } else {
      console.warn('[DEVELOP] No spendable Bitcoin balance detected for Lightning funding.');
    }
  }

  await ensureAliceLightningFunds(bitcoin, aliceLightning, miningAddress);
  await ensureAliceChannel(lightning, aliceLightning);
  await logChannelSnapshot(lightning, aliceLightning);

  blockTimer = setInterval(async () => {
    try {
      const hashes = await mineBlocksToAddress(bitcoin, miningAddress, 1);
      const hash = (hashes && hashes[0]) ? hashes[0] : null;
      console.log(`[DEVELOP] Mined regtest block: ${hash}`);
    } catch (error) {
      console.error('[DEVELOP] Failed to mine periodic block:', error.message);
    }
  }, BLOCK_INTERVAL_MS);

  lightning.on('message', (message) => {
    console.log('[DEVELOP]', 'Lightning emitted message:', message);
  });

  lightning.on('debug', (debug) => {
    console.debug('[DEVELOP]', 'Lightning emitted debug:', debug);
  });

  master = new Distributor(Object.assign({}, input, {
    key: staticKey || input.key || null
  }));

  let paymentInFlight = false;
  const deferredPaymentRequests = [];

  // TODO: migrate to `functions/`
  master.on('payments:request', async (request) => {
    if (paymentInFlight) {
      deferredPaymentRequests.push(request);
      console.warn('[PAYMENTS] Payment already in-flight, queueing duplicate request.');
      return;
    }

    paymentInFlight = true;
    try {
      const result = await payRequestedAmount(lightning, aliceLightning, request);
      master.creditPayment(result.sats, {
        invoiceHash: result.invoice && (result.invoice.paymentHash || result.invoice.payment_hash || null),
        request
      });
      if (request && request.payload) {
        try {
          const paidJobID = master.requestWork(request.payload, 0);
          console.log(`[PAYMENTS] Re-queued paid priority work as job ${paidJobID}.`);
        } catch (queueError) {
          console.warn('[PAYMENTS] Could not re-queue paid priority work:', queueError.message);
        }
      }
      console.log(`[PAYMENTS] Paid ${result.sats} sats via Lightning (invoice=${result.invoice.paymentHash || '-'}).`);
    } catch (error) {
      console.error('[PAYMENTS] Failed to complete payment request:', error.message);
    } finally {
      paymentInFlight = false;
      const next = deferredPaymentRequests.shift();
      if (next) {
        setImmediate(() => master.emit('payments:request', next));
      }
    }
  });

  const masterXpub = (master.key && master.key.xpub) ? master.key.xpub : null;
  if (masterXpub) {
    console.log(`[DEVELOP] Master XPUB: ${masterXpub}`);
    try {
      const method = await ensureWalletHasXpub(bitcoin, masterXpub);
      console.log(`[DEVELOP] Master XPUB imported to wallet "${bitcoin.walletName}" via ${method}.`);
    } catch (error) {
      console.warn('[DEVELOP] Could not import master XPUB into wallet:', error.message);
    }
  } else {
    console.warn('[DEVELOP] Master XPUB unavailable; skipping wallet import.');
  }

  // Start the master distributor.
  await master.start();

  // Demonstrate standard and paid-priority queueing behavior.
  for (let i = 0; i < numberOfCores; i++) {
    master.requestWork({ index: i }, 0);
  }
  master.requestWork({ index: 'priority' }, 1);
  const bootDrained = await master.waitForIdle(FABRIC_AGENTS_BOOT_IDLE_MS);
  if (!bootDrained) {
    console.warn(`[DEVELOP] Initial queue still busy after ${FABRIC_AGENTS_BOOT_IDLE_MS}ms; continuing with producer.`);
  }

  const timers = scheduleAgentProducers({ master, lightning, aliceLightning });
  producerTimer = timers.producerTimer;
  statusTimer = timers.statusTimer;
  const summary = await timers.done;
  console.log(`[DEVELOP] Full-stack producer complete: accepted=${summary.accepted}/${summary.target} rebid_ok=${summary.rebidSuccess} max_bid=${summary.maxBid}`);
  await cleanupBootstrapFailure();
  return summary;
  } catch (bootstrapError) {
    console.error('[DEVELOP] Full-stack bootstrap failed:', bootstrapError && bootstrapError.message ? bootstrapError.message : bootstrapError);
    await cleanupBootstrapFailure();
    throw bootstrapError;
  }
}

if (isMainThread) {
  main(configuration).catch((error) => {
    console.error(error);
    process.exit(1);
  }).then((exitNote) => {
    if (exitNote === 'no-complete-log') return;
    console.log('[DEVELOP]', 'Main thread complete');
  });
} else {
  runWorkerLoop();
}

module.exports = main;
