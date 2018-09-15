'use strict';

const Fabric = require('../');

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

    try {
      let output = await chain.compute();
      assert.equal(chain.blocks.length, 0);
      assert.equal(chain['@id'], state);
    } catch (E) {
      console.error(E);
      assert.fail(E);
    }
  });

  it('can generate a chain with a genesis block', async function () {
    let chain = new Fabric.Chain();

    try {
      let block = new Fabric.Block(genesis)._sign();
      await chain.append(block);
      let output = await chain.compute();
      assert.equal(block['@id'], zero);
      assert.equal(chain.blocks.length, 1);
      assert.equal(JSON.stringify(chain['@data']), JSON.stringify([block['@id']]));
      assert.equal(chain.genesis, zero);
    } catch (E) {
      console.error(E);
      assert.fail(E);
    }
  });

  it('can generate a chain of non-zero length', async function () {
    let chain = new Fabric.Chain();
    let start = new Fabric.Block(genesis);

    try {
      await chain.append(start);

      var num = 3;
      var last = genesis['@id'];
      for (var i = 0; i < num; i++) {
        var block = new Fabric.Block({
          parent: last,
          entropy: crypto.randomBytes(8).toString('hex')
        })._sign();
        last = block['@id'];
        await chain.append(block);
      }

      let output = await chain.compute();
      
      assert.equal(chain.blocks.length, 4);
    } catch (E) {
      console.error(E);
      assert.fail(E);
    }
  });
  
  it('can replay after shutting down', async function () {
    try {
      let chain = new Fabric.Chain();
      let block = new Fabric.Block(genesis)._sign();

      await chain.storage.open();
      await chain.append(block);
      let oldest = await chain.compute();

      await chain.storage.close();

      let replay = new Fabric.Chain();
      await replay.storage.open();
      await replay._load();
      let output = await replay.compute();

      await replay.storage.close();

      assert.equal(output['@id'], oldest['@id']);
    } catch (E) {
      console.error(E);
      assert.fail(E);
    }
  });
});
