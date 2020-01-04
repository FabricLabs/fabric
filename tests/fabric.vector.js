'use strict';

const Fabric = require('../');
const assert = require('assert');

describe('@fabric/core/types/vector', function () {
  describe('Vector', function () {
    it('is available from @fabric/core', function () {
      assert.equal(Fabric.Vector instanceof Function, true);
    });

    it('can restore from garbage', async function () {
      let vector = Fabric.Vector.fromObjectString('{ "0": { "type": "Buffer", "data": [0, 0, 0, 0 ] } }');
      assert.equal(vector instanceof Array, true);
      assert.equal(vector[0] instanceof Buffer, true);
      assert.equal(vector[0].toString('hex'), '00000000');
      assert.ok(vector);
    });
  });
});
