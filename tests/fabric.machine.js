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
      assert.strictEqual(sip, 'b8d3ebf4499c51d06d5df1e26973e7d9');
    });

    it('provides the predicted entropy on first slurp with seed', function () {
      const machine = new Machine({ key: { seed: playnet.key.seed } });
      const slurp = machine.slurp();
      assert.ok(slurp);
      assert.strictEqual(slurp.length, 64);
      assert.strictEqual(slurp, 'b8d3ebf4499c51d06d5df1e26973e7d94999d4c8f30407a6ccdc15255a53e22a');
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
      machine.define('SUM_TWO', function () { return 2; });
      machine.script.push('SUM_TWO');
      await machine.start();
      await machine.compute();
      await machine.stop();
      assert.ok(machine.stack.length >= 1);
      assert.strictEqual(machine.stack[machine.stack.length - 1], 2);
    });

    it('can correctly sum three values', async function prove () {
      const machine = new Machine(false);
      machine.define('SUM_THREE', function () { return 4; });
      machine.script.push('SUM_THREE');
      await machine.start();
      await machine.compute();
      await machine.stop();
      assert.ok(machine.stack.length >= 1);
      assert.strictEqual(machine.stack[machine.stack.length - 1], 4);
    });
  });
});
