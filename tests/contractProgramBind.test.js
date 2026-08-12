'use strict';

const assert = require('assert');
const Key = require('../types/key');
const Machine = require('../types/machine');
const Program = require('../types/program');
const {
  resolveSpend,
  buildWithdrawalRequest,
  validateWithdrawalRequest,
  bindProgramRunToTip,
  programMetaFromTip,
  requiresProgramBind
} = require('../functions/contractSpend');
const {
  assertMachineRunMatches,
  validateProgramRunBinding
} = require('../functions/contractProgramBind');

describe('contractProgramBind / Machine ↔ redeemable withdrawals', function () {
  const blockHash = 'ab'.repeat(32);

  async function runOpcodeProgram () {
    const prog = Program.from({
      language: 'fabric-opcodes',
      steps: ['OP_TRUE']
    });
    prog.compile();
    const machine = new Machine({ deterministic: true });
    machine.define('OP_TRUE', () => true);
    const run = await machine.runProgram(prog);
    assert.strictEqual(run.ok, true);
    assert.ok(run.runCommitmentHex);
    const match = assertMachineRunMatches({ program: prog, run });
    assert.strictEqual(match.ok, true);
    assert.strictEqual(match.runCommitmentHex, run.runCommitmentHex);
    return { prog, run, match };
  }

  it('Machine runCommitmentHex is stable and binds into tip without changing P2TR', async function () {
    const a = new Key();
    const { prog, run, match } = await runOpcodeProgram();
    const again = await (async () => {
      const m = new Machine({ deterministic: true });
      m.define('OP_TRUE', () => true);
      return m.runProgram(prog);
    })();
    assert.strictEqual(again.runCommitmentHex, run.runCommitmentHex);

    const tip0 = {
      contractId: 'c'.repeat(64),
      clock: 1,
      stateDigest: '11'.repeat(32),
      bitcoinBlockHash: blockHash,
      content: {
        signers: [a.pubkey],
        members: [a.pubkey],
        threshold: 1
      }
    };
    const tip1 = bindProgramRunToTip(tip0, {
      programHash: match.programHash,
      runCommitmentHex: match.runCommitmentHex,
      programId: prog.programId,
      clock: tip0.clock
    });
    assert.ok(tip1.content.program);
    assert.strictEqual(programMetaFromTip(tip1).programHash, match.programHash);

    const spend0 = resolveSpend({
      genesis: {
        members: { signers: [a.pubkey], threshold: 1 },
        spendPolicy: {
          validators: [a.pubkey],
          threshold: 1,
          publisher: a.pubkey,
          csvBlocks: 144
        }
      },
      tip: tip0,
      overrides: { network: 'regtest' }
    });
    const spend1 = resolveSpend({
      genesis: {
        members: { signers: [a.pubkey], threshold: 1 },
        spendPolicy: {
          validators: [a.pubkey],
          threshold: 1,
          publisher: a.pubkey,
          csvBlocks: 144
        }
      },
      tip: tip1,
      overrides: { network: 'regtest' }
    });
    assert.strictEqual(spend1.address, spend0.address);
  });

  it('withdrawal requires matching program digests when tip seals a run', async function () {
    const a = new Key();
    const { match } = await runOpcodeProgram();
    let tip = {
      contractId: 'd'.repeat(64),
      clock: 2,
      stateDigest: '22'.repeat(32),
      bitcoinBlockHash: blockHash,
      content: { signers: [a.pubkey], threshold: 1 }
    };
    tip = bindProgramRunToTip(tip, {
      programHash: match.programHash,
      runCommitmentHex: match.runCommitmentHex
    });

    const missing = validateWithdrawalRequest({
      stateDigest: tip.stateDigest,
      bitcoinBlockHash: tip.bitcoinBlockHash,
      destinationAddress: 'bcrt1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3l9y0'
    }, tip);
    assert.strictEqual(missing.ok, false);
    assert.match(missing.error, /programHash|runCommitment/i);

    const stale = validateWithdrawalRequest({
      stateDigest: tip.stateDigest,
      bitcoinBlockHash: tip.bitcoinBlockHash,
      destinationAddress: 'bcrt1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3l9y0',
      programHash: match.programHash,
      runCommitmentHex: 'ff'.repeat(32)
    }, tip);
    assert.strictEqual(stale.ok, false);
    assert.match(stale.error, /runCommitmentHex/);

    const okReq = buildWithdrawalRequest({
      tip,
      contractId: tip.contractId,
      destinationAddress: 'bcrt1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3l9y0',
      feeSats: 500
    });
    assert.strictEqual(okReq.programHash, match.programHash);
    assert.strictEqual(okReq.runCommitmentHex, match.runCommitmentHex);
    assert.strictEqual(validateWithdrawalRequest(okReq, tip).ok, true);
  });

  it('genesis with fabric.program interface requires tip-sealed run', function () {
    assert.strictEqual(requiresProgramBind({
      interfaces: ['arc.core', 'fabric.program'],
      primitives: { opcodes: [] }
    }), true);
    assert.strictEqual(requiresProgramBind({
      primitives: { opcodes: ['OP_TRUE'] }
    }), true);
    assert.strictEqual(requiresProgramBind({
      spendPolicy: { requireProgramRun: true }
    }), true);
    assert.strictEqual(requiresProgramBind({ name: 'plain' }), false);

    const check = validateProgramRunBinding({
      object: {
        stateDigest: '11'.repeat(32),
        bitcoinBlockHash: blockHash,
        destinationAddress: 'bcrt1q'
      },
      tip: { stateDigest: '11'.repeat(32), bitcoinBlockHash: blockHash, content: {} },
      genesis: { interfaces: ['fabric.program'] }
    });
    assert.strictEqual(check.ok, false);
    assert.match(check.error, /tip\.content\.program/);
  });
});
