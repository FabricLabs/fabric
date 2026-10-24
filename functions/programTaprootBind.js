'use strict';

/**
 * Bind a Fabric Program run into a Taproot hashlock leaf (L1-enforced commitment).
 *
 * Machine digests stay off-chain integrity; attaching a hashlock leaf **changes**
 * the P2TR address and lets the preimage holder spend without k-of-n. The
 * composed leaf requires a Schnorr signature from `run.pubkeyHex` as well as the
 * preimage; a preimage-only leaf (anyone who learns the preimage can spend)
 * needs an explicit `allowPreimageOnly: true`.
 *
 * That guard lives here only. Passing `hashlockFromProgramRun(run)` (or any
 * `{ hashlock }` without `pubkeyHex`) straight to
 * `contractTaproot.composeTaprootTree` still builds a preimage-only leaf unless
 * the caller also sets `hashlock.requirePubkey: true`.
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
 * @returns {{ id: string, commitmentHex: string, runCommitmentHex: string|null, programHash: string|null, pubkeyHex?: string }}
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
    // Keep Program-run id material separate from an optional leaf commitment override.
    runCommitmentHex: /^[0-9a-f]{64}$/.test(runCommitmentHex) ? runCommitmentHex : null,
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
 * @param {object} opts.run `{ programHash?, runCommitmentHex, id?, pubkeyHex }`
 * @param {boolean} [opts.allowPreimageOnly=false] Compose without `run.pubkeyHex` (preimage alone spends)
 * @param {string} [opts.network]
 * @param {object[]} [opts.extraLeaves]
 * @returns {object} `composeTaprootTree` result (+ `programRunId`)
 */
function composePolicyWithRunHashlock (opts = {}) {
  const hashlock = hashlockFromProgramRun(opts.run || {});
  const requirePubkey = opts.allowPreimageOnly !== true;
  if (requirePubkey && !hashlock.pubkeyHex) {
    throw new Error(
      'composePolicyWithRunHashlock: run.pubkeyHex required (pass allowPreimageOnly: true for a preimage-only leaf)'
    );
  }
  let policy = opts.policy || null;
  if (!policy && opts.ladder && typeof opts.ladder === 'object') {
    policy = contractTaproot.synthesizeDefaultLadder(opts.ladder);
  }
  if (!policy) {
    throw new Error('composePolicyWithRunHashlock: policy or ladder required');
  }
  if (policy.hashlock) {
    throw new Error(
      'composePolicyWithRunHashlock: policy.hashlock already set; omit it so the Program-run hashlock is composed'
    );
  }
  const policyNetwork = policy.network || policy.networkName || null;
  if (opts.network && policyNetwork && String(opts.network) !== String(policyNetwork)) {
    throw new Error('composePolicyWithRunHashlock: opts.network conflicts with policy.network');
  }
  const network = opts.network || policyNetwork || 'regtest';
  const policyForTree = Object.assign({}, policy, { network });
  const tree = contractTaproot.composeTaprootTree({
    network,
    policy: policyForTree,
    hashlock: {
      commitmentHex: hashlock.commitmentHex,
      id: hashlock.id,
      pubkeyHex: hashlock.pubkeyHex,
      requirePubkey
    },
    extraLeaves: Array.isArray(opts.extraLeaves) ? opts.extraLeaves : []
  });
  const programRunId = (hashlock.programHash && hashlock.runCommitmentHex)
    ? contractProgramBind.programRunId(hashlock.programHash, hashlock.runCommitmentHex)
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
