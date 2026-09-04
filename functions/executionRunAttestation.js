'use strict';

/**
 * Federation attestation strings for execution program runs.
 * @module functions/executionRunAttestation
 */

const crypto = require('crypto');
const fabricCanonicalJson = require('./fabricCanonicalJson');
const { verifyFederationWitnessOnMessage } = require('./beaconFederationSigning');

const EXECUTION_RUN_SIGNING_KIND = 'FabricProgramRun';

/**
 * UTF-8 string federation members sign for an execution run commitment.
 * @param {{ programHash: string, runCommitmentHex: string, contractId?: string|null }} run
 * @returns {string}
 */
function signingStringForExecutionRun (run) {
  return fabricCanonicalJson({
    version: 1,
    kind: EXECUTION_RUN_SIGNING_KIND,
    programHash: String(run.programHash || ''),
    runCommitmentHex: String(run.runCommitmentHex || '').toLowerCase(),
    contractId: run.contractId != null ? String(run.contractId) : null
  });
}

/**
 * SHA-256 hex digest of {@link signingStringForExecutionRun}.
 * @param {{ programHash: string, runCommitmentHex: string, contractId?: string|null }} run
 * @returns {string}
 */
function executionRunCommitmentDigestHex (run) {
  const s = signingStringForExecutionRun(run);
  return crypto.createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex');
}

/**
 * Build federation witness for an execution run attestation.
 * @param {{ programHash: string, runCommitmentHex: string, contractId?: string|null, signKey: object, validators?: string[], threshold?: number }} opts
 * @returns {object|null}
 */
function buildFederationWitnessForExecutionRun (opts) {
  const signKey = opts.signKey;
  if (!signKey || typeof signKey.signSchnorr !== 'function') return null;
  const msgBuf = Buffer.from(signingStringForExecutionRun(opts), 'utf8');
  const sigHex = signKey.signSchnorr(msgBuf).toString('hex');
  const pk = signKey.pubkey != null ? String(signKey.pubkey) : '';
  if (!pk) return null;
  const witness = { version: 1, signatures: { [pk]: sigHex } };
  if (Array.isArray(opts.validators) && opts.validators.length) {
    witness.validators = opts.validators.slice();
    witness.threshold = Math.max(1, Number(opts.threshold) || 1);
  }
  return witness;
}

/**
 * Verify federation witness over an execution run attestation.
 * @param {{ programHash: string, runCommitmentHex: string, contractId?: string|null }} run
 * @param {object|null} federationWitness
 * @param {string[]} validators
 * @param {number} threshold
 * @returns {boolean}
 */
function verifyExecutionRunFederationWitness (run, federationWitness, validators, threshold) {
  const msgBuf = Buffer.from(signingStringForExecutionRun(run), 'utf8');
  return verifyFederationWitnessOnMessage(msgBuf, federationWitness, validators, threshold);
}

module.exports = {
  EXECUTION_RUN_SIGNING_KIND,
  signingStringForExecutionRun,
  executionRunCommitmentDigestHex,
  buildFederationWitnessForExecutionRun,
  verifyExecutionRunFederationWitness
};
