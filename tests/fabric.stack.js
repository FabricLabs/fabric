'use strict';

const Fabric = require('../');

const assert = require('assert');
const expect = require('chai').expect;

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

    xit('can instantiate from a serialized state', function () {
      // TODO: migrate to Stack
      let stack = Fabric.Vector.fromObjectString('{ "0": { "type": "Buffer", "data": [0, 0, 0, 0 ] } }');
      assert.equal(stack instanceof Array, true);
      assert.equal(stack[0] instanceof Buffer, true);
      assert.equal(stack[0].toString('hex'), '00000000');
      assert.ok(stack);
    });

    xit('can push an element onto the stack', function () {
      let stack = new Fabric.Stack();

      let one = stack.push('foo');
      let two = stack.push('bar');

      assert.equal(one, 1);
      assert.equal(two, 2);
      assert.equal(stack['@data'][0].toString('hex'), samples.output.foo);
      assert.equal(stack['@data'][1].toString('hex'), samples.output.bar);
    });

    xit('mimics JavaScript semantics', function () {
      let stack = new Fabric.Stack();

      stack.push('foo');
      stack.push('bar');

      let last = stack.pop();

      assert.equal(last, 'bar');
    });
  });
});
