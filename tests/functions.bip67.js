'use strict';

const assert = require('assert');
const { sortPubkeysBip67, comparePubkeysBip67 } = require('../functions/bip67');
const { parseCompressedPubkeysSorted } = require('../functions/contractTaproot');

const KEY_LOW = '02' + '11'.repeat(32);
const KEY_HIGH = '03' + '11'.repeat(32);

describe('@fabric/core/functions/bip67', function () {
  it('sorts compressed pubkeys lexicographically', function () {
    const sorted = sortPubkeysBip67([KEY_HIGH, KEY_LOW]);
    assert.strictEqual(sorted[0].toString('hex'), KEY_LOW);
    assert.strictEqual(sorted[1].toString('hex'), KEY_HIGH);
    assert.ok(comparePubkeysBip67(KEY_LOW, KEY_HIGH) < 0);
  });

  it('accepts Buffer keys and does not mutate the input array', function () {
    const a = Buffer.from(KEY_HIGH, 'hex');
    const b = Buffer.from(KEY_LOW, 'hex');
    const input = [a, b];
    const sorted = sortPubkeysBip67(input);
    assert.strictEqual(input[0], a);
    assert.ok(sorted[0].equals(b));
  });

  it('is the sort used by contractTaproot.parseCompressedPubkeysSorted', function () {
    const keys = [KEY_HIGH, KEY_LOW, KEY_HIGH];
    const parsed = parseCompressedPubkeysSorted(keys);
    assert.strictEqual(parsed.length, 2);
    assert.strictEqual(parsed[0].toString('hex'), KEY_LOW);
    assert.strictEqual(parsed[1].toString('hex'), KEY_HIGH);
  });

  it('rejects uncompressed or truncated keys', function () {
    assert.throws(() => sortPubkeysBip67(['04' + '11'.repeat(64)]), /compressed/);
    assert.throws(() => sortPubkeysBip67(['02aabb']), /compressed/);
    assert.throws(() => sortPubkeysBip67(null), /array/);
    assert.throws(() => sortPubkeysBip67([1]), /Buffer, Uint8Array, or hex/);
  });

  it('accepts 0x-prefixed hex and Uint8Array keys', function () {
    const u8 = Uint8Array.from(Buffer.from(KEY_HIGH, 'hex'));
    const sorted = sortPubkeysBip67(['0x' + KEY_LOW, u8]);
    assert.strictEqual(sorted[0].toString('hex'), KEY_LOW);
    assert.strictEqual(sorted[1].toString('hex'), KEY_HIGH);
  });
});
