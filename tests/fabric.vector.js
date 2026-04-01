'use strict';

const Vector = require('../types/vector');
const Machine = require('../types/machine');
const assert = require('assert');

describe('@fabric/core/types/vector', function () {
  describe('Vector', function () {
    it('is a function', function () {
      assert.strictEqual(Vector instanceof Function, true);
    });

    it('extends EventEmitter', function () {
      const EventEmitter = require('events');
      const v = new Vector();
      assert.ok(v instanceof EventEmitter);
    });
  });

  describe('Machine.fromObjectString', function () {
    it('can restore buffer array from JSON object string', async function () {
      const vector = Machine.fromObjectString('{ "0": { "type": "Buffer", "data": [0, 0, 0, 0] } }');
      assert.strictEqual(vector instanceof Array, true);
      assert.strictEqual(vector[0] instanceof Buffer, true);
      assert.strictEqual(vector[0].toString('hex'), '00000000');
      assert.ok(vector);
    });
  });
});
