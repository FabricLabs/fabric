'use strict';

const assert = require('assert');
const Machine = require('../types/machine');
const Program = require('../types/program');
const {
  runExecutionProgram,
  executionProgramFromHub
} = require('../functions/executionProgramRunner');

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
        throw new Error('Ping is a transport keepalive, not an Execution program opcode');
      }
    });
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /Ping/);
  });

  it('Program.compile fabric-execution requires steps', function () {
    const bad = Program.from({ language: 'fabric-execution', source: {} }).compile();
    assert.strictEqual(bad.ok, false);
  });
});
