'use strict';

const assert = require('assert');
const { sha256 } = require('@noble/hashes/sha2.js');
const accel = require('../functions/fabricNativeAccel');
const Hash256 = require('../types/hash256');

describe('fabricNativeAccel', function () {
  it('doubleSha256Hex matches noble double SHA256', function () {
    const buf = Buffer.from('wire body', 'utf8');
    const first = sha256(new Uint8Array(buf));
    const second = sha256(first);
    const expected = Buffer.from(second).toString('hex');
    assert.strictEqual(accel.doubleSha256Hex(buf), expected);
  });

  it('Hash256.doubleDigest delegates through accel (native or JS)', function () {
    const buf = Buffer.from('{"x":1}', 'utf8');
    assert.strictEqual(Hash256.doubleDigest(buf), accel.doubleSha256Hex(buf));
  });

  it('status() reports structure', function () {
    const s = accel.status();
    assert.strictEqual(typeof s.available, 'boolean');
    assert.ok(Array.isArray(s.methods));
  });
});
