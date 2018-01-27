'use strict';

import Fabric from '../';

const assert = require('assert');
const expect = require('chai').expect;

const crypto = require('crypto');

const genesis = {
  name: 'genesis',
  entropy: '00000000'
};

const zero = 'd9a3ed614805ffbc3c6e62cceae3339046f6bb7135b7d00fe9956bee65871f00';
const state = '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a';

// test our own expectations.  best of luck.
// @consensus:
// @quest:
// > *Warning:* ahead lies death. # must be attributed to "Game Master"
//
describe('Chain', function () {
  it('should expose a constructor', function () {
    assert.equal(typeof Fabric.Chain, 'function');
  });

  it('can generate a chain of 0 length', async function () {
    let chain = new Fabric.Chain();

    await chain.storage.open();

    try {
      let output = await chain.compute();
      assert.equal(output.blocks.length, 0);
      assert.equal(output['@id'], state);
    } catch (E) {
      console.error(E);
      assert.fail(E);
    }

    await chain.storage.close();
  });
  
  it('can generate a chain with a genesis block', async function () {
    let chain = new Fabric.Chain();
    let block = new Fabric.Block(genesis)._sign();

    await chain.storage.open();

    try {
      await chain.append(block);
      assert.equal(block['@id'], zero);
      assert.equal(1, chain.blocks.length);
      assert.equal(JSON.stringify(chain['@data']), JSON.stringify([block['@id']]));
      assert.equal(chain.genesis, zero);
    } catch (E) {
      console.error(E);
      assert.fail(E);
    }

    let output = await chain.compute();

    await chain.storage.close();
  });

  it('can generate a chain of non-zero length', async function () {
    var chain = new Fabric.Chain();
    var genesis = new Fabric.Block(genesis);

    await chain.storage.open();

    try {
      await genesis.compute();
      await chain.append(genesis);

      var num = 3;
      var last = genesis['@id'];
      for (var i = 0; i < num; i++) {
        var block = new Fabric.Block({
          parent: last,
          entropy: crypto.randomBytes(8).toString('hex')
        });
        block.compute();
        last = block['@id'];
        await chain.append(block);
      }

      var output = await chain.compute();
      
      assert.equal(output.blocks.length, 4);
    } catch (E) {
      console.error(E);
      assert.fail(E);
    }

    //await chain._flush();
    await chain.storage.close();
  });
  
  it('can replay after shutting down', async function () {
    try {
      let chain = new Fabric.Chain();
      let block = new Fabric.Block(genesis)._sign();
      
      console.log('genesis block:', block);
      
      await chain.storage.open();

      await chain.append(block);

      let oldest = await chain.compute();
      
      await chain.storage.close();
      
      let replay = new Fabric.Chain();
      
      await replay.storage.open();
      await replay._load();
  
      let output = await replay.compute();
      
      await replay.storage.close();
      
      console.log('oldest chain:', oldest);
      console.log('output chain:', output);
      
      assert.equal(output['@id'], oldest['@id']);
      
      
    } catch (E) {
      console.error(E);
      assert.fail(E);
    }

  
  });
});
