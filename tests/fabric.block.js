'use strict';

const Fabric = require('../');
const assert = require('assert');

describe('@fabric/core/types/block', function () {
  describe('Block', function () {
    xit('is available from @fabric/core', function () {
      assert.equal(Fabric.Block instanceof Function, true);
    });

    xit('can smoothly create a new block', function () {
      let block = new Fabric.Block();
      console.log('block', block);
      assert.equal(block.id, '2d4e630ea2e7ddf740ca09f5d483fa21cc14117164da01f6db75b973e71191cd');
    });

    xit('can smoothly create a new block from data', function () {
      let block = new Fabric.Block({
        name: 'fun'
      });
      assert.equal(block.id, '4636f10c63fef5a1e0e5206358afff993e212a032fba091cf282c9bf3d35da85');
    });
  });
});
