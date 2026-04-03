'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const fabricNativeAccel = require('../functions/fabricNativeAccel');
const modPath = path.join(__dirname, '..', 'functions', 'fabricNativeAccel.js');

function doubleSha256Js (buf) {
  return crypto.createHash('sha256').update(crypto.createHash('sha256').update(buf).digest()).digest();
}

function runStatusSubprocess (envLines, predicateLine, outputLine) {
  const script = `
    ${envLines}
    const m = require(${JSON.stringify(modPath)});
    const s = m.status();
    ${predicateLine}
    process.stdout.write(JSON.stringify(${outputLine}));
  `;
  const out = execFileSync(process.execPath, ['-e', script], { encoding: 'utf8' });
  return JSON.parse(out);
}

describe('functions/fabricNativeAccel', function () {
  let prevNativeBech32;
  let prevNativeDoubleSha256;

  beforeEach(function () {
    prevNativeBech32 = process.env.FABRIC_NATIVE_BECH32;
    prevNativeDoubleSha256 = process.env.FABRIC_NATIVE_DOUBLE_SHA256;
    delete process.env.FABRIC_NATIVE_BECH32;
    delete process.env.FABRIC_NATIVE_DOUBLE_SHA256;
  });

  afterEach(function () {
    if (prevNativeBech32 === undefined) delete process.env.FABRIC_NATIVE_BECH32;
    else process.env.FABRIC_NATIVE_BECH32 = prevNativeBech32;
    if (prevNativeDoubleSha256 === undefined) delete process.env.FABRIC_NATIVE_DOUBLE_SHA256;
    else process.env.FABRIC_NATIVE_DOUBLE_SHA256 = prevNativeDoubleSha256;
  });

  it('exports stable metadata', function () {
    assert.deepStrictEqual([...fabricNativeAccel.SUPPORTED_ADDON_EXPORTS], [
      'doubleSha256',
      'bech32Encode',
      'bech32Decode',
      'segwitAddrEncode',
      'segwitAddrDecode'
    ]);
  });

  it('status() reports opt-in flag and shape', function () {
    const s = fabricNativeAccel.status();
    assert.strictEqual(typeof s.available, 'boolean');
    assert.ok(Array.isArray(s.methods));
    assert.strictEqual(s.nativeDoubleSha256OptIn, false);
    assert.strictEqual(s.nativeBech32OptIn, false);
    assert.ok(Object.prototype.hasOwnProperty.call(s, 'path'));
  });

  it('nativeBech32Enabled reflects FABRIC_NATIVE_BECH32', function () {
    assert.strictEqual(fabricNativeAccel.nativeBech32Enabled(), false);
    process.env.FABRIC_NATIVE_BECH32 = 'true';
    assert.strictEqual(fabricNativeAccel.nativeBech32Enabled(), true);
    process.env.FABRIC_NATIVE_BECH32 = '0';
    assert.strictEqual(fabricNativeAccel.nativeBech32Enabled(), false);
  });

  it('isNativeBech32Callable is false without opt-in', function () {
    assert.strictEqual(fabricNativeAccel.isNativeBech32Callable(), false);
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

  it('status in fresh subprocess with FABRIC_NATIVE_BECH32=1 reports bech32 opt-in', function () {
    const j = runStatusSubprocess(
      "process.env.FABRIC_NATIVE_BECH32 = '1'; process.env.FABRIC_SKIP_NATIVE_ADDON = '1';",
      'if (s.nativeBech32OptIn !== true) process.exit(1);',
      '{ nativeBech32OptIn: s.nativeBech32OptIn }'
    );
    assert.strictEqual(j.nativeBech32OptIn, true);
  });

  it('segwitAddrEncode and segwitAddrDecode return null when native bech32 is off', function () {
    assert.strictEqual(fabricNativeAccel.segwitAddrEncode('bc', 0, Buffer.alloc(0)), null);
    assert.strictEqual(
      fabricNativeAccel.segwitAddrDecode('bc', 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'),
      null
    );
  });

  it('bech32Encode and bech32Decode throw when native bech32 is unavailable', function () {
    assert.throws(
      () => fabricNativeAccel.bech32Encode('bc', Buffer.alloc(0), 'bech32'),
      /native bech32 not available/
    );
    assert.throws(
      () => fabricNativeAccel.bech32Decode('bc1invalid'),
      /native bech32 not available/
    );
  });

  it('status in fresh subprocess with FABRIC_NATIVE_DOUBLE_SHA256=true reports opt-in', function () {
    const j = runStatusSubprocess(
      "process.env.FABRIC_NATIVE_DOUBLE_SHA256 = 'true'; process.env.FABRIC_SKIP_NATIVE_ADDON = '1';",
      'if (s.nativeDoubleSha256OptIn !== true) process.exit(1);',
      '{ optIn: s.nativeDoubleSha256OptIn, available: s.available }'
    );
    assert.strictEqual(j.optIn, true);
    assert.strictEqual(typeof j.available, 'boolean');
  });

  it('status surfaces addon load failure when FABRIC_ADDON_PATH is unloadable', function () {
    const realAddon = path.join(__dirname, '..', 'build', 'Release', 'fabric.node');
    if (fs.existsSync(realAddon)) {
      this.skip();
    }
    const bad = path.join(os.tmpdir(), `fabric-bad-addon-${Date.now()}.node`);
    fs.writeFileSync(bad, 'not a valid native addon\n');
    try {
      const j = runStatusSubprocess(
        `process.env.FABRIC_NATIVE_DOUBLE_SHA256 = '1'; process.env.FABRIC_ADDON_PATH = ${JSON.stringify(bad)};`,
        'if (!s.error) process.exit(2);',
        '{ error: s.error }'
      );
      assert.ok(typeof j.error === 'string' && j.error.length > 0);
    } finally {
      try { fs.unlinkSync(bad); } catch { /* ignore */ }
    }
  });
});
