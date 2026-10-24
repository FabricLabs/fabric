'use strict';

/**
 * @fileoverview Allowlist of Bitcoin test networks. Value-bearing code that
 * must never touch mainnet (payment channels, market HTLCs) accepts only
 * these names; anything else — mainnet aliases, typos, unknown names — is
 * refused rather than silently mapped to mainnet parameters.
 */

const TEST_NETWORKS = Object.freeze(['regtest', 'signet', 'testnet', 'testnet4']);

/**
 * @param {*} name network name
 * @returns {string} trimmed, lowercased name
 * @private
 */
function normalizeNetworkName (name) {
  return String(name == null ? '' : name).trim().toLowerCase();
}

/**
 * @param {*} name network name (case-insensitive, surrounding whitespace ignored)
 * @returns {boolean} `true` for regtest / signet / testnet / testnet4 only
 */
function isTestNetwork (name) {
  return TEST_NETWORKS.includes(normalizeNetworkName(name));
}

/**
 * Throw unless `name` is an allowlisted test network.
 * @param {*} name network name
 * @param {string} [label] error prefix
 * @returns {string} normalised network name
 */
function assertTestNetwork (name, label = 'network') {
  const n = normalizeNetworkName(name);
  if (!TEST_NETWORKS.includes(n)) {
    throw new Error(`${label}: network "${n || String(name)}" refused (${TEST_NETWORKS.join('/')} only; mainnet refused)`);
  }
  return n;
}

module.exports = {
  TEST_NETWORKS,
  normalizeNetworkName,
  isTestNetwork,
  assertTestNetwork
};
