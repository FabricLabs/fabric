var assert = require('assert');
var expect = require('chai').expect;

var crypto = require('crypto');

var Block = require('../lib/block');
var Chain = require('../lib/chain');
var Ledger = require('../lib/ledger');

var block = new Block(); // linked list
//var chain = new Chain(); // secured tree
var ledger = new Ledger(); // simple list

//var Machine = require('../lib/machine');

var genesis = {
  name: 'genesis',
  entropy: '00000000'
};

var state = '739c0f6067efff96f6f8f66accc1cf85c9b6cc63e8e0a16f4dead4e471a48b79';

// test our own expectations.  best of luck.
// @consensus:
// @quest:
// > *Warning:* ahead lies death. # must be attributed to "Game Master"
//
describe('Chain', function () {
  it('should expose a constructor', function () {
    assert.equal(typeof Chain, 'function');
  });
  
  it('can generate a chain of 0 length', async function () {
    var chain = new Chain();
    var output = chain.compute();
    
    await chain.store.close();
    
    assert.equal(output.blocks.length, 0);
  });
  
  it('can generate a chain with a genesis block', async function () {
    var chain = new Chain();
    var block = new Block(genesis);

    block.compute();
    
    assert.equal(block['@id'], state);
    
    await chain.append(block);
    
    var output = chain.compute();
    
    await chain.store.close();

    assert.equal(1, chain.blocks.length);
    assert.equal(chain.genesis, state);
  });

  it('can generate a chain of non-zero length', async function () {
    var chain = new Chain();
    var genesis = new Block(genesis);
    
    genesis.compute();
    chain.append(genesis);

    var num = 3;
    var last = genesis['@id'];
    for (var i = 0; i < num; i++) {
      var block = new Block({
        parent: last,
        entropy: crypto.randomBytes(8).toString('hex')
      });
      block.compute();
      last = block['@id'];
      await chain.append(block);
    }
    
    var output = chain.compute();

    await chain.store.close();
    
    assert.equal(output.blocks.length, 4);
  });
});
