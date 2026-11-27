'use strict';

const assert = require('assert');
const path = require('path');
const Machine = require('../types/machine');
const Program = require('../types/program');
const {
  runExecutionProgram,
  executionProgramFromHub
} = require('../functions/executionProgramRunner');

const hangWorker = path.join(__dirname, 'fixtures', 'programIsolateHang.js');
const envWorker = path.join(__dirname, 'fixtures', 'programIsolateEnv.js');

describe('program isolate', function () {
  this.timeout(10000);

  it('does not copy FABRIC_XPRV into the child environment', function () {
    const previous = process.env.FABRIC_XPRV;
    process.env.FABRIC_XPRV = 'do-not-inherit';
    try {
      const env = Program.isolateChildEnv();
      assert.strictEqual(Object.prototype.hasOwnProperty.call(env, 'FABRIC_XPRV'), false);
      assert.strictEqual(env.FABRIC_PROGRAM_ISOLATE, '1');
      const spawned = Program.spawnIsolate({ ping: true }, {
        isolateWorker: envWorker,
        isolateTimeoutMs: 2000
      });
      assert.strictEqual(spawned.timedOut, false, spawned.error);
      assert.ok(spawned.parsed, spawned.error);
      assert.strictEqual(spawned.parsed.sawXprv, false);
      assert.strictEqual(spawned.parsed.isolate, '1');
    } finally {
      if (previous == null) delete process.env.FABRIC_XPRV;
      else process.env.FABRIC_XPRV = previous;
    }
  });

  it('kills a worker that never exits', function () {
    const started = Date.now();
    const r = runExecutionProgram({
      version: 1,
      steps: [{ op: 'Push', value: 1 }]
    }, {
      isolateWorker: hangWorker,
      isolateTimeoutMs: 200
    });
    assert.strictEqual(r.ok, false);
    assert.match(r.error || '', /isolate timed out/);
    assert.ok(Date.now() - started < 5000);
  });

  it('does not call a parent define() for an isolated fabric-opcodes run', async function () {
    let leaked = false;
    const machine = new Machine({ deterministic: true });
    machine.define('OP_EVIL', () => {
      leaked = true;
      return 1;
    });
    const result = await machine.runProgram({
      language: 'fabric-opcodes',
      steps: ['OP_EVIL']
    }, undefined, { isolate: true });
    assert.strictEqual(leaked, false);
    assert.strictEqual(result.ok, false);
    assert.match(result.error || '', /opcode not defined/);
  });

  it('keeps the in-process programHash for a fabric-execution run', function () {
    const program = { version: 1, steps: [{ op: 'Push', value: 7 }, { op: 'Dup' }] };
    const expected = executionProgramFromHub(program).programHash;
    const isolated = runExecutionProgram(program);
    const local = runExecutionProgram(program, { inProcess: true });
    assert.strictEqual(isolated.ok, true, isolated.error);
    assert.strictEqual(local.ok, true, local.error);
    assert.strictEqual(isolated.programHash, expected);
    assert.strictEqual(isolated.runCommitmentHex, local.runCommitmentHex);
    assert.deepStrictEqual(isolated.stack, local.stack);
  });
});
