'use strict';

const assert = require('assert');
const Hash256 = require('../types/hash256');

const sample = 'Hello, world!';
const fixture = '315f5bdb76d078c43b8ac0064e4a0164612b1fce77c869345bfc94c75894edd3';

describe('@fabric/core/types/hash256', function () {
  describe('Hash256', function () {
    it('is available from @fabric/core', function () {
      assert.equal(Hash256 instanceof Function, true);
    });

    it('can instantiate from sample data', function () {
      const hash256 = new Hash256(sample);
      assert.ok(hash256);
      assert.equal(hash256.value, fixture);
    });
  });
});
