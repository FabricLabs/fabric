'use strict';

/**
 * Federation validator pre-sign gates (production computational layer).
 *
 * Liquid lesson: agreeing on a digest is not the same as verifying that local
 * state and typed ledgers still conserve. Validators SHOULD refuse to Schnorr-
 * sign Beacon epochs, sidechain patches, or vault withdrawals until these
 * checks pass.
 *
 * @fileoverview Pre-sign verification for federation validators.
 * @module functions/federationValidatorVerify
 * @see docs/SIGNATURE_PROOF_MODEL.md
 * @see functions/federationReserveLedger.js
 */

const federationReserveLedger = require('./federationReserveLedger');
const contractProgramBind = require('./contractProgramBind');

/**
 * Fail-closed digest equality for epoch vs local snapshots.
 * When failClosed is true (validators configured), missing either side fails.
 *
 * @param {object} epoch
 * @param {object} localSidechain `{ stateDigest }`
 * @param {object} localContracts `{ merkleRoot|stateDigest }`
 * @param {Object} [opts]
 * @param {boolean} [opts.failClosed=true]
 * @returns {{ ok: true }|{ ok: false, error: string }}
 */
function verifyLocalEpochDigests (epoch, localSidechain, localContracts, opts = {}) {
  const failClosed = opts.failClosed !== false;
  if (!epoch || typeof epoch !== 'object') {
    return { ok: false, error: 'epoch required' };
  }

  if (epoch.contracts && typeof epoch.contracts === 'object') {
    const remoteRoot = epoch.contracts.merkleRoot || epoch.contracts.stateDigest;
    const localRoot = localContracts
      ? (localContracts.merkleRoot || localContracts.stateDigest)
      : null;
    if (failClosed) {
      if (!remoteRoot || !localRoot) {
        return { ok: false, error: 'contracts digest missing on remote or local snapshot' };
      }
      if (String(remoteRoot) !== String(localRoot)) {
        return { ok: false, error: 'contracts digest mismatch vs local snapshot' };
      }
    } else if (remoteRoot && localRoot && String(remoteRoot) !== String(localRoot)) {
      return { ok: false, error: 'contracts digest mismatch vs local snapshot' };
    }
  }

  if (epoch.sidechain && typeof epoch.sidechain === 'object') {
    const remoteDig = epoch.sidechain.stateDigest;
    const localDig = localSidechain && localSidechain.stateDigest
      ? localSidechain.stateDigest
      : null;
    if (failClosed) {
      if (!remoteDig || !localDig) {
        return { ok: false, error: 'sidechain digest missing on remote or local snapshot' };
      }
      if (String(remoteDig) !== String(localDig)) {
        return { ok: false, error: 'sidechain digest mismatch vs local snapshot' };
      }
    } else if (remoteDig && localDig && String(remoteDig) !== String(localDig)) {
      return { ok: false, error: 'sidechain digest mismatch vs local snapshot' };
    }
  }

  return { ok: true };
}

/**
 * Recompute reserve conservation on sidechain content (typed peg ledger).
 * No-op success when `/federationReserve` is absent.
 *
 * @param {object} [content]
 * @returns {{ ok: true, reserve?: object }|{ ok: false, error: string }}
 */
function verifyReserveConservation (content) {
  if (!content || typeof content !== 'object') return { ok: true };
  if (!content[federationReserveLedger.RESERVE_KEY]) return { ok: true };
  const reserve = federationReserveLedger.readReserve(content);
  const cons = federationReserveLedger.assertConservation(reserve);
  if (!cons.ok) return cons;
  return { ok: true, reserve };
}

/**
 * Re-verify a Machine/Program run commitment (independent recomputation gate).
 * @param {object} opts
 * @param {object} opts.program Program with runCommitmentHex()
 * @param {object} opts.run Machine run result (`tip`/`stack`/`runCommitmentHex`)
 * @returns {{ ok: true, programHash: string, runCommitmentHex: string }|{ ok: false, error: string }}
 */
function verifyProgramRunRecompute (opts = {}) {
  return contractProgramBind.assertMachineRunMatches(opts);
}

/**
 * Aggregate pre-sign gate for Beacon epoch auto-sign / vault prep.
 *
 * @param {object} opts
 * @param {object} [opts.epoch] Peer epoch payload
 * @param {object} [opts.localSidechain] `{ stateDigest, clock? }`
 * @param {object} [opts.localContracts] `{ merkleRoot|stateDigest }`
 * @param {object} [opts.sidechainContent] Full sidechain content for reserve check
 * @param {boolean} [opts.failClosed=true]
 * @param {object} [opts.program] Optional Program for recompute
 * @param {object} [opts.run] Optional Machine run
 * @returns {{ ok: true, checks: string[] }|{ ok: false, error: string, checks: string[] }}
 */
function evaluateValidatorSignGate (opts = {}) {
  const checks = [];
  const failClosed = opts.failClosed !== false;

  if (opts.epoch) {
    const dig = verifyLocalEpochDigests(
      opts.epoch,
      opts.localSidechain || null,
      opts.localContracts || null,
      { failClosed }
    );
    if (!dig.ok) {
      return { ok: false, error: dig.error, checks };
    }
    checks.push('epoch-digests');
  }

  if (opts.sidechainContent != null || (opts.localSidechain && opts.localSidechain.content)) {
    const content = opts.sidechainContent != null
      ? opts.sidechainContent
      : opts.localSidechain.content;
    const reserve = verifyReserveConservation(content);
    if (!reserve.ok) {
      return { ok: false, error: reserve.error, checks };
    }
    if (reserve.reserve) checks.push('reserve-conservation');
  }

  if (opts.program && opts.run) {
    const run = verifyProgramRunRecompute({
      program: opts.program,
      run: opts.run
    });
    if (!run.ok) {
      return { ok: false, error: run.error, checks };
    }
    checks.push('program-run-recompute');
  }

  return { ok: true, checks };
}

module.exports = {
  verifyLocalEpochDigests,
  verifyReserveConservation,
  verifyProgramRunRecompute,
  evaluateValidatorSignGate
};
