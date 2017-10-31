var assert = require('assert');
var expect = require('chai').expect;

var genesis = require('../data/fabric');
var message = require('../data/message');

var Fabric = require('../lib/fabric');
var Instruction = require('../lib/instruction');

var state = '326849acb46552a14fc1a904c1787609550635d0af1727ca874089b258854d6a';

//var Machine = require('../lib/machine');

// test our own expectations.  best of luck.
// @consensus:
// @quest:
// > *Warning:* ahead lies death. # must be attributed to "Game Master"
//
describe('Fabric', function () {
  it('should expose a constructor', function () {
    assert.equal(typeof Fabric, 'function');
  });

  it('has the correct, hard-coded genesis seed', async function provenance () {
    var fabric = new Fabric(genesis);
    //assert.equal(fabric.root.id, 0); // require a point of origin.
    fabric._sign();

    assert.equal(fabric['@id'], state);
  });
  
  it('can compute a value', function prove () {
    var fabric = new Fabric();
    
    fabric.use('OP_TRUE', function compute () {
      return 1;
    })

    /*var instruction = new Instruction({
      inputs: ['OP_TRUE'],
      outputs: [1]
    });*/
    
    fabric.stack.push('OP_TRUE');

    var outcome = fabric.compute();

    assert.equal(outcome['@data'], 1);
  });

  it('can acknowledge its own existence', function identity (done) {
    var alice = new Fabric(genesis);
    alice.on('auth', function validate (identity) {
      assert.equal(alice.identity.key.public, identity.key.public);
      return done();
    });
    
    alice.compute();
    
    alice.start();
  });

  it('can register peers', async function identity () {
    var alice = new Fabric(0);
    var bob = new Fabric(1);
    
    alice.compute();
    bob.compute();
    
    await alice.connect(bob['@id']);

    var list = Object.keys(alice.peers).map(function(id) {
      return alice.peers[id]['@id'];
    });

    assert.equal(bob['@id'], list[0]);
  });

  it('can send a message', function broadcast () {
    var fabric = new Fabric(genesis);
    fabric.broadcast();
  });

  /*it('can build a world', function fabricate () {
    var Challenge = require('../lib/challenge');
    var challenge = new Challenge();
    
    console.log(challenge);
    
    var world = new Machine([ challenge ]);
    
    world.on('ready', function() {
      console.log('thing is ready');
    });

    world.step();

    assert.equal('done', world.state);
  });
  
  it('can produce a fountain', function spawn (ready) {
    var Fountain = require('../lib/fountain');
    var fountain = new Fountain();
    fountain.on('gush', ready);
    fountain.compute();
  });*/
  
  it('can store and retrieve some data', function datastore () {
    var Datastore = require('../lib/datastore');
    var datastore = new Datastore(); // robust datastore
    
    var str = 'Hello, world!';

    datastore.put('foo', str);
    assert.equal(datastore.get('foo'), str);
  });

});
