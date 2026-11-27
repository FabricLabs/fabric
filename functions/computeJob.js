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
function positiveInt (value, label) {
  const n = Math.floor(Number(value));
  if (!Number.isSafeInteger(n) || n <= 0) {
    throw new Error(`compute: ${label} must be a positive integer`);
  }
  return n;
}

/**
 * Compile, then reject anything that is not a short deterministic program.
 * @param {object} program
 * @returns {import('../types/program')}
 */
function prepareProgram (program) {
  const prog = asProgram(program);
  if (!prog) throw new Error('compute: program required');
  if (prog.language === 'javascript' || prog.settings.trusted === true) {
    throw new Error('compute: javascript and trusted programs cannot be bonded');
  }
  if (BONDABLE.has(prog.language) === false) {
    throw new Error('compute: only fabric-execution and fabric-opcodes can be bonded');
  }
  const compiled = prog.compile();
  if (!compiled.ok) throw new Error(compiled.error || 'compute: compile failed');
  const steps = prog.language === 'fabric-execution'
    ? ((prog.source && prog.source.steps) || prog.steps)
    : prog.steps;
  if (!Array.isArray(steps) || steps.length > MAX_STEPS) {
    throw new Error(`compute: program exceeds ${MAX_STEPS} steps`);
  }
  return prog;
}

function assertBondable (program) {
  prepareProgram(program);
}

/**
 * Canonical JSON value placed on the stack before the program steps.
 * @param {*} input
 * @returns {*}
 */
function seedValueFor (input) {
  return JSON.parse(fabricCanonicalJson(input == null ? null : input));
}

/**
 * Digest of one paid run: program, the input commitment, and the machine result.
 * `Program.runCommitmentHex` stays the machine result alone.
 * @param {string} programHash
 * @param {string} inputCommitment
 * @param {string} runCommitmentHex
 * @returns {string}
 */
function jobCommitmentHex (programHash, inputCommitment, runCommitmentHex) {
  return sha256Hex(
    String(programHash || '').toLowerCase()
    + String(inputCommitment || '').toLowerCase()
    + String(runCommitmentHex || '').toLowerCase()
  );
}

/**
 * Rerun a bondable program on a Machine. Synchronous on Node. The paid input is the
 * first stack value. {@link jobCommitmentHex} binds that input to the result.
 * @param {object} program
 * @param {*} [input]
 * @returns {object}
 */
function rerun (program, input) {
  const Program = require('../types/program');
  const prog = prepareProgram(program);
  const seedValue = seedValueFor(input);
  const inputCommitment = inputCommitmentHex(input);
  let out;
  if (prog.language === 'fabric-execution') {
    const source = prog.source && typeof prog.source === 'object' ? prog.source : { steps: prog.steps };
    const Machine = require('../types/machine');
    out = Machine.runIsolated(source, { seedValue });
  } else {
    const steps = prog.steps.slice();
    const identity = Program.from({ language: 'fabric-opcodes', steps });
    const Machine = require('../types/machine');
    out = Object.assign({}, Machine.runIsolatedOpcodes(steps, { seedValue }), {
      program: identity,
      programHash: identity.programHash
    });
  }
  const job = (out && out.ok === true && out.runCommitmentHex)
    ? jobCommitmentHex(out.programHash || prog.programHash, inputCommitment, out.runCommitmentHex)
    : null;
  return Object.assign({}, out, { inputCommitment, jobCommitmentHex: job });
}

/**
 * @param {object} opts
 * @returns {object} `ComputeOffer`
 */
function offer (opts = {}) {
  const prog = prepareProgram(opts.program);
  const priceSats = positiveInt(opts.priceSats, 'priceSats');
  const bondSats = positiveInt(opts.bondSats, 'bondSats');
  const challengeWindowBlocks = positiveInt(opts.challengeWindowBlocks, 'challengeWindowBlocks');
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
  const Witness = require('../types/witness');
  const claim = artifacts.claim;
  if (!claim || !Witness.verifyArtifact(claim, worker)) {
    return fail('worker signature required');
  }
  if (String(claim.programHash || '').toLowerCase() !== prog.programHash) {
    return fail('claim program does not match');
  }
  if (String(claim.inputCommitment || '').toLowerCase() !== inputCommitment) {
    return fail('claim input does not match');
  }
  if (String(claim.claimedRunCommitmentHex || '').toLowerCase() !== claimed) {
    return fail('claim commitment does not match');
  }
  if (artifacts.depositAddress && String(claim.depositAddress || '') !== String(artifacts.depositAddress)) {
    return fail('claim deposit does not match');
  }
  let out;
  try {
    out = rerun(prog, artifacts.input);
  } catch (err) {
    return fail(err.message);
  }
  if (!out || out.ok !== true || !out.runCommitmentHex || !out.jobCommitmentHex) {
    return fail(out && out.error ? out.error : 'rerun failed');
  }
  const check = Program.verifyMachineRun({
    program: out.program || prog,
    run: { tip: out.tip, trace: out.trace, runCommitmentHex: out.runCommitmentHex }
  });
  if (!check.ok) return fail(check.error || 'rerun could not be checked');
  if (claimed === out.jobCommitmentHex) {
    return fail('claimed run matches the rerun');
  }
  return {
    ok: true,
    offender: worker,
    reputational: true,
    reason: 'claimed job commitment does not match the rerun',
    evidence: 'wrong-run'
  };
}

module.exports = {
  MAX_STEPS,
  inputCommitmentHex,
  jobCommitmentHex,
  assertBondable,
  rerun,
  offer,
  bountyForRun,
  answerHashForRun,
  verifyWrongRun
};
