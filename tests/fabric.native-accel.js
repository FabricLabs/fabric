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
    assert.strictEqual(typeof s.nativeDoubleSha256OptIn, 'boolean');
    assert.ok('path' in s);
  });

  it('doubleSha256Buffer requires a Buffer', function () {
    assert.throws(
      () => accel.doubleSha256Buffer('not a buffer'),
      /doubleSha256Buffer expects Buffer/
    );
  });

  it('doubleSha256Buffer returns 32-byte Buffer', function () {
    const buf = Buffer.from([0, 1, 2, 3]);
    const out = accel.doubleSha256Buffer(buf);
    assert.ok(Buffer.isBuffer(out));
    assert.strictEqual(out.length, 32);
  });

  it('exports SUPPORTED_ADDON_EXPORTS', function () {
    assert.ok(accel.SUPPORTED_ADDON_EXPORTS);
    assert.ok(accel.SUPPORTED_ADDON_EXPORTS.includes('doubleSha256'));
  });
});
