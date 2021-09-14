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
      assert.strictEqual(block.id, 'b9d8bce32d234014b3f45b37ee432b445fbdad036487ced2b5926b14aaa41683');
    });

    it('can smoothly create a known block', function () {
      const block = new Block({ debug: true, input: 'Hello, world.' });
      assert.strictEqual(block.id, '6d2deb1d439472428e7cdeed4ee8e7c708502cfdc037122139d1e9898f0b6b68');
    });

    xit('can smoothly create a new block from data', function () {
      let block = new Block({
        name: 'fun'
      });
      assert.strictEqual(block.id, '4636f10c63fef5a1e0e5206358afff993e212a032fba091cf282c9bf3d35da85');
    });
  });
});
