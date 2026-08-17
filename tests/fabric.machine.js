'use strict';

const assert = require('assert');
const playnet = require('../settings/playnet');
const OPCODES = require('../assets/opcodes');
const Machine = require('../types/machine');

describe('@fabric/core/types/machine', function () {
  describe('Machine', function () {
    it('is available from @fabric/core', function () {
      assert.equal(Machine instanceof Function, true);
    });

    it('provides entropy on first sip', function () {
      const machine = new Machine(false);
      const sip = machine.sip();
      assert.ok(typeof sip === 'string');
      assert.ok(sip.length > 0);
    });

    it('provides entropy on first slurp', function () {
      const machine = new Machine(false);
      const slurp = machine.slurp();
      assert.ok(slurp);
      assert.ok(typeof slurp === 'string');
      assert.ok(slurp.length > 0);
    });

    it('provides the predicted entropy on first sip with seed', function () {
      const machine = new Machine({ key: { seed: playnet.key.seed } });
      const sip = machine.sip();
      assert.strictEqual(sip.length, 32);
      // Constructor consumes one 128-bit sip into `entropy`; this is the second sip from
      // Key’s deterministic bit stream (`fabric/key/bitgen/v1` + pubkeyhash-derived seed).
      assert.strictEqual(sip, '88b27944aebe8fad98c5ba8bcdf8189d');
    });

    it('provides the predicted entropy on first slurp with seed', function () {
      const machine = new Machine({ key: { seed: playnet.key.seed } });
      const slurp = machine.slurp();
      assert.ok(slurp);
      assert.strictEqual(slurp.length, 64);
      assert.strictEqual(slurp, '88b27944aebe8fad98c5ba8bcdf8189dadd9e35f2156c1c1024be43573b57ba5');
    });

    it('can compute a value', async function prove () {
      // TODO: use Fabric itself
      const machine = new Machine(false);
      // TODO: use Fabric instead of Machine
      machine.define('OP_TRUE', OPCODES.OP_TRUE);
      // fabric.push('OP_TRUE');
      machine.script.push('OP_TRUE');
      await machine.start();
      await machine.compute();
      await machine.stop();
      assert.ok(machine.stack.length >= 1);
    });

    it('can correctly sum two values', async function prove () {
      const machine = new Machine(false);
      machine.define('PUSH_2', function () { return 2; });
      machine.define('PUSH_3', function () { return 3; });
      machine.define('SUM_TWO', function () {
        const b = machine.stack.pop();
        const a = machine.stack.pop();
        return a + b;
      });
      machine.script.push('PUSH_2', 'PUSH_3', 'SUM_TWO');
      await machine.start();
      await machine.compute();
      await machine.stop();
      assert.strictEqual(machine.stack[machine.stack.length - 1], 5);
    });

    it('can correctly sum three values', async function prove () {
      const machine = new Machine(false);
      machine.define('PUSH_1', function () { return 1; });
      machine.define('PUSH_2', function () { return 2; });
      machine.define('PUSH_3', function () { return 3; });
      machine.define('SUM_THREE', function () {
        const c = machine.stack.pop();
        const b = machine.stack.pop();
        const a = machine.stack.pop();
        return a + b + c;
      });
      machine.script.push('PUSH_1', 'PUSH_2', 'PUSH_3', 'SUM_THREE');
      await machine.start();
      await machine.compute();
      await machine.stop();
      assert.strictEqual(machine.stack[machine.stack.length - 1], 6);
    });

    it('compileOpcodeContract accepts newline-delimited opcode bodies', function () {
      const machine = new Machine(false);
      const lines = machine.compileOpcodeContract('OP_DUP\nOP_HASH160\nP2P_FLUSH_CHAIN');
      assert.deepStrictEqual(lines, ['OP_DUP', 'OP_HASH160', 'P2P_FLUSH_CHAIN']);
    });

    it('compileOpcodeContract rejects unknown opcode symbols', function () {
      const machine = new Machine(false);
      assert.throws(() => machine.compileOpcodeContract('OP_TRUE\nOP_NOT_REAL'), /Unknown opcodes/);
    });
  });
});

const {
  normalizeOpcodeAllowList,
  opcodesFromGenesis,
  assertStepsAllowed
} = require('../functions/opcodeAllowList');

describe('opcodeAllowList', function () {
  it('normalizes and dedupes', function () {
    assert.deepStrictEqual(
      normalizeOpcodeAllowList([' OP_TRUE ', 'OP_TRUE', '', 'OP_ADD']),
      ['OP_TRUE', 'OP_ADD']
    );
  });

  it('opcodesFromGenesis prefers primitives.opcodes', function () {
    assert.deepStrictEqual(
      opcodesFromGenesis({
        primitives: { opcodes: ['OP_A'] },
        opcodes: ['OP_B']
      }),
      ['OP_A']
    );
    assert.deepStrictEqual(opcodesFromGenesis({ opcodes: ['OP_B'] }), ['OP_B']);
    assert.deepStrictEqual(opcodesFromGenesis({}), []);
  });

  it('assertStepsAllowed fails closed', function () {
    assert.strictEqual(assertStepsAllowed(['OP_TRUE'], ['OP_TRUE']).ok, true);
    const bad = assertStepsAllowed(['OP_TRUE'], ['OP_TRUE', 'OP_EVIL']);
    assert.strictEqual(bad.ok, false);
    assert.deepStrictEqual(bad.unknown, ['OP_EVIL']);
  });
});
