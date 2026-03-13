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

    xit('provides the predicted entropy on first sip', function () {
      const machine = new Machine(false);
      const sip = machine.sip();
      assert.strictEqual(sip.length, 32);
      assert.strictEqual(sip, 'dbfbd0acec55f2f246d41073b00e2a2d');
    });

    xit('provides the predicted entropy on first slurp', function () {
      const machine = new Machine(false);
      const slurp = machine.slurp();
      assert.ok(slurp);
      assert.strictEqual(slurp.length, 64);
      assert.strictEqual(slurp, '18dcf02d135df30d39b87ab503a62c512ffd0ab4aa12dbd84c43b2881b93c41');
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

    xit('can compute a value', async function prove () {
      // TODO: use Fabric itself
      const machine = new Machine(false);
      // TODO: use Fabric instead of Machine
      machine.define('OP_TRUE', OPCODES.OP_TRUE);
      // fabric.push('OP_TRUE');
      machine.script.push('OP_TRUE');
      await machine.start();
      await machine.compute();
      await machine.stop();
      // console.log('machine state:', machine.state);
      // assert.equal(machine.state.id, samples.names.encodedStackWithSingleValidFrame);
      assert.equal(machine.state['@data'][0], true);
    });

    xit('can correctly sum two values', async function prove () {
      const machine = new Machine(false);
      machine.define('OP_ADD', OPCODES.OP_ADD);
      machine.script.push('1');
      machine.script.push('1');
      machine.script.push('OP_ADD');
      await machine.start();
      await machine.compute();
      await machine.stop();
      assert.equal(machine.state['@data'][0], 2);
    });

    xit('can correctly sum three values', async function prove () {
      const machine = new Machine(false);
      machine.define('OP_ADD', OPCODES.OP_ADD);
      machine.script.push('1');
      machine.script.push('1');
      machine.script.push('OP_ADD');
      machine.script.push('2');
      machine.script.push('OP_ADD');
      await machine.start();
      await machine.compute();
      await machine.stop();
      assert.equal(machine.state['@data'][0], 4);
    });
  });
});
