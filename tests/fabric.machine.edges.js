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

  it('primitives.opcodes allow-list rejects define / load / compute outside the set', async function () {
    const machine = new Machine({ deterministic: true, allowedOpcodes: ['OP_TRUE'] });
    assert.throws(() => machine.define('OP_EVIL', () => 1), /allow-list/);
    machine.define('OP_TRUE', () => true);

    const blocked = await machine.runProgram({
      language: 'fabric-opcodes',
      steps: ['OP_EVIL']
    });
    assert.strictEqual(blocked.ok, false);
    assert.match(blocked.error || '', /allow-list/);

    const ok = await machine.runProgram({
      language: 'fabric-opcodes',
      steps: ['OP_TRUE']
    });
    assert.strictEqual(ok.ok, true, ok.error);
    assert.strictEqual(ok.tip, true);
  });

  it('applyGenesisOpcodes + loadProgram opts.genesis enforce ARC primitives.opcodes', async function () {
    const machine = new Machine({ deterministic: true });
    machine.applyGenesisOpcodes({
      primitives: { opcodes: ['OP_TRUE'] }
    });
    machine.define('OP_TRUE', () => true);
    const bad = await machine.runProgram({
      language: 'fabric-opcodes',
      steps: ['OP_FALSE']
    });
    assert.strictEqual(bad.ok, false);

    const machine2 = new Machine({ deterministic: true });
    machine2.define('OP_TRUE', () => true);
    const viaOpts = await machine2.runProgram(
      { language: 'fabric-opcodes', steps: ['OP_TRUE'] },
      undefined,
      { genesis: { primitives: { opcodes: ['OP_TRUE'] } } }
    );
    assert.strictEqual(viaOpts.ok, true, viaOpts.error);

    const machine3 = new Machine({ deterministic: true });
    const missingDef = await machine3.runProgram(
      { language: 'fabric-opcodes', steps: ['OP_TRUE'] },
      undefined,
      { genesis: { primitives: { opcodes: ['OP_TRUE'] } } }
    );
    assert.strictEqual(missingDef.ok, false);
    assert.match(missingDef.error || '', /not defined|allow-list/i);
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
