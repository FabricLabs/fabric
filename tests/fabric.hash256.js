'use strict';

const assert = require('assert');
const Hash256 = require('../types/hash256');

const sample = 'Hello, world!';
const fixture = '315f5bdb76d078c43b8ac0064e4a0164612b1fce77c869345bfc94c75894edd3';

describe('@fabric/core/types/hash256', function () {
  describe('Hash256', function () {
    it('is available from @fabric/core', function () {
      assert.strictEqual(Hash256 instanceof Function, true);
    });

    it('can instantiate with no data', function () {
      const hash256 = new Hash256();
      assert.ok(hash256);
      assert.ok(hash256.value);
      assert.strictEqual(hash256.value.length, 64);
    });

    it('can instantiate from sample data', function () {
      const hash256 = new Hash256(sample);
      assert.ok(hash256);
      assert.ok(hash256.value);
      assert.strictEqual(hash256.value.length, 64);
      assert.strictEqual(hash256.value, fixture);
    });

    it('provides a static digest() method', function () {
      const digest = Hash256.digest(sample);
      assert.ok(digest);
      assert.strictEqual(digest.length, 64);
      assert.strictEqual(digest, fixture);
    });

    it('throws an error when static digest() is called on a non-string', function () {
      assert.throws(() => Hash256.digest({ sample }));
    });

    it('can reverse a known hash', function () {
      assert.throws(() => Hash256.digest({ sample }));

      const digest = Hash256.digest(sample);
      const reversed = (new Hash256(sample)).reverse();

      assert.strictEqual(digest, fixture);
      assert.strictEqual(reversed, 'd3ed9458c794fc5b3469c877ce1f2b6164014a4e06c08a3bc478d076db5b5f31');
    });
  });
});
