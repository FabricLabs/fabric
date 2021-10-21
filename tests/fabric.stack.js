'use strict';

const Fabric = require('../');

const assert = require('assert');
const expect = require('chai').expect;

describe('@fabric/core/types/app', function () {
  describe('Stack', function () {
    it('is available from @fabric/core', function () {
      assert.equal(Fabric.Stack instanceof Function, true);
    });

    it('can restore state from an Array-like object', function () {
      let stack = new Fabric.Stack(['test']);
      // console.log('stack:', stack);
      // console.log('stack.render():', stack.render());

      // TODO: move to constants, verify
      assert.equal(stack.id, 'dc0422e42d8bac213c34031a1af2a99223fbad851887d1dd03f11d144f0cfe75');
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
