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

    it('provides the predicted entropy on first sip', function () {
      const machine = new Machine(false);
      const sip = machine.sip();
      assert.strictEqual(sip.length, 32);
      assert.strictEqual(sip, 'd94f897b198b3e9e9d7583d3aa59a400');
    });

    it('provides the predicted entropy on first slurp', function () {
      const machine = new Machine(false);
      const slurp = machine.slurp();
      assert.ok(slurp);
      assert.strictEqual(slurp.length, 64);
      assert.strictEqual(slurp, 'd94f897b198b3e9e9d7583d3aa59a400009bbce9baee314be74c7b503af7413e');
    });

    it('provides the predicted entropy on first sip with seed', function () {
      const machine = new Machine({ seed: playnet.key.seed });
      const sip = machine.sip();
      assert.strictEqual(sip.length, 32);
      assert.strictEqual(sip, '4e23efa7d67b7fd79228fb21ce279e21');
    });

    it('provides the predicted entropy on first slurp with seed', function () {
      const machine = new Machine({ seed: playnet.key.seed });
      const slurp = machine.slurp();
      assert.ok(slurp);
      assert.strictEqual(slurp.length, 64);
      assert.strictEqual(slurp, '4e23efa7d67b7fd79228fb21ce279e21fb9d6a0a0c965df3c1169b9b30e326e1');
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
      // console.log('machine state:', machine.state);
      // assert.equal(machine.state.id, samples.names.encodedStackWithSingleValidFrame);
      assert.equal(machine.state['@data'][0], true);
    });

    it('can correctly sum two values', async function prove () {
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

    it('can correctly sum three values', async function prove () {
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
