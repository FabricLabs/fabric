var assert = require('assert');
var expect = require('chai').expect;

var genesis = require('../data/fabric');
var message = require('../data/message');

var Fabric = require('../');
var fabric = new Fabric(genesis);

// test our own expectations.  best of luck.
// @consensus:
// @quest:
// > *Warning:* ahead lies death. # must be attributed to "Game Master"
//
describe('Fabric', function() {
  it('should expose a constructor', function() {
    assert(typeof Fabric, 'function');
  });

  it('has the correct, hard-coded genesis seed', function provenance() {
    assert.equal(fabric.root.id, 0); // require a point of origin.
    assert.equal(fabric.root.id, genesis.root.id);
  });

  it('can acknowledge its own existence', function identity() {
    var alice = new Fabric(genesis);
    var bob = new Fabric(genesis);

    alice.peers.push(bob);

    assert.equal(bob.root.id, alice.peers[0].root.id);
  });

  it('can send a message', function broadcast() {

    fabric.broadcast()
  });
});
