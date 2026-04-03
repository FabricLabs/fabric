'use strict';

const assert = require('assert');
const { toUint8Strict, toUint8Flexible } = require('../functions/bytes');

describe('functions/bytes', function () {
  it('toUint8Strict accepts Buffer and Uint8Array', function () {
    const b = Buffer.from([1, 2, 3]);
    const u = new Uint8Array([4, 5]);
    assert.deepStrictEqual([...toUint8Strict(b)], [1, 2, 3]);
    assert.deepStrictEqual([...toUint8Strict(u)], [4, 5]);
  });

  it('toUint8Strict rejects strings and plain objects', function () {
    assert.throws(() => toUint8Strict('ab'), TypeError);
    assert.throws(() => toUint8Strict({ length: 2, 0: 1, 1: 2 }), TypeError);
    assert.throws(() => toUint8Strict(null), TypeError);
  });

  it('toUint8Flexible accepts array-like number lists', function () {
    assert.deepStrictEqual([...toUint8Flexible([10, 20])], [10, 20]);
  });

  it('toUint8Flexible rejects strings and non-byte array elements', function () {
    assert.throws(() => toUint8Flexible('ab'), /string input/);
    assert.throws(() => toUint8Flexible([0, 300]), /integer byte/);
    assert.throws(() => toUint8Flexible({ length: 2, 0: 1, 1: -1 }), /integer byte/);
  });

  it('toUint8Flexible enforces maxLength for bounded iterables', function () {
    function * gen () {
      yield 1;
      yield 2;
      yield 3;
    }
    assert.throws(() => toUint8Flexible(gen(), 2), /exceeds maxLength/);
  });

  it('toUint8Flexible enforces maxLength for buffers and array-likes', function () {
    assert.throws(() => toUint8Flexible(Buffer.alloc(5), 4), /exceeds maxLength/);
    assert.throws(() => toUint8Flexible(new Uint8Array(5), 4), /exceeds maxLength/);
    const fake = { length: 999999, 0: 0 };
    assert.throws(() => toUint8Flexible(fake, 8), /array-like length/);
  });

  it('toUint8Flexible returns a Uint8Array view for Buffer under maxLength', function () {
    const b = Buffer.from([9, 10, 11]);
    const u = toUint8Flexible(b, 100);
    assert.ok(u instanceof Uint8Array);
    assert.deepStrictEqual([...u], [9, 10, 11]);
  });
});
