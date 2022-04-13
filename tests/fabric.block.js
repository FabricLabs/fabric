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
      assert.strictEqual(block.id, 'a5b08f19adfd2918e354af8c11e1b4efd963b5f5a525900d63a01cd2fd28176f');
    });

    xit('can sign a known block', function () {
      const block = new Block({ debug: true, input: 'Hello, world.' });
      assert.strictEqual(block.id, 'a5b08f19adfd2918e354af8c11e1b4efd963b5f5a525900d63a01cd2fd28176f');
    });

    xit('can smoothly create a new block from data', function () {
      const block = new Block({
        name: 'fun'
      });
      assert.strictEqual(block.id, '4636f10c63fef5a1e0e5206358afff993e212a032fba091cf282c9bf3d35da85');
    });
  });
});
