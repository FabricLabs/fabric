'use strict';

// Dependencies
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const process = require('process');
const bs58check = require('bs58check');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
// TODO: ensure utilization of multiple cores

// Fabric Types
const Service = require('../types/service');
const Entity = require('../types/entity');
const State = require('../types/state');
const Tree = require('../types/tree');
const Wallet = require('../types/wallet');

// Services
const Bitcoin = require('../services/bitcoin');
const Lightning = require('../services/lightning');

// Configuration
const numberOfCores = 2 || os.cpus().length;
const DEFAULT_MAX_QUEUE = 100;
const BITCOIN_NETWORK = 'regtest';
const PRODUCER_INTERVAL_MS = 200;
const PRODUCER_BATCH_SIZE = Math.max(2, Math.ceil(numberOfCores / 2));
const INITIAL_SPENDABLE_BLOCKS = 101;
const BLOCK_INTERVAL_MS = 10000;
const LIGHTNING_FUNDING_RATIO = 0.5;
const LIGHTNING_DEPOSIT_CONFIRM_BLOCKS = 6;
const FABRIC_MNEMONIC = process.env.FABRIC_MNEMONIC || null;
const ALICE_LIGHTNING_PORT = 19735;
const MIN_CHANNEL_FUNDING_SATS = 10000;
const MAX_ALICE_DEPOSIT_BTC = 1;

// Work Function
const work = function (payload = {}) {
  this.queueProcessed = (this.queueProcessed || 0) + 1;
  this.lastPayload = payload.index;

  console.debug(`[WORKER:INNER] Worker #${this.workerIndex} Starting work...`, payload.index);
  // console.log('[WORKER:INNER] Starting work...', payload);
  return new Promise((resolve) => {
    // TODO: do something productive here!
    // console.debug(`[WORKER:INNER] [${payload.index}] Doing something productive...`, payload.state.parentStateID);
    // console.debug('[WORKER:INNER] Doing something productive...', payload, payload.state.parentStateID);
    const newState = { ...payload.state, workerIndex: this.workerIndex, incrementor: this.queueProcessed };
    // TODO: replace this with Actor ID
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
    }, 1200);
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
  } catch (error) {
    return {};
  }
}

function compileWorkerFunction (source) {
  if (!source) return null;
  try {
    // Example-only trusted code path to preserve settings.function behavior.
    return new Function(`return (${source});`)();
  } catch (error) {
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
  const utxos = await bitcoin._makeRPCRequest('listunspent', [1]);
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

async function getLightningDepositedBTC (lightning) {
  const funds = await lightning.listFunds();
  if (!funds || !Array.isArray(funds.outputs)) return 0;

  return funds.outputs.reduce((sum, output) => {
    if (!output) return sum;
    if (output.status && output.status === 'spent') return sum;

    if (typeof output.amount_msat !== 'undefined') {
      return sum + msatToBTC(output.amount_msat);
    }

    if (typeof output.amount !== 'undefined') {
      return sum + Number(output.amount || 0);
    }

    if (typeof output.value !== 'undefined') {
      return sum + Number(output.value || 0);
    }

    return sum;
  }, 0);
}

async function getLightningSpendableSats (lightning) {
  const funds = await lightning.listFunds();
  if (!funds || !Array.isArray(funds.outputs)) return 0;

  return funds.outputs.reduce((sum, output) => {
    if (!output || output.status === 'spent') return sum;
    if (typeof output.amount_msat !== 'undefined') return sum + msatToSats(output.amount_msat);
    if (typeof output.amount !== 'undefined') return sum + Math.floor(Number(output.amount || 0) * 100000000);
    if (typeof output.value !== 'undefined') return sum + Number(output.value || 0);
    return sum;
  }, 0);
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

  try {
    await lightning.connectTo(remote);
  } catch (error) {
    const message = (error && error.message) ? error.message : '';
    if (!message.includes('already connected')) throw error;
  }

  try {
    await aliceLightning.connectTo(masterRemote);
  } catch (error) {
    const message = (error && error.message) ? error.message : '';
    if (!message.includes('already connected')) throw error;
  }

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

async function payRequestedAmount (lightning, aliceLightning, request = {}) {
  const sats = Math.max(1, Number(request.amount) || 1);
  const amountMsat = sats * 1000;
  const label = `priority-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  const description = request.description || 'Priority work payment';

  const invoice = await aliceLightning.createInvoice(amountMsat, label, description);
  const payment = await lightning._makeRPCRequest('pay', [invoice.bolt11]);
  return { sats, invoice, payment };
}

async function ensureWalletHasXpub (bitcoin, xpub, label = 'master-xpub') {
  if (!bitcoin || !xpub) throw new Error('Bitcoin instance and xpub are required.');

  const normalizedXpub = normalizeXpubForNetwork(xpub, bitcoin.settings.network);
  await bitcoin._loadWallet(bitcoin.walletName);

  let targetWallet = bitcoin.walletName;
  let walletInfo = null;
  try {
    walletInfo = await bitcoin._makeWalletRequest('getwalletinfo', [], bitcoin.walletName);
  } catch (error) {
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
  const decoded = bs58check.decode(xpub);
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
  return bs58check.encode(remapped);
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
    stateID: null
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
        nextWorkerIndex: 0,
        stateTip: null
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
    this.emit('debug', 'Starting Distributor...');

    for (let i = 0; i < numberOfCores; i++) {
      const core = new Worker(__filename, {
        workerData: {
          workerIndex: i,
          initialState: {
            queueProcessed: 0,
            lastPayload: null
          },
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
      core.__state = {};
      this._state.cores.push(core);

      core.on('message', (message) => {
        this.emit('debug', 'Core message:', message);

        if (message && message.type === 'done') {
          core.__processed++;
          core.__lastJobID = message.id || null;
          core.__state = message.state || core.__state;
          this._state.content.completed++;
          this._snapshotGlobalState('worker-done');
          core.__busy = false;
          this._dispatchWork();
        }

        if (message && message.type === 'error') {
          core.__errors++;
          core.__lastJobID = message.id || null;
          core.__state = message.state || core.__state;
          this._state.content.failed++;
          this._snapshotGlobalState('worker-error');
          core.__busy = false;
          this._dispatchWork();
        }
      });

      core.on('error', (error) => {
        this.emit('error', 'Core error:', error);
      });

      core.on('exit', (code, signal) => {
        this.emit('debug', 'Core exited:', code, signal);
        core.__busy = true;
      });
    }

    this.emit('debug', `Distributor started.  Fund this address: ${this.address}`);
    this._state.status = 'STARTED';
    this._snapshotGlobalState('start');

    return this;
  }

  async stop () {
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

      this.emit('payments:request', {
        amount: cost,
        description: 'Priority work payment',
        recipient: 'Priority work payment'
      });

      throw new Error(`Queue full (${maxQueue}).  Pay ${cost} satoshi for priority.`);
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
      try {
        core.postMessage({
          type: 'start',
          id: job.id,
          payload: job.payload,
          parentStateID: this._state.id
        });
      } catch (error) {
        core.__busy = false;
        this.emit('error', 'Failed to dispatch job:', error.message);
      }
    }
  }

  async waitForIdle (timeoutMs = 15000) {
    const start = Date.now();

    while (true) {
      const queueEmpty = this._state.content.queue.length === 0;
      const workersBusy = this._state.cores.some((core) => core && core.__busy);

      if (queueEmpty && !workersBusy) return true;
      if (Date.now() - start > timeoutMs) return false;

      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  status () {
    const workers = this._state.cores.map((core) => ({
      index: core.__index,
      busy: !!core.__busy,
      processed: core.__processed || 0,
      errors: core.__errors || 0,
      lastJobID: core.__lastJobID || null,
      state: core.__state || {}
    }));

    const historyRoot = this._computeHistoryRoot();

    return {
      status: this._state.status,
      queueDepth: this._state.content.queue.length,
      completed: this._state.content.completed,
      failed: this._state.content.failed || 0,
      processed: (this._state.content.completed || 0) + (this._state.content.failed || 0),
      stateTip: this._state.id,
      stateParent: this._state.history.length > 1 ? this._state.history[this._state.history.length - 2] : null,
      stateDepth: this._state.history.length,
      historyRoot,
      workersBusy: workers.filter((x) => x.busy).length,
      workersTotal: workers.length,
      workers
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

  await bitcoin.start();

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

  // TODO: migrate to `functions/`
  master.on('payments:request', async (request) => {
    if (paymentInFlight) {
      console.warn('[PAYMENTS] Payment already in-flight, skipping duplicate request.');
      return;
    }

    paymentInFlight = true;
    try {
      const result = await payRequestedAmount(lightning, aliceLightning, request);
      console.log(`[PAYMENTS] Paid ${result.sats} sats via Lightning (invoice=${result.invoice.paymentHash || '-'}).`);
    } catch (error) {
      console.error('[PAYMENTS] Failed to complete payment request:', error.message);
    } finally {
      paymentInFlight = false;
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
  await master.waitForIdle();

  let producerSequence = 0;
  producerTimer = setInterval(() => {
    for (let i = 0; i < PRODUCER_BATCH_SIZE; i++) {
      try {
        master.requestWork({ index: `work-${producerSequence++}` }, 0);
      } catch (error) {
        console.warn('[STATUS]', 'Queue submit skipped:', error.message);
        break;
      }
    }
  }, PRODUCER_INTERVAL_MS);

  statusTimer = setInterval(() => {
    const status = master.status();
    const workerSummary = status.workers.map((worker) => {
      const state = worker.state || {};
      return `w${worker.index}:done=${worker.processed},err=${worker.errors},${worker.busy ? 'busy' : 'idle'},state.jobs=${state.queueProcessed || 0},state.depth=${state.depth || 0},state.last=${state.lastPayload || '-'}`;
    }).join(' | ');

    console.log(
      `[MASTER] [STATUS] queue=${status.queueDepth} completed=${status.completed} failed=${status.failed} processed=${status.processed} busy=${status.workersBusy}/${status.workersTotal} ${workerSummary}`
    );

    console.log(
      `[ALICE] [STATUS:LIGHTNING] channels=${status.aliceChannels.length} funds=${status.aliceFunds.total_msat || status.aliceFunds.total || '-'}`
    );

    console.log(
      `[MASTER] [STATUS:LIGHTNING] channels=${status.masterChannels.length} funds=${status.masterFunds.total_msat || status.masterFunds.total || '-'}`
    );

    console.log(
      `[MASTER] [MERKLE] depth=${status.stateDepth} root=${status.historyRoot || '-'} tip=${status.stateTip || '-'} parent=${status.stateParent || '-'}`
    );
  }, 5000);
}

if (isMainThread) {
  main(configuration).catch((error) => {
    console.error(error);
    process.exit(1);
  }).then(() => {
    console.log('[DEVELOP]', 'Main thread complete');
  });
} else {
  runWorkerLoop();
}

module.exports = main;
