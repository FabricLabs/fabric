'use strict';

const Fabric = require('../');

const assert = require('assert');

describe('@fabric/core/types/stack', function () {
  describe('Stack', function () {
    it('is available from @fabric/core', function () {
      assert.equal(Fabric.Stack instanceof Function, true);
    });

    it('can restore state from an Array-like object', function () {
      let stack = new Fabric.Stack(['test']);
      // console.log('stack:', stack);
      // console.log('stack.render():', stack.render());

      // TODO: move to constants, verify
      assert.equal(stack.id, 'a5b08f19adfd2918e354af8c11e1b4efd963b5f5a525900d63a01cd2fd28176f');
    });

    it('can instantiate from a serialized state', function () {
      const json = JSON.stringify(['foo', 'bar']);
      const parsed = JSON.parse(json);
      const stack = new Fabric.Stack(parsed);
      assert.ok(stack);
      assert.strictEqual(stack['@data'].length, 2);
    });

    it('can push an element onto the stack', function () {
      const stack = new Fabric.Stack();
      const one = stack.push('foo');
      const two = stack.push('bar');
      assert.strictEqual(one, 1);
      assert.strictEqual(two, 2);
      assert.strictEqual(stack.size, 2);
    });

    it('mimics JavaScript semantics', function () {
      const stack = new Fabric.Stack();
      stack.push('foo');
      stack.push('bar');
      const last = stack.pop();
      assert.ok(last);
      assert.strictEqual(stack['@data'].length, 1);
    });
  });
});
