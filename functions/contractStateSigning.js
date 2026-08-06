'use strict';

/**
 * Contract-namespace tip attestation (k-of-n Schnorr).
 *
 * Same witness shape as {@link beaconFederationSigning}: members / validators
 * Schnorr-sign a canonical tip string. Used by GoonCitizen Group Statechain
 * journals today; Hub contract sidechains SHOULD reuse this when sealing
 * per-namespace tips (keep Hub docs / RPC in sync if the tip kind changes).
 *
 * @see functions/beaconFederationSigning.js
 * @see docs/APPLICATION_NAMESPACES.md
 * @see docs/DISTRIBUTED_EXECUTION.md
 */

const crypto = require('crypto');
const Key = require('../types/key');
const fabricCanonicalJson = require('./fabricCanonicalJson');
const { verifyFederationWitnessOnMessage } = require('./beaconFederationSigning');

/** Canonical tip kind — Hub and apps must agree; bump only with protocol note. */
const CONTRACT_STATE_TIP_KIND = 'ContractStateTip';

/**
 * UTF-8 string members Schnorr-sign for a contract-namespace tip.
 * @param {object} fields
 * @param {string} fields.contractId
 * @param {number} fields.clock
 * @param {string} fields.stateDigest
 * @returns {string}
 */
function signingStringForContractStateTip (fields = {}) {
  return fabricCanonicalJson({
    version: 1,
    kind: CONTRACT_STATE_TIP_KIND,
    contractId: String(fields.contractId || '').trim().toLowerCase(),
    clock: Number(fields.clock) || 0,
    stateDigest: String(fields.stateDigest || '').trim().toLowerCase()
  });
}

/**
 * @param {string} contractId
 * @param {number} clock
 * @param {string} stateDigest
 * @returns {Buffer}
 */
function tipMessageBuffer (contractId, clock, stateDigest) {
  return Buffer.from(signingStringForContractStateTip({ contractId, clock, stateDigest }), 'utf8');
}

/**
 * Sign a tip with a Fabric Key (or `{ xprv }` / Key-like).
 * @param {object} keyOrSettings Key instance or settings for `new Key(...)`
 * @param {string} contractId
 * @param {number} clock
 * @param {string} stateDigest
 * @returns {{ pubkey: string, signature: string, message: string }}
 */
function signContractStateTip (keyOrSettings, contractId, clock, stateDigest) {
  const key = keyOrSettings && typeof keyOrSettings.signSchnorr === 'function'
    ? keyOrSettings
    : new Key(keyOrSettings || {});
  const message = signingStringForContractStateTip({ contractId, clock, stateDigest });
  const signature = Buffer.from(key.signSchnorr(Buffer.from(message, 'utf8'))).toString('hex');
  return { pubkey: key.pubkey, signature, message };
}

/**
 * Verify k-of-n tip signatures (Federation witness shape).
 * @param {string[]} validatorPubkeys
 * @param {number} threshold
 * @param {string} contractId
 * @param {number} clock
 * @param {string} stateDigest
 * @param {{ [pubkey: string]: string }|{ signatures: object }} signaturesOrWitness
 * @returns {boolean}
 */
function verifyContractStateTip (
  validatorPubkeys,
  threshold,
  contractId,
  clock,
  stateDigest,
  signaturesOrWitness
) {
  const witness = signaturesOrWitness && signaturesOrWitness.signatures
    && typeof signaturesOrWitness.signatures === 'object'
    ? signaturesOrWitness
    : { signatures: signaturesOrWitness || {} };
  return verifyFederationWitnessOnMessage(
    tipMessageBuffer(contractId, clock, stateDigest),
    witness,
    validatorPubkeys,
    threshold
  );
}

/**
 * Merge signature maps (pubkey → sig hex), last write wins per key.
 * @param {...object} maps
 * @returns {{ [pubkey: string]: string }}
 */
function mergeTipSignatures (...maps) {
  const out = {};
  for (const m of maps) {
    if (!m || typeof m !== 'object') continue;
    const src = m.signatures && typeof m.signatures === 'object' ? m.signatures : m;
    for (const [pk, sig] of Object.entries(src)) {
      if (typeof pk === 'string' && pk && typeof sig === 'string' && sig) {
        out[pk] = sig;
      }
    }
  }
  return out;
}

/**
 * Stable digest helper for tests / logging.
 * @param {string} contractId
 * @param {number} clock
 * @param {string} stateDigest
 * @returns {string} hex sha256 of tip message
 */
function tipDigestHex (contractId, clock, stateDigest) {
  return crypto.createHash('sha256')
    .update(tipMessageBuffer(contractId, clock, stateDigest))
    .digest('hex');
}

module.exports = {
  CONTRACT_STATE_TIP_KIND,
  signingStringForContractStateTip,
  tipMessageBuffer,
  signContractStateTip,
  verifyContractStateTip,
  mergeTipSignatures,
  tipDigestHex
};
