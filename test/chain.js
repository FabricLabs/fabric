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

var zero = 'd9a3ed614805ffbc3c6e62cceae3339046f6bb7135b7d00fe9956bee65871f00';
var state = '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a';

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
    
    await chain._flush();
    await chain.storage.close();
    
    assert.equal(output.blocks.length, 0);
    assert.equal(output['@id'], state);
  });
  
  it('can generate a chain with a genesis block', async function () {
    var chain = new Chain();
    var block = new Block(genesis);

    block._sign();

    assert.equal(block['@id'], zero);
    
    await chain.append(block);
    
    var output = chain.compute();

    assert.equal(1, chain.blocks.length);
    assert.equal(JSON.stringify(chain['@data']), JSON.stringify([block['@id']]));
    assert.equal(chain.genesis, zero);

    await chain._flush();
    await chain.storage.close();
  });

  it('can generate a chain of non-zero length', async function () {
    var chain = new Chain();
    var genesis = new Block(genesis);

    genesis.compute();
    await chain.append(genesis);

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

    await chain._flush();
    await chain.storage.close();
    
    assert.equal(output.blocks.length, 4);
  });
  
  it('can replay after shutting down', async function () {
    var chain = new Chain();
    var block = new Block(genesis);

    block.compute();

    await chain.append(block);

    var output = chain.compute();

    await chain.storage.close();
    
    var replay = new Chain();
    
    await replay._load();
    
    var original = replay.compute();

    await replay.store.close();
    
    assert.equal(original['@data'][0], zero);
    
  });
});
