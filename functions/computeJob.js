'use strict';

/**
 * Paid run of a known program.
 *
 * A {@link ComputeOffer} is a `CONTRACT_MESSAGE` body: `programHash`, an input
 * commitment, a price, a bond, and a challenge window. The worker posts a
 * `FabricProgramRun`. Any peer reruns the program. A matching rerun lets the
 * worker claim the bounty with the run commitment as the preimage. A different
 * claim is a `wrong-run` fraud proof, and {@link Bond.preparePenaltySpend}
 * can move the worker's deposit.
 *
 * Only deterministic `fabric-execution` and `fabric-opcodes` programs of at
 * most 256 steps can be bonded. `javascript` and `trusted: true` are refused.
 * This is not a hardened virtual machine. Bonds stay off mainnet.
 */

const crypto = require('crypto');
const { fabricCanonicalJson } = require('./fabricCanonicalJson');
const Bond = require('../types/bond');

const MAX_STEPS = 256;
const HEX64 = /^[0-9a-f]{64}$/;
const BONDABLE = new Set(['fabric-execution', 'fabric-opcodes']);

function sha256Hex (text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

/**
 * SHA-256 of the canonical JSON input. The proof carries the input; the
 * offer carries this digest.
 * @param {*} input
 * @returns {string}
 */
function inputCommitmentHex (input) {
  return sha256Hex(fabricCanonicalJson(input == null ? null : input));
}

/**
 * @param {object} program plain program or a {@link Program}
 * @returns {import('../types/program')}
 */
function asProgram (program) {
  const Program = require('../types/program');
  if (program instanceof Program) return program;
  return Program.from(program || {});
}

/**
 * @param {import('../types/program')} program
 */
function assertBondable (program) {
  if (!program) throw new Error('compute: program required');
  if (program.language === 'javascript' || program.settings.trusted === true) {
    throw new Error('compute: javascript and trusted programs cannot be bonded');
  }
  if (BONDABLE.has(program.language) === false) {
    throw new Error('compute: only fabric-execution and fabric-opcodes can be bonded');
  }
  const steps = program.language === 'fabric-execution'
    ? ((program.source && program.source.steps) || program.steps)
    : program.steps;
  if (!Array.isArray(steps) || steps.length > MAX_STEPS) {
    throw new Error(`compute: program exceeds ${MAX_STEPS} steps`);
  }
}

/**
 * Rerun a bondable program. Synchronous (child process). The input is bound
 * by {@link inputCommitmentHex}; the machine result is the program body.
 * @param {object} program
 * @param {*} [input]
 * @returns {object}
 */
function rerun (program, input) {
  const Program = require('../types/program');
  const prog = asProgram(program);
  assertBondable(prog);
  if (prog.language === 'fabric-execution') {
    const source = prog.source && typeof prog.source === 'object' ? prog.source : { steps: prog.steps };
    const out = Program.runIsolated(source);
    return Object.assign({ inputCommitment: inputCommitmentHex(input) }, out);
  }
  const out = Program.runIsolatedOpcodes(prog.steps);
  return Object.assign({ inputCommitment: inputCommitmentHex(input), program: prog }, out);
}

/**
 * @param {object} opts
 * @returns {object} `ComputeOffer`
 */
function offer (opts = {}) {
  const prog = asProgram(opts.program);
  assertBondable(prog);
  const priceSats = Math.floor(Number(opts.priceSats));
  const bondSats = Math.floor(Number(opts.bondSats));
  const challengeWindowBlocks = Math.floor(Number(opts.challengeWindowBlocks));
  if (!(priceSats > 0)) throw new Error('compute: priceSats must be a positive integer');
  if (!(bondSats > 0)) throw new Error('compute: bondSats must be a positive integer');
  if (!(challengeWindowBlocks > 0)) throw new Error('compute: challengeWindowBlocks must be a positive integer');
  return {
    type: 'ComputeOffer',
    version: 1,
    programHash: prog.programHash,
    program: prog.toJSON(),
    inputCommitment: inputCommitmentHex(opts.input),
    priceSats,
    bondSats,
    challengeWindowBlocks,
    workerPubkey: opts.workerPubkey ? String(opts.workerPubkey).toLowerCase() : null,
    depositAddress: opts.depositAddress ? String(opts.depositAddress) : null
  };
}

/**
 * Bounty whose epoch leaf opens with the run commitment as the preimage.
 * @param {object} opts `{ offer, runCommitmentHex, publisherPubkey, workerPubkey, refundAfter, network, epoch }`
 * @returns {object}
 */
function bountyForRun (opts = {}) {
  const worker = String(opts.workerPubkey || '').toLowerCase();
  const run = String(opts.runCommitmentHex || '').toLowerCase();
  if (!HEX64.test(run)) throw new Error('compute: runCommitmentHex must be 64 hex chars');
  const epoch = Math.floor(Number(opts.epoch) || 1);
  const commitments = {};
  commitments[worker] = Bond.commitmentFor(run);
  return Bond.buildBounty({
    network: opts.network || 'regtest',
    publisherPubkey: opts.publisherPubkey,
    providerPubkeys: [worker],
    epochs: [{ epoch, amountSats: Math.floor(Number(opts.priceSats)), commitments }],
    refundAfter: opts.refundAfter,
    merkleRootHex: opts.programHash
  });
}

/**
 * Answer-leaf commitment for a claimed run: SHA-256 of the 32-byte commitment.
 * @param {string} runCommitmentHex
 * @returns {string}
 */
function answerHashForRun (runCommitmentHex) {
  return Bond.commitmentFor(runCommitmentHex);
}

/**
 * @param {object} artifacts
 * @returns {{ ok: boolean, offender: (string|null), reputational: boolean, reason: (string|null), evidence: (string|undefined) }}
 */
function verifyWrongRun (artifacts = {}) {
  const fail = (reason) => ({ ok: false, offender: null, reputational: false, reason });
  const Program = require('../types/program');
  let prog;
  try {
    prog = asProgram(artifacts.program);
    assertBondable(prog);
  } catch (err) {
    return fail(err.message);
  }
  if (artifacts.programHash && prog.programHash !== String(artifacts.programHash).toLowerCase()) {
    return fail('program bytes do not match programHash');
  }
  const inputCommitment = inputCommitmentHex(artifacts.input);
  if (!artifacts.inputCommitment || inputCommitment !== String(artifacts.inputCommitment).toLowerCase()) {
    return fail('input does not match inputCommitment');
  }
  const claimed = String(artifacts.claimedRunCommitmentHex || '').toLowerCase();
  if (!HEX64.test(claimed)) return fail('claimedRunCommitmentHex must be 64 hex chars');
  const worker = String(artifacts.workerPubkey || '').toLowerCase();
  if (!HEX64.test(worker)) return fail('workerPubkey must be x-only hex');
  let out;
  try {
    out = rerun(prog, artifacts.input);
  } catch (err) {
    return fail(err.message);
  }
  if (!out || out.ok !== true || !out.runCommitmentHex) {
    return fail(out && out.error ? out.error : 'rerun failed');
  }
  const check = Program.verifyMachineRun({
    program: out.program || prog,
    run: { tip: out.tip, trace: out.trace, runCommitmentHex: claimed }
  });
  if (check.ok && check.runCommitmentHex === claimed) {
    return fail('claimed run matches the rerun');
  }
  if (check.ok) return fail('claimed run matches the rerun');
  if (!/does not match/.test(String(check.error || ''))) return fail(check.error || 'rerun could not be checked');
  return {
    ok: true,
    offender: worker,
    reputational: true,
    reason: 'claimed runCommitmentHex does not match the rerun',
    evidence: 'wrong-run'
  };
}

module.exports = {
  MAX_STEPS,
  inputCommitmentHex,
  assertBondable,
  rerun,
  offer,
  bountyForRun,
  answerHashForRun,
  verifyWrongRun
};
