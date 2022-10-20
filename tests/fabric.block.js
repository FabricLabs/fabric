'use strict';

const Block = require('../types/block');
const assert = require('assert');

describe('@fabric/core/types/block', function () {
  describe('Block', function () {
    xit('is available from @fabric/core', function () {
      assert.strictEqual(Block instanceof Function, true);
    });

    it('can smoothly create a new block', function () {
      const block = new Block();
      assert.strictEqual(block.id, 'a5b08f19adfd2918e354af8c11e1b4efd963b5f5a525900d63a01cd2fd28176f');
    });

    it('can smoothly create a known block', function () {
      const block = new Block({ debug: true, input: 'Hello, world.' });
      assert.strictEqual(block.id, '915b0d50a7bda25ccee15aa2bd6c51a1e7bba3d3ffa599897127c01a72e58104');
    });

    it('can be constructed from a list of transactions', function () {
      const block = new Block({
        debug: true,
        transactions: {
          'dcfe2ae42b3dd7538f1bada55374beff198e446537b8d001bb0a0bc68cf0d2b9': {
            type: 'Transaction',
            input: 'Hello, world.'
          }
        }
      });

      assert.strictEqual(block.id, 'fe83ca7e172b82201f255a3ff34bf73b6721a95078685fe1d184bf4a6c7a20fb');
    });

    it('generates the correct merkle tree', function () {
      const block = new Block({ debug: true, input: 'Hello, world.' });
      assert.strictEqual(block.id, '915b0d50a7bda25ccee15aa2bd6c51a1e7bba3d3ffa599897127c01a72e58104');
      assert.ok(block.tree);
      assert.ok(block.tree.root);
      assert.strictEqual(block.tree.root.toString('hex'), '');
    });

    xit('can sign a known block', function () {
      const block = new Block({ debug: true, input: 'Hello, world.' });
      assert.strictEqual(block.id, '915b0d50a7bda25ccee15aa2bd6c51a1e7bba3d3ffa599897127c01a72e58104');
    });

    xit('can smoothly create a new block from data', function () {
      let block = new Block({
        name: 'fun'
      });
      assert.strictEqual(block.id, '4636f10c63fef5a1e0e5206358afff993e212a032fba091cf282c9bf3d35da85');
    });
  });
});
