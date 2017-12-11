var assert = require('assert');
var expect = require('chai').expect;

var Fabric = require('../');
var Machine = Fabric.Machine;

describe('Machine', function () {
  it('should correctly compute a known instruction', function () {
    var machine = new Machine();

    machine.use('OP_TEST', function (state) {
      return true;
    });

    machine.stack.push('OP_TEST');

    machine.compute();

    assert.equal(machine['@data'], true);
    assert.equal(machine.clock, 1);
  });
});
