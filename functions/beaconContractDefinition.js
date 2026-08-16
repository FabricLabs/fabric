'use strict';

/**
 * Canonical Fabric Beacon Federation genesis for CONTRACT_PUBLISH.
 *
 * Beacon remains the L1 epoch sealer (`types/beacon`); this module defines the
 * **native Contract / ARC** surface for the same authority set (validators,
 * threshold, Taproot ladder). Actor id is content-addressed — keep Bitcoin
 * `network` and tip `bitcoinAnchor` out of genesis so the same definition
 * redeploys across regtest → signet → mainnet with Accept overlays.
 *
 * @module functions/beaconContractDefinition
 * @see docs/ARC.md
 */

const Actor = require('../types/actor');
const { pubkeyCompressed } = require('./groupChatSeal');
const { sortPubkeysBip67 } = require('./bip67');
const { canonicalSpendPolicy } = require('./contractSpend');
const { DEFAULT_CSV_BLOCKS } = require('./contractTaproot');

const BEACON_CONTRACT_NAME = 'fabric-beacon';
const BEACON_CONTRACT_VERSION = 1;
const BEACON_CONTRACT_INTERFACES = Object.freeze(['arc.core', 'fabric.beacon']);

/** CONTRACT_MESSAGE body types allowed under the Beacon ARC namespace. */
const BEACON_MESSAGE_TYPES = Object.freeze([
  'GroupChange',
  'ContractCapabilityGrant',
  'ContractWithdrawalRequest',
  'ContractWithdrawalWitness',
  'FederationContractInvite',
  'FederationContractInviteResponse'
]);

/**
 * @param {Iterable<*>} list
 * @returns {string[]} sorted unique compressed pubkeys
 */
function normalizeValidatorPubkeys (list) {
  const out = [];
  const seen = new Set();
  for (const raw of list || []) {
    let c = null;
    try {
      // pubkeyCompressed already accepts compressed or validated x-only inputs.
      // Do not invent `02${x}` for invalid points.
      c = pubkeyCompressed(raw);
    } catch (_) {
      continue;
    }
    if (!c) continue;
    const key = c.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c.toLowerCase());
  }
  return sortPubkeysBip67(out).map((b) => b.toString('hex'));
}

/**
 * Build a network-agnostic Beacon ARC genesis.
 *
 * @param {object} [opts]
 * @param {string[]} [opts.validators] federation validator pubkeys
 * @param {number} [opts.threshold]
 * @param {string} [opts.publisher] soft-tier key (defaults to first validator)
 * @param {number} [opts.csvBlocks=144] t1-soft CSV delay
 * @param {string} [opts.softMode='publisher'] `publisher` | `reduced`
 * @param {number} [opts.version=1]
 * @returns {object} CONTRACT_PUBLISH body (no `network`, no `bitcoinAnchor`)
 */
function beaconContractDefinition (opts = {}) {
  const spendPolicy = canonicalSpendPolicy({
    validators: opts.validators || [],
    threshold: opts.threshold,
    publisher: opts.publisher,
    csvBlocks: opts.csvBlocks != null ? opts.csvBlocks : DEFAULT_CSV_BLOCKS,
    softMode: opts.softMode
  });
  // Intentionally omit network from genesis (Actor-id stability across environments).
  delete spendPolicy.network;

  return {
    '@type': 'FabricContract',
    name: BEACON_CONTRACT_NAME,
    version: opts.version != null ? Number(opts.version) : BEACON_CONTRACT_VERSION,
    interfaces: BEACON_CONTRACT_INTERFACES.slice(),
    primitives: {
      messageTypes: BEACON_MESSAGE_TYPES.slice(),
      opcodes: []
    },
    members: {
      signers: spendPolicy.validators.slice(),
      readers: ['*'],
      threshold: spendPolicy.threshold
    },
    spendPolicy,
    sidechainPolicy: {
      allowedPathPrefixes: ['/registry', '/members', '/epochs'],
      maxOps: 32
    }
  };
}

/**
 * Content-addressed namespace id for a Beacon (or any) genesis object.
 * @param {object} definition
 * @returns {string}
 */
function beaconContractId (definition) {
  if (!definition || typeof definition !== 'object') {
    throw new Error('beaconContractId: definition object required');
  }
  return (new Actor(definition)).id;
}

/**
 * Operator checklist for promoting Beacon across Bitcoin networks.
 * Genesis stays fixed; stores + spend overlays are environment-local.
 *
 * @returns {string[]}
 */
function beaconRedeploySteps () {
  return [
    'Confirm FABRIC_BITCOIN_NETWORK (or settings.bitcoin.network) for the target environment.',
    'Set FABRIC_BEACON_RESET_NETWORK=1 once when flipping networks with existing beacon/CHAIN data.',
    'Restart Hub so startBeacon binds beacon/NETWORK and auto-registers the fabric-beacon ARC.',
    'Verify federation vault address matches accepted Beacon ARC spendAddress on that network.',
    'Clear FABRIC_BEACON_RESET_NETWORK after a successful bind (do not leave reset enabled).',
    'Do not embed spendPolicy.network or tip bitcoinAnchor into CONTRACT_PUBLISH genesis.'
  ];
}

module.exports = {
  BEACON_CONTRACT_NAME,
  BEACON_CONTRACT_VERSION,
  BEACON_CONTRACT_INTERFACES,
  BEACON_MESSAGE_TYPES,
  normalizeValidatorPubkeys,
  beaconContractDefinition,
  beaconContractId,
  beaconRedeploySteps
};
