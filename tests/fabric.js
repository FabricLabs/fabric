'use strict';

const Fabric = require('../');

const assert = require('assert');
const expect = require('chai').expect;

const genesis = require('../data/fabric');
const message = require('../data/message');

const Canvas = require('../lib/fabric');
const Instruction = require('../lib/instruction');

const state = require('../data/fabric');

//var Machine = require('../lib/machine');

// test our own expectations.  best of luck.
// @consensus:
// @quest:
describe('Fabric', function () {
  it('should expose a constructor', function () {
    assert.equal(typeof Canvas, 'function');
  });

  it('generates the correct, hard-coded genesis seed', async function provenance () {
    let seed = new Fabric.Vector(genesis['@data'])._sign();
    assert.equal(seed['@id'], genesis['@id']);
  });

  it('can compute a value', async function prove () {
    let fabric = new Fabric();

    fabric.use('OP_TRUE', function compute (input) {
      return 1;
    });

    fabric.push('OP_TRUE');
    let outcome = await fabric.compute();
    assert.equal(fabric['@data'], 1);

    await fabric.chain.storage.close();
  });

  it('can acknowledge its own existence', function identity (done) {
    let main = async function () {
      let alice = new Fabric(genesis);

      alice.on('auth', async function validate (identity) {
        assert.equal(alice.identity.key.public, identity.key.public);
        await alice.stop();
        return done();
      });

      alice.compute();
      await alice.start();
    }

    main();
  });

  /*/it('can register peers', async function identity () {
    var alice = new Fabric();
    var bob = new Fabric();
    
    alice.compute();
    bob.compute();
    
    console.log('before connect...');
    await alice.connect(bob['@id']);
    console.log('after connect...');

    alice.compute();
    bob.compute();

    var list = Object.keys(alice.peers).map(function(id) {
      return alice.peers[id]['@id'];
    });
    
    console.log('list:', list);
    
    await alice.chain.storage.close();
    await bob.chain.storage.close();

    assert.equal(bob['@id'], list[0]);
  }); /**/

  it('can send a message', async function broadcast () {
    var fabric = new Fabric(genesis);
    await fabric.chain.storage.close();
    assert.ok(fabric.broadcast());
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
  
  it('can store and retrieve some data', async function datastore () {
    var Datastore = require('../lib/datastore');
    var datastore = new Datastore(); // robust datastore
    
    var str = 'Hello, world!';

    await datastore.put('foo', str);
    
    assert.equal(datastore.get('foo'), str);

  });

});
