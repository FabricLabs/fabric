'use strict';

/**
 * Managed regtest Bitcoin + Beacon + sidechain Filesystem for simulator scenarios.
 * Gated by FABRIC_E2E_REGTEST=1 (requires bitcoind on PATH).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const Bitcoin = require('../../../services/bitcoin');
const Beacon = require('../../../types/beacon');
const Key = require('../../../types/key');
const sidechainState = require('../../../functions/sidechainState');
const documentRegistry = require('../../../functions/documentRegistrySidechain');

function e2eRegtestEnabled () {
  const v = process.env.FABRIC_E2E_REGTEST;
  return v === '1' || v === 'true';
}

function memoryFs () {
  const store = Object.create(null);
  return {
    readFile (p) {
      return store[p] != null ? store[p] : null;
    },
    writeFile (p, value) {
      store[p] = typeof value === 'string' ? value : JSON.stringify(value);
      return true;
    },
    async publish (p, value) {
      store[p] = typeof value === 'string' ? value : JSON.stringify(value);
      return true;
    },
    _store: store
  };
}

/**
 * @param {object} [opts]
 * @returns {Promise<{
 *   bitcoin: import('../../../services/bitcoin'),
 *   beacon: import('../../../types/beacon'),
 *   key: import('../../../types/key'),
 *   fs: object,
 *   state: object,
 *   datadir: string,
 *   stop: () => Promise<void>,
 *   applyRegistryItems: (items: object[]) => Promise<object>,
 *   sealEpoch: () => Promise<object>
 * }>}
 */
async function startRegtestBeaconHarness (opts = {}) {
  if (!e2eRegtestEnabled()) {
    const err = new Error('FABRIC_E2E_REGTEST not set');
    err.code = 'SKIP_REGTEST';
    throw err;
  }

  const rpcport = opts.rpcport != null ? Number(opts.rpcport) : (18450 + Math.floor(Math.random() * 40));
  const p2pport = opts.port != null ? Number(opts.port) : (rpcport + 1);
  const datadir = opts.datadir || path.join(
    os.tmpdir(),
    `fabric-sim-beacon-${process.pid}-${Date.now()}`
  );
  fs.mkdirSync(datadir, { recursive: true });

  const key = new Key({
    network: 'regtest',
    purpose: 44,
    account: 0,
    index: 0
  });

  const bitcoin = new Bitcoin({
    network: 'regtest',
    mode: 'rpc',
    managed: true,
    rpcport,
    port: p2pport,
    zmq: null,
    debug: false,
    username: 'bitcoinrpc',
    password: 'password',
    datadir,
    key: { xpub: key.xpub, xprv: key.xprv }
  });

  const storeFs = memoryFs();
  let state = sidechainState.createInitialState();
  await sidechainState.persistState(storeFs, state);

  const beacon = new Beacon({
    name: 'SIM:BEACON',
    regtest: true,
    mineOnStart: false,
    interval: 0,
    debug: false
  });

  beacon.attach({
    bitcoin,
    fs: storeFs,
    key,
    getSidechainSnapshotForEpoch () {
      const st = sidechainState.loadState(storeFs);
      return {
        clock: Number(st.clock) || 0,
        stateDigest: sidechainState.stateDigest(st)
      };
    }
  });

  await bitcoin.start();

  // Mine coinbase maturity so getUnusedAddress / balance paths stay happy.
  try {
    const addr = await bitcoin.getUnusedAddress();
    await bitcoin._makeRPCRequest('generatetoaddress', [101, addr]);
  } catch (err) {
    await bitcoin.stop().catch(() => {});
    throw err;
  }

  async function applyRegistryItems (items) {
    state = sidechainState.loadState(storeFs);
    const applied = documentRegistry.applyInventoryToRegistry(state, items);
    if (!applied.ok) throw new Error(applied.error || 'registry apply failed');
    state = applied.state;
    await sidechainState.persistState(storeFs, state);
    return applied;
  }

  async function sealEpoch () {
    const payload = await beacon.createEpoch();
    if (payload && !payload.pending) {
      sidechainState.saveSnapshotForBeaconClockSync(storeFs, payload.clock, sidechainState.loadState(storeFs));
    }
    return payload;
  }

  async function stop () {
    try {
      await beacon.stop();
    } catch (_) { /* ignore */ }
    try {
      await bitcoin.stop();
    } catch (_) { /* ignore */ }
    try {
      fs.rmSync(datadir, { recursive: true, force: true });
    } catch (_) { /* ignore */ }
  }

  return {
    bitcoin,
    beacon,
    key,
    fs: storeFs,
    get state () { return sidechainState.loadState(storeFs); },
    datadir,
    stop,
    applyRegistryItems,
    sealEpoch
  };
}

module.exports = {
  e2eRegtestEnabled,
  memoryFs,
  startRegtestBeaconHarness
};
