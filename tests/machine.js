'use strict';

const Fabric = require('../');

const assert = require('assert');
const expect = require('chai').expect;

const BN = require('bn.js');

describe('Machine', function () {
  it('should correctly compute a known instruction', async function () {
    let machine = new Fabric.Machine();

    machine.define('OP_TEST', function (input) {
      return true;
    });

    machine.script.push(new Fabric.Vector('OP_TEST'));

    await machine.compute();

    assert.equal(machine['@data'], true);
    assert.equal(machine.clock, 1);
  });
  
  it('should compute simple sums', async function () {
    let machine = new Fabric.Machine();

    machine.use('ADD', function (state) {
      return this.add(state);
    });

    machine.script.push(new Fabric.Vector('1')._sign());
    machine.script.push(new Fabric.Vector('1'));
    machine.script.push(new Fabric.Vector('ADD'));

    let result = await machine.compute();

    assert.equal(machine['@data'], 2);
    assert.equal(machine.clock, 1);
  });
});
