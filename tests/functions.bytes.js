'use strict';

const assert = require('assert');
const { toUint8Strict, toUint8Flexible, randomUnit } = require('../functions/bytes');

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

  it('toUint8Flexible accepts iterables of bytes and rejects bad elements', function () {
    const genOk = function * () { yield 1; yield 2; };
    assert.deepStrictEqual([...toUint8Flexible(genOk(), 10)], [1, 2]);
    const genBad = function * () { yield 300; };
    assert.throws(() => toUint8Flexible(genBad(), 10), /expected integer byte/);
    assert.throws(() => toUint8Flexible(genOk(), 1), /exceeds maxLength/);
  });

  it('toUint8Flexible rejects unsupported types', function () {
    assert.throws(() => toUint8Flexible({}), /expected Buffer/);
  });

  it('toUint8Flexible returns a Uint8Array view for Buffer under maxLength', function () {
    const b = Buffer.from([9, 10, 11]);
    const u = toUint8Flexible(b, 100);
    assert.ok(u instanceof Uint8Array);
    assert.deepStrictEqual([...u], [9, 10, 11]);
    assert.strictEqual(u.buffer, b.buffer);
    assert.strictEqual(u.byteOffset, b.byteOffset);
    assert.strictEqual(u.byteLength, b.byteLength);
  });

  it('randomUnit returns a float in [0, 1)', function () {
    const samples = new Set();
    for (let i = 0; i < 8; i++) {
      const r = randomUnit();
      assert.strictEqual(typeof r, 'number');
      assert.ok(r >= 0 && r < 1);
      samples.add(r);
    }
    assert.ok(samples.size > 1);
  });

  it('randomUnit maps the extreme 32-bit draws without reaching 1', function () {
    // Random sampling cannot police the upper bound: the all-ones draw shows up
    // about once in 4.3e9 calls, so an off-by-one divisor (2**32-1, which returns
    // exactly 1.0) or a bitwise truncation would pass the loop above forever.
    // Pin both endpoints deterministically instead.
    const crypto = require('crypto');
    const real = crypto.randomBytes;
    try {
      const draw = (hex) => {
        crypto.randomBytes = () => Buffer.from(hex, 'hex');
        return randomUnit();
      };
      assert.strictEqual(draw('00000000'), 0);
      assert.strictEqual(draw('80000000'), 0.5);
      const top = draw('ffffffff');
      assert.ok(top < 1, `all-ones draw must stay below 1, got ${top}`);
      assert.strictEqual(top, 4294967295 / 4294967296);
    } finally {
      crypto.randomBytes = real;
    }
    // Sanity: the stub is fully removed.
    assert.strictEqual(crypto.randomBytes.length, real.length);
    assert.ok(randomUnit() >= 0);
  });
});
