'use strict';

const assert = require('assert');
const crypto = require('crypto');
const path = require('path');
const { execFileSync } = require('child_process');
const fabricNativeAccel = require('../functions/fabricNativeAccel');

function doubleSha256Js (buf) {
  return crypto.createHash('sha256').update(crypto.createHash('sha256').update(buf).digest()).digest();
}

describe('functions/fabricNativeAccel', function () {
  it('exports stable metadata', function () {
    assert.deepStrictEqual([...fabricNativeAccel.SUPPORTED_ADDON_EXPORTS], ['doubleSha256']);
  });

  it('status() reports opt-in flag and shape', function () {
    const s = fabricNativeAccel.status();
    assert.strictEqual(typeof s.available, 'boolean');
    assert.ok(Array.isArray(s.methods));
    assert.strictEqual(s.nativeDoubleSha256OptIn, false);
    assert.ok(Object.prototype.hasOwnProperty.call(s, 'path'));
  });

  it('doubleSha256Buffer throws on non-Buffer', function () {
    assert.throws(() => fabricNativeAccel.doubleSha256Buffer('x'), /expects Buffer/);
  });

  it('doubleSha256Buffer matches Node crypto double-SHA256', function () {
    const buf = Buffer.from('fabric-native-accel-test', 'utf8');
    const got = fabricNativeAccel.doubleSha256Buffer(buf);
    assert.ok(Buffer.isBuffer(got));
    assert.strictEqual(got.length, 32);
    assert.ok(got.equals(doubleSha256Js(buf)));
  });

  it('doubleSha256Hex is hex of doubleSha256Buffer', function () {
    const buf = Buffer.alloc(0);
    const hex = fabricNativeAccel.doubleSha256Hex(buf);
    assert.strictEqual(hex, fabricNativeAccel.doubleSha256Buffer(buf).toString('hex'));
    assert.strictEqual(hex, doubleSha256Js(buf).toString('hex'));
  });

  it('status in fresh subprocess with FABRIC_NATIVE_DOUBLE_SHA256=true reports opt-in', function () {
    const modPath = path.join(__dirname, '..', 'functions', 'fabricNativeAccel.js');
    const script = `
      process.env.FABRIC_NATIVE_DOUBLE_SHA256 = 'true';
      const m = require(${JSON.stringify(modPath)});
      const s = m.status();
      if (s.nativeDoubleSha256OptIn !== true) process.exit(1);
      process.stdout.write(JSON.stringify({ optIn: s.nativeDoubleSha256OptIn, available: s.available }));
    `;
    const out = execFileSync(process.execPath, ['-e', script], { encoding: 'utf8' });
    const j = JSON.parse(out);
    assert.strictEqual(j.optIn, true);
    assert.strictEqual(typeof j.available, 'boolean');
  });
});
