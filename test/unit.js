var assert = require('assert');
var expect = require('chai').expect;

var Fabric = require('../');
var fabric = new Fabric({});

// test our own expectations.  best of luck.
// @consensus:
// @quest:
// > *Warning:* ahead lies death. # must be attributed to "Game Master"
//
describe('Fabric', function () {
  it('should expose a constructor', function () {
    assert(typeof Fabric, 'function');
  });

  it('has the correct, hard-coded genesis seed', function provenance () {
    assert.equal(fabric.id, 0); // require a point of origin.
  });
});
