'use strict';

/**
 * Bind a Fabric Program run into a Taproot hashlock leaf (L1-enforced commitment).
 *
 * Machine digests stay off-chain integrity; attaching a hashlock leaf **changes**
 * the P2TR address and lets anyone who knows the preimage (often the run
 * commitment bytes or a derived preimage) spend without k-of-n — use only when
 * that threat model is intentional.
 *
 * @fileoverview Program run → Taproot hashlock composition.
 * @module functions/programTaprootBind
 * @see docs/PROGRAM.md
 * @see functions/contractTaproot.js
 */

const contractTaproot = require('./contractTaproot');
const contractProgramBind = require('./contractProgramBind');

/**
 * Build hashlock leaf options from a sealed Program run.
 * Commitment defaults to `runCommitmentHex` (32-byte hex).
 *
 * @param {object} run
 * @param {string} run.runCommitmentHex
 * @param {string} [run.programHash]
 * @param {string} [run.commitmentHex] Override commitment
 * @param {string} [run.id='hashlock-run']
 * @param {string} [run.pubkeyHex] Optional Schnorr key for preimage+sig path
 * @returns {{ id: string, commitmentHex: string, programHash: string|null, pubkeyHex?: string }}
 */
function hashlockFromProgramRun (run = {}) {
  const runCommitmentHex = String(run.runCommitmentHex || run.runCommitment || '')
    .trim()
    .toLowerCase();
  const commitmentHex = String(run.commitmentHex || runCommitmentHex).trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(commitmentHex)) {
    throw new Error('hashlockFromProgramRun: runCommitmentHex / commitmentHex required (64-hex)');
  }
  const programHash = run.programHash
    ? String(run.programHash).trim().toLowerCase()
    : null;
  if (programHash && !/^[0-9a-f]{64}$/.test(programHash)) {
    throw new Error('hashlockFromProgramRun: programHash must be 64-hex when set');
  }
  const out = {
    id: run.id ? String(run.id) : 'hashlock-run',
    commitmentHex,
    programHash
  };
  if (run.pubkeyHex) out.pubkeyHex = String(run.pubkeyHex).trim().toLowerCase();
  return out;
}

/**
 * Compose an authority ladder (or policy) with a Program-run hashlock leaf.
 *
 * @param {object} opts
 * @param {object} [opts.policy] Existing spend policy
 * @param {object} [opts.ladder] Args for synthesizeDefaultLadder when policy omitted
 * @param {object} opts.run `{ programHash?, runCommitmentHex, id?, pubkeyHex? }`
 * @param {string} [opts.network]
 * @param {object[]} [opts.extraLeaves]
 * @returns {object} `composeTaprootTree` result (+ `programRunId`)
 */
function composePolicyWithRunHashlock (opts = {}) {
  const hashlock = hashlockFromProgramRun(opts.run || {});
  let policy = opts.policy || null;
  if (!policy && opts.ladder && typeof opts.ladder === 'object') {
    policy = contractTaproot.synthesizeDefaultLadder(opts.ladder);
  }
  if (!policy) {
    throw new Error('composePolicyWithRunHashlock: policy or ladder required');
  }
  const network = opts.network || policy.network || 'regtest';
  const tree = contractTaproot.composeTaprootTree({
    network,
    policy,
    hashlock: {
      commitmentHex: hashlock.commitmentHex,
      id: hashlock.id,
      pubkeyHex: hashlock.pubkeyHex
    },
    extraLeaves: Array.isArray(opts.extraLeaves) ? opts.extraLeaves : []
  });
  const programRunId = hashlock.programHash
    ? contractProgramBind.programRunId(hashlock.programHash, hashlock.commitmentHex)
    : null;
  return Object.assign({}, tree, {
    hashlock,
    programRunId
  });
}

module.exports = {
  hashlockFromProgramRun,
  composePolicyWithRunHashlock
};
