var assert = require('assert');
var expect = require('chai').expect;

var Fabric = require('../lib/fabric');

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

  it('can add two numbers', function () {
    var fabric = new Fabric();

    fabric.use('ADD', function (state) {
      var op = this.stack.pop();
      var a = this.stack.pop();
      var b = this.stack.pop();
      return parseInt(a) + parseInt(b);
    });

    fabric.stack.push('1');
    fabric.stack.push('1');
    fabric.stack.push('ADD');

    fabric.compute();

    assert.equal(fabric['@data'], 2);
    assert.equal(fabric.clock, 1);
  });
});
