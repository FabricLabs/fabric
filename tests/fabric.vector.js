'use strict';

const Vector = require('../types/vector');
const assert = require('assert');

describe('@fabric/core/types/vector', function () {
  describe('Vector', function () {
    it('is a function', function () {
      assert.strictEqual(Vector instanceof Function, true);
    });

    it('can restore from garbage', async function () {
      const vector = Vector.fromObjectString('{ "0": { "type": "Buffer", "data": [0, 0, 0, 0] } }');
      assert.strictEqual(vector instanceof Array, true);
      assert.strictEqual(vector[0] instanceof Buffer, true);
      assert.strictEqual(vector[0].toString('hex'), '00000000');
      assert.ok(vector);
    });
  });
});
