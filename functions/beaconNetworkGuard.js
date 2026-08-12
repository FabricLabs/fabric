'use strict';

/**
 * Bind Beacon / Hub L1-tied stores to a Bitcoin network name.
 *
 * Prevents silently sealing regtest tip hashes (or spending addresses) after
 * FABRIC_BITCOIN_NETWORK flips to signet/mainnet without clearing stores.
 *
 * @module functions/beaconNetworkGuard
 */

const BEACON_NETWORK_PATH = 'beacon/NETWORK';
const BEACON_CHAIN_PATH = 'beacon/CHAIN';
const PENDING_EPOCH_ROUNDS_PATH = 'beacon/PENDING_EPOCH_ROUNDS';
const SIDECHAIN_STATE_PATH = 'sidechain/STATE';
const SIDECHAIN_SNAPSHOTS_PATH = 'sidechain/SNAPSHOTS';
const SIDECHAIN_JOURNAL_PATH = 'sidechain/JOURNAL';

const KNOWN_NETWORKS = Object.freeze([
  'regtest',
  'signet',
  'testnet',
  'mainnet'
]);

/**
 * Normalize Bitcoin network labels used by Hub / Core.
 * @param {*} name
 * @returns {string|null}
 */
function normalizeBitcoinNetwork (name) {
  const raw = String(name || '').trim().toLowerCase();
  if (!raw) return null;
  if (raw === 'bitcoin') return 'mainnet';
  if (raw === 'testnet3') return 'testnet';
  return raw;
}

function isKnownBitcoinNetwork (name) {
  const n = normalizeBitcoinNetwork(name);
  return !!(n && KNOWN_NETWORKS.includes(n));
}

/**
 * @param {object|null} fs Filesystem-like { readFile }
 * @returns {{ network: string, boundAt: string, schemaVersion: number }|null}
 */
function readNetworkBinding (fs) {
  if (!fs || typeof fs.readFile !== 'function') return null;
  try {
    const raw = fs.readFile(BEACON_NETWORK_PATH);
    if (raw == null) return null;
    const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object') return null;
    const network = normalizeBitcoinNetwork(parsed.network);
    if (!network) return null;
    return {
      network,
      boundAt: parsed.boundAt ? String(parsed.boundAt) : null,
      schemaVersion: Number(parsed.schemaVersion) || 1
    };
  } catch (_) {
    return null;
  }
}

/**
 * @param {object} fs { publish? | writeFile }
 * @param {string} network
 * @returns {object} binding written
 */
async function writeNetworkBinding (fs, network) {
  const net = normalizeBitcoinNetwork(network);
  if (!net) throw new Error('bitcoin network required to bind Beacon stores');
  if (!fs) throw new Error('filesystem required');
  const binding = {
    schemaVersion: 1,
    network: net,
    boundAt: new Date().toISOString()
  };
  const payload = JSON.stringify(binding, null, 2);
  if (typeof fs.publish === 'function') {
    await fs.publish(BEACON_NETWORK_PATH, binding);
  } else if (typeof fs.writeFile === 'function') {
    fs.writeFile(BEACON_NETWORK_PATH, payload);
  } else {
    throw new Error('filesystem publish/writeFile required');
  }
  return binding;
}

/**
 * True when path has non-empty content (Beacon/sidechain already used).
 * @param {object|null} fs
 * @param {string} path
 * @returns {boolean}
 */
function _pathHasContent (fs, path) {
  if (!fs || typeof fs.readFile !== 'function') return false;
  try {
    const raw = fs.readFile(path);
    if (raw == null) return false;
    const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
    if (!String(text).trim()) return false;
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object') {
        if (Array.isArray(parsed.messages) && parsed.messages.length === 0) return false;
        if (parsed.content && Object.keys(parsed.content).length === 0 && !(parsed.clock > 0)) {
          // empty-ish sidechain still counts if clock advanced
        }
      }
    } catch (_) { /* non-json still counts as content */ }
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * @param {object|null} fs
 * @returns {boolean}
 */
function hasBeaconOrSidechainData (fs) {
  return _pathHasContent(fs, BEACON_CHAIN_PATH)
    || _pathHasContent(fs, PENDING_EPOCH_ROUNDS_PATH)
    || _pathHasContent(fs, SIDECHAIN_SNAPSHOTS_PATH)
    || _pathHasContent(fs, SIDECHAIN_JOURNAL_PATH)
    || _pathHasContent(fs, SIDECHAIN_STATE_PATH);
}

/**
 * Assert live Bitcoin network matches bound Beacon stores.
 *
 * @param {object|null} fs
 * @param {string} liveNetwork
 * @param {{
 *   allowReset?: boolean,
 *   envAllowReset?: boolean
 * }} [opts]
 * @returns {{
 *   ok: boolean,
 *   code?: string,
 *   message?: string,
 *   stored?: string|null,
 *   live?: string|null,
 *   needsBind?: boolean,
 *   canReset?: boolean
 * }}
 */
function assertBeaconNetworkCompatible (fs, liveNetwork, opts = {}) {
  const live = normalizeBitcoinNetwork(liveNetwork);
  if (!live) {
    return {
      ok: false,
      code: 'NETWORK_UNKNOWN',
      message: 'Bitcoin network unavailable; cannot start Beacon safely',
      stored: null,
      live: null
    };
  }

  const binding = readNetworkBinding(fs);
  void opts;

  if (!binding) {
    // First run or pre-guard stores: if data exists without binding, require
    // explicit bind-as-live OR reset (operator must acknowledge network).
    if (hasBeaconOrSidechainData(fs)) {
      return {
        ok: false,
        code: 'NETWORK_UNBOUND',
        message: 'Beacon/sidechain stores exist without beacon/NETWORK binding. '
          + 'Set FABRIC_BEACON_RESET_NETWORK=1 to clear L1-tied stores and rebind, '
          + 'or migrate with an explicit bind after verifying the chain tip.',
        stored: null,
        live,
        needsBind: true,
        canReset: true
      };
    }
    return { ok: true, code: 'NETWORK_FRESH', stored: null, live, needsBind: true };
  }

  if (binding.network === live) {
    return { ok: true, code: 'NETWORK_OK', stored: binding.network, live };
  }

  return {
    ok: false,
    code: 'NETWORK_MISMATCH',
    message: `Beacon stores bound to bitcoin network "${binding.network}" but Hub is on "${live}". `
      + 'Clear L1-tied stores (FABRIC_BEACON_RESET_NETWORK=1) before promoting regtest → signet/mainnet.',
    stored: binding.network,
    live,
    canReset: true
  };
}

/**
 * Clear L1-tied Beacon + Hub sidechain tip artifacts (not application documents).
 * @param {object} fs { publish? | writeFile, unlink? | delete? }
 * @param {{ includeSidechainState?: boolean }} [opts]
 * @returns {{ cleared: string[] }}
 */
async function resetBeaconNetworkStores (fs, opts = {}) {
  if (!fs) throw new Error('filesystem required');
  const paths = [
    BEACON_CHAIN_PATH,
    PENDING_EPOCH_ROUNDS_PATH,
    SIDECHAIN_SNAPSHOTS_PATH,
    SIDECHAIN_JOURNAL_PATH
  ];
  if (opts.includeSidechainState !== false) {
    paths.push(SIDECHAIN_STATE_PATH);
  }

  const cleared = [];
  const emptyJson = '{}';

  async function clearPath (path) {
    if (typeof fs.unlink === 'function') {
      try {
        fs.unlink(path);
        cleared.push(path);
        return;
      } catch (_) { /* fall through */ }
    }
    if (typeof fs.delete === 'function') {
      try {
        fs.delete(path);
        cleared.push(path);
        return;
      } catch (_) { /* fall through */ }
    }
    if (typeof fs.publish === 'function') {
      await fs.publish(path, path === BEACON_CHAIN_PATH ? { messages: [], merkle: null } : {});
      cleared.push(path);
      return;
    }
    if (typeof fs.writeFile === 'function') {
      const body = path === BEACON_CHAIN_PATH
        ? JSON.stringify({ messages: [], merkle: null })
        : emptyJson;
      fs.writeFile(path, body);
      cleared.push(path);
    }
  }

  for (const path of paths) {
    await clearPath(path);
  }
  return { cleared };
}

/**
 * Run guard for Hub startBeacon: reset if allowed, else fail closed.
 *
 * @param {object|null} fs
 * @param {string} liveNetwork
 * @param {{ allowReset?: boolean }} [opts]
 * @returns {Promise<{ ok: boolean, binding?: object, check: object, reset?: object, error?: string }>}
 */
async function ensureBeaconNetworkBinding (fs, liveNetwork, opts = {}) {
  const allowReset = opts.allowReset === true
    || process.env.FABRIC_BEACON_RESET_NETWORK === '1'
    || process.env.FABRIC_BEACON_RESET_NETWORK === 'true';

  let check = assertBeaconNetworkCompatible(fs, liveNetwork, { allowReset });

  if (check.ok && check.needsBind) {
    const binding = await writeNetworkBinding(fs, liveNetwork);
    return { ok: true, binding, check };
  }

  if (check.ok) {
    return { ok: true, binding: readNetworkBinding(fs), check };
  }

  if ((check.code === 'NETWORK_MISMATCH' || check.code === 'NETWORK_UNBOUND') && allowReset) {
    const reset = await resetBeaconNetworkStores(fs, {
      includeSidechainState: opts.includeSidechainState !== false
    });
    const binding = await writeNetworkBinding(fs, liveNetwork);
    check = assertBeaconNetworkCompatible(fs, liveNetwork, { allowReset: false });
    return { ok: true, binding, check, reset };
  }

  return {
    ok: false,
    check,
    error: check.message || 'Beacon network guard failed'
  };
}

module.exports = {
  BEACON_NETWORK_PATH,
  BEACON_CHAIN_PATH,
  PENDING_EPOCH_ROUNDS_PATH,
  SIDECHAIN_STATE_PATH,
  SIDECHAIN_SNAPSHOTS_PATH,
  SIDECHAIN_JOURNAL_PATH,
  normalizeBitcoinNetwork,
  isKnownBitcoinNetwork,
  readNetworkBinding,
  writeNetworkBinding,
  hasBeaconOrSidechainData,
  assertBeaconNetworkCompatible,
  resetBeaconNetworkStores,
  ensureBeaconNetworkBinding
};
