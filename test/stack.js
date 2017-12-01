var assert = require('assert');
var expect = require('chai').expect;

var Fabric = require('../');

describe('Fabric.stack', function () {
  it('should correctly compute a known instruction', function () {
    var fabric = new Fabric();

    fabric.use('OP_TEST', function (state) {
      return true;
    });

    fabric.stack.push('OP_TEST');

    fabric.compute();

    assert.equal(fabric['@data'], true);
    assert.equal(fabric.clock, 1);
  });
});
