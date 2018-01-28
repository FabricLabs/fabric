'use strict';

import Fabric from '../';

const assert = require('assert');
const expect = require('chai').expect;

describe('Stack', function () {
  it('should correctly compute a known instruction', async function () {
    var fabric = new Fabric();

    fabric.use('OP_TEST', function (state) {
      return true;
    });

    fabric.stack.push('OP_TEST');

    fabric.compute();

    await fabric.chain.storage.close();

    assert.equal(fabric['@data'], true);
    assert.equal(fabric.clock, 1);
  });

  it('can add two numbers', async function () {
    var fabric = new Fabric();

    fabric.use('ADD', function (state) {
      var op = this.stack.pop();
      var a = this.stack.pop();
      var b = this.stack.pop();
      return parseInt(a) + parseInt(b);
    });

    fabric.stack.push('1');
    fabric.stack.push('1');
    fabric.stack.push('ADD');

    fabric.compute();

    await fabric.chain.storage.close();

    assert.equal(fabric['@data'], 2);
    assert.equal(fabric.clock, 1);
  });

  it('can add two other numbers', async function () {
    var fabric = new Fabric();

    fabric.use('ADD', function (state) {
      var op = this.stack.pop();
      var a = this.stack.pop();
      var b = this.stack.pop();
      return parseInt(a) + parseInt(b);
    });

    fabric.stack.push('123');
    fabric.stack.push('456');
    fabric.stack.push('ADD');

    fabric.compute();
    
    await fabric.chain.storage.close();

    assert.equal(fabric['@data'], 579);
    assert.equal(fabric.clock, 1);
  });
});
