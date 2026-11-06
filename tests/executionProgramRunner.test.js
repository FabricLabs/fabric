'use strict';

const assert = require('assert');
const Machine = require('../types/machine');
const Program = require('../types/program');
const {
  runExecutionProgram,
  executionProgramFromHub
} = require('../functions/executionProgramRunner');
const { buildExecutionRunOutput } = require('../functions/executionRunBridge');

describe('executionProgramRunner / Machine fabric-execution', function () {
  it('runs Push/Dup/Pop/ADD on Machine stack', function () {
    const r = runExecutionProgram({
      version: 1,
      steps: [
        { op: 'Push', value: 2 },
        { op: 'PUSH', value: 3 },
        { op: 'ADD' },
        { op: 'Dup' }
      ]
    });
    assert.strictEqual(r.ok, true, r.error);
    assert.strictEqual(r.stack[0], 5);
    assert.strictEqual(r.stack[1], 5);
    assert.ok(r.programHash);
    assert.ok(r.runCommitmentHex);
    assert.ok(r.program);
  });

  it('content-addresses via Program.programHash', function () {
    const program = { version: 1, steps: [{ op: 'Push', value: 1 }] };
    const a = executionProgramFromHub(program).programHash;
    const b = executionProgramFromHub(program).programHash;
    assert.strictEqual(a, b);
    assert.strictEqual(runExecutionProgram(program).programHash, a);
  });

  it('Machine.runProgram delegates fabric-execution', async function () {
    const machine = new Machine({ deterministic: true });
    const out = await machine.runProgram({
      language: 'fabric-execution',
      source: {
        version: 1,
        steps: [{ op: 'Push', value: { hi: true } }]
      }
    });
    assert.strictEqual(out.ok, true, out.error);
    assert.deepStrictEqual(out.tip, { hi: true });
    assert.ok(out.runCommitmentHex);
  });

  it('rejects Ping FabricOpcode when resolver marks it', function () {
    const r = runExecutionProgram({
      steps: [{ op: 'FabricOpcode', fabricType: 'Ping' }]
    }, {
      resolveFabricEntry () {
        return { name: 'Ping', opcodeDec: 0x01 };
      }
    });
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /Ping/);
  });

  it('enforces Machine / genesis opcode allow-list on FabricOpcode steps', function () {
    const program = {
      version: 1,
      steps: [{ op: 'FabricOpcode', fabricType: 'ChatMessage' }]
    };
    const denied = runExecutionProgram(program, {
      allowedOpcodes: ['P2P_CHAT_MESSAGE'],
      resolveFabricEntry () {
        return { name: 'ChatMessage', opcodeDec: 0x67 };
      }
    });
    assert.strictEqual(denied.ok, false);
    assert.match(denied.error, /allow-list/i);

    const allowed = runExecutionProgram(program, {
      allowedOpcodes: ['ChatMessage'],
      resolveFabricEntry () {
        return { name: 'ChatMessage', opcodeDec: 0x67 };
      }
    });
    assert.strictEqual(allowed.ok, true, allowed.error);

    const fromGenesis = runExecutionProgram(program, {
      genesis: { primitives: { opcodes: ['OtherOnly'] } },
      resolveFabricEntry () {
        return { name: 'ChatMessage', opcodeDec: 0x67 };
      }
    });
    assert.strictEqual(fromGenesis.ok, false);
    assert.match(fromGenesis.error, /allow-list/i);
  });

  it('Program.compile fabric-execution requires steps', function () {
    const bad = Program.from({ language: 'fabric-execution', source: {} }).compile();
    assert.strictEqual(bad.ok, false);
  });

  it('runExecutionProgram feeds buildExecutionRunOutput for distributed run sealing', function () {
    const r = runExecutionProgram({
      version: 1,
      steps: [{ op: 'Push', value: 42 }, { op: 'Dup' }]
    });
    assert.strictEqual(r.ok, true, r.error);
    const contractId = 'a'.repeat(64);
    const out = buildExecutionRunOutput({
      contractId,
      programHash: r.programHash,
      result: r
    });
    assert.strictEqual(out.programHash, r.programHash);
    assert.ok(out.runCommitmentHex);
    assert.ok(out.fabricProgramRunCommitmentHex);
    assert.strictEqual(out.fabricProgramRun.programHash, r.programHash);
    assert.strictEqual(out.fabricProgramRun.runCommitmentHex, out.fabricProgramRunCommitmentHex);
  });
});