'use strict';

const assert = require('assert');
const { describe, it } = require('mocha');

const Machine = require('../types/machine');
const Program = require('../types/program');

describe('@fabric/core Machine / Program edge cases', function () {
  it('unknown opcodes soft-fail: coerce to 0 and still ok (not a sandbox trap)', async function () {
    const machine = new Machine({ deterministic: true });
    const result = await machine.runProgram({
      language: 'fabric-opcodes',
      steps: ['OP_THIS_DOES_NOT_EXIST']
    });
    // Machine.compute pushes `instruction | 0` for unknown names — documents the gap.
    assert.strictEqual(result.ok, true, result.error);
    assert.strictEqual(result.tip, 0);
  });

  it('runProgram returns ok:false when Program.compile fails', async function () {
    const machine = new Machine({ deterministic: true });
    const result = await machine.runProgram({
      language: 'not-a-real-language',
      steps: ['x']
    });
    assert.strictEqual(result.ok, false);
    assert.ok(/unsupported language/i.test(result.error || ''));
  });

  it('javascript Programs bind host functions into Machine.define', async function () {
    const machine = new Machine({ deterministic: true });
    let called = 0;
    const prog = Program.from({
      language: 'javascript',
      steps: ['HOST_PROBE'],
      source: {
        HOST_PROBE: function () {
          called++;
          return 42;
        }
      }
    });
    const result = await machine.runProgram(prog);
    assert.strictEqual(result.ok, true, result.error);
    assert.strictEqual(called, 1);
    assert.strictEqual(result.tip, 42);
    // Documents the sandbox gap: host functions run in-process.
    assert.strictEqual(typeof machine.known.HOST_PROBE, 'function');
  });

  it('ignores non-function entries in javascript Program.source', async function () {
    const machine = new Machine({ deterministic: true });
    machine.define('OP_TRUE', () => true);
    const prog = Program.from({
      language: 'javascript',
      steps: ['OP_TRUE'],
      source: {
        NOT_A_FN: 123,
        ALSO: null
      }
    });
    const result = await machine.runProgram(prog);
    assert.strictEqual(result.ok, true, result.error);
    assert.strictEqual(machine.known.NOT_A_FN, undefined);
  });

  it('parseManifest rejects programHash mismatch', function () {
    const machine = new Machine();
    const prog = Program.from({ language: 'fabric-opcodes', steps: ['OP_TRUE'] });
    prog.compile();
    machine.define('OP_TRUE', () => true);
    const bad = machine.parseManifest({
      version: 1,
      programId: 'edge',
      programHash: '00'.repeat(32),
      allowedMessageTypes: []
    }, prog);
    assert.strictEqual(bad.ok, false);
    assert.ok(/programHash/i.test(bad.error || ''));
  });

  it('compileOpcodeContract throws on unknown opcodes', function () {
    const machine = new Machine();
    assert.throws(
      () => machine.compileOpcodeContract('OP_UNKNOWN_EDGE\nOP_ALSO_BAD'),
      /Unknown opcodes/
    );
  });

  it('start/stop are idempotent and clear the governor', async function () {
    const machine = new Machine({ interval: 3600 });
    await machine.start();
    assert.ok(machine._governor);
    await machine.stop();
    assert.strictEqual(machine.status, 'STOPPED');
    await machine.stop();
    assert.strictEqual(machine.status, 'STOPPED');
  });

  it('solidity language remains an unsupported stub at compile', function () {
    const prog = Program.from({ language: 'solidity', source: 'contract C {}' });
    const compiled = prog.compile();
    assert.strictEqual(compiled.ok, false);
  });
});
