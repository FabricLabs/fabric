'use strict';

const Fabric = require('../');
const assert = require('assert');
const State = require('../types/state');

const SAMPLE_DATA = {
  content: 'Hello, world!',
  target: '/messages'
};

describe('@fabric/core/types/state', function () {
  describe('State', function () {
    it('is available from @fabric/core', function () {
      assert.equal(Fabric.State instanceof Function, true);
    });

    it('provides a stable "@id" attribute for equivalent input', function () {
      const a = new Fabric.State(SAMPLE_DATA);
      const b = new Fabric.State(SAMPLE_DATA);
      assert.ok(a.id);
      assert.strictEqual(a.id, b.id);
    });

    it('can serialize to a sane element', function () {
      const state = new Fabric.State(SAMPLE_DATA);
      const serialized = state.serialize(SAMPLE_DATA);
      assert.ok(state);
      assert.ok(serialized);
      assert.strictEqual(serialized.type, 'Buffer');
      assert.ok(Array.isArray(serialized.data));
      const decoded = Buffer.from(serialized.data).toString('utf8');
      assert.deepStrictEqual(JSON.parse(decoded), SAMPLE_DATA);
    });

    it('can deserialize from a string into a plain object', function () {
      const state = State.fromString(JSON.stringify(SAMPLE_DATA));
      assert.ok(state);
      assert.deepStrictEqual(state, SAMPLE_DATA);
    });
  });
});
