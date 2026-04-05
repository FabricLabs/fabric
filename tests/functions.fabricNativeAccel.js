'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const fabricNativeAccel = require('../functions/fabricNativeAccel');
// Resolve from this module so paths stay correct if the test file moves (e.g. tests/ vs tests/functions/).
const modPath = require.resolve('../functions/fabricNativeAccel.js');
const mockAddonPath = require.resolve('../fixtures/native/fabricNativeAccelMockAddon.js');
const badShaAddonPath = require.resolve('../fixtures/native/fabricNativeAccelBadDoubleSha.js');
const throwEmptyAddonPath = require.resolve('../fixtures/native/fabricNativeAccelThrowEmpty.js');

/**
 * Child env for native-accel subprocess tests: drop all inherited FABRIC_* vars
 * (CI / developer shells often set FABRIC_SKIP_NATIVE_ADDON, FABRIC_NATIVE_BECH32, etc.)
 * then apply explicit overrides so behavior matches the test intent.
 *
 * Also strips coverage / inspector hooks (e.g. c8's NODE_OPTIONS) so `node -e` subprocesses
 * load the same modules as a bare Node process — GitHub `report:coverage` inherits those
 * and they can break isolated addon mock runs.
 */
function addonSubprocessEnv (overrides = {}) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) {
    if (k.startsWith('FABRIC_')) delete env[k];
  }
  delete env.NODE_OPTIONS;
  delete env.NODE_V8_COVERAGE;
  delete env.V8_COVERAGE;
  for (const [k, v] of Object.entries(overrides)) {
    if (v == null) delete env[k];
    else env[k] = String(v);
  }
  return env;
}

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
  const out = execFileSync(process.execPath, ['-e', script], {
    encoding: 'utf8',
    env: addonSubprocessEnv()
  });
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

  it('bech32Encode and bech32Decode return null when native bech32 is unavailable', function () {
    assert.strictEqual(fabricNativeAccel.bech32Encode('bc', Buffer.alloc(0), 'bech32'), null);
    assert.strictEqual(fabricNativeAccel.bech32Decode('bc1invalid'), null);
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
    const bad = path.join(os.tmpdir(), `fabric-bad-addon-${Date.now()}.node`);
    fs.writeFileSync(bad, 'not a valid native addon\n');
    try {
      const j = runStatusSubprocess(
        `process.env.FABRIC_NATIVE_DOUBLE_SHA256 = '1'; process.env.FABRIC_ADDON_PATH_STRICT = '1'; process.env.FABRIC_ADDON_PATH = ${JSON.stringify(bad)};`,
        'if (!s.error) process.exit(2);',
        '{ error: s.error }'
      );
      assert.ok(typeof j.error === 'string' && j.error.length > 0);
    } finally {
      try { fs.unlinkSync(bad); } catch { /* ignore */ }
    }
  });

  it('status error stringifies load failures with empty Error.message', function () {
    const j = runStatusSubprocess(
      `process.env.FABRIC_NATIVE_DOUBLE_SHA256 = '1'; process.env.FABRIC_ADDON_PATH_STRICT = '1'; process.env.FABRIC_ADDON_PATH = ${JSON.stringify(throwEmptyAddonPath)};`,
      'if (!s.error) process.exit(2);',
      '{ error: s.error }'
    );
    assert.ok(typeof j.error === 'string' && j.error.length > 0);
  });

  it('mock JS addon satisfies doubleSha256 native path when opted in', function () {
    const script = `
      const m = require(${JSON.stringify(modPath)});
      const crypto = require('crypto');
      const buf = Buffer.from('native-mock-ds256', 'utf8');
      const got = m.doubleSha256Buffer(buf);
      const want = crypto.createHash('sha256').update(crypto.createHash('sha256').update(buf).digest()).digest();
      if (!got.equals(want)) process.exit(2);
      process.stdout.write('ok');
    `;
    execFileSync(process.execPath, ['-e', script], {
      encoding: 'utf8',
      env: addonSubprocessEnv({
        FABRIC_NATIVE_DOUBLE_SHA256: '1',
        FABRIC_ADDON_PATH_STRICT: '1',
        FABRIC_ADDON_PATH: mockAddonPath
      })
    });
  });

  it('falls back to JS when native doubleSha256 returns wrong length', function () {
    const script = `
      const m = require(${JSON.stringify(modPath)});
      const crypto = require('crypto');
      const buf = Buffer.from('bad-len-addon', 'utf8');
      const got = m.doubleSha256Buffer(buf);
      const want = crypto.createHash('sha256').update(crypto.createHash('sha256').update(buf).digest()).digest();
      if (!got.equals(want)) process.exit(2);
      process.stdout.write('ok');
    `;
    execFileSync(process.execPath, ['-e', script], {
      encoding: 'utf8',
      env: addonSubprocessEnv({
        FABRIC_NATIVE_DOUBLE_SHA256: '1',
        FABRIC_ADDON_PATH_STRICT: '1',
        FABRIC_ADDON_PATH: badShaAddonPath
      })
    });
  });

  it('mock JS addon covers native bech32 and segwit wrappers', function () {
    const script = `
      const m = require(${JSON.stringify(modPath)});
      const enc = m.bech32Encode('id', Buffer.from([0, 1, 2]), 'bech32m');
      if (enc == null || typeof enc !== 'string') { console.error('bech32Encode'); process.exit(5); }
      const dec = m.bech32Decode(enc);
      if (dec == null) { console.error('bech32Decode null'); process.exit(2); }
      if (dec.spec !== 'bech32m') { console.error('bech32Decode spec', dec.spec); process.exit(2); }
      const program = Buffer.alloc(20, 3);
      const addr = m.segwitAddrEncode('tb', 0, program);
      if (!addr) { console.error('segwitAddrEncode'); process.exit(3); }
      const back = m.segwitAddrDecode('tb', addr);
      if (!back) { console.error('segwitAddrDecode null'); process.exit(4); }
      if (!back.program.equals(program)) {
        console.error('program mismatch', back.program.length, program.length);
        process.exit(4);
      }
      process.stdout.write('ok');
    `;
    try {
      execFileSync(process.execPath, ['-e', script], {
        encoding: 'utf8',
        env: addonSubprocessEnv({
          FABRIC_NATIVE_BECH32: '1',
          FABRIC_ADDON_PATH_STRICT: '1',
          FABRIC_ADDON_PATH: mockAddonPath
        })
      });
    } catch (err) {
      const stderr = err.stderr != null ? String(err.stderr) : '';
      const status = err.status != null ? err.status : '';
      assert.fail(`subprocess failed (status=${status}) stderr=${stderr} ${err.message || err}`);
    }
  });

  it('bech32Decode returns null when native addon returns null', function () {
    const decodeNullAddon = path.join(os.tmpdir(), `fabric-mock-decode-null-${Date.now()}.js`);
    fs.writeFileSync(
      decodeNullAddon,
      `'use strict';\nconst base = require(${JSON.stringify(mockAddonPath)});\nmodule.exports = Object.assign({}, base, { bech32Decode: () => null });\n`
    );
    try {
      const script = `
        const m = require(${JSON.stringify(modPath)});
        if (m.bech32Decode('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4') !== null) process.exit(2);
      `;
      execFileSync(process.execPath, ['-e', script], {
        encoding: 'utf8',
        env: addonSubprocessEnv({
          FABRIC_NATIVE_BECH32: '1',
          FABRIC_ADDON_PATH_STRICT: '1',
          FABRIC_ADDON_PATH: decodeNullAddon
        })
      });
    } finally {
      try { fs.unlinkSync(decodeNullAddon); } catch { /* ignore */ }
    }
  });

  it('segwitAddrDecode returns null when native addon returns null', function () {
    const segwitNullAddon = path.join(os.tmpdir(), `fabric-mock-segwit-null-${Date.now()}.js`);
    fs.writeFileSync(
      segwitNullAddon,
      `'use strict';\nconst base = require(${JSON.stringify(mockAddonPath)});\nmodule.exports = Object.assign({}, base, { segwitAddrDecode: () => null });\n`
    );
    try {
      const script = `
        const m = require(${JSON.stringify(modPath)});
        if (m.segwitAddrDecode('bc', 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4') !== null) process.exit(2);
      `;
      execFileSync(process.execPath, ['-e', script], {
        encoding: 'utf8',
        env: addonSubprocessEnv({
          FABRIC_NATIVE_BECH32: '1',
          FABRIC_ADDON_PATH_STRICT: '1',
          FABRIC_ADDON_PATH: segwitNullAddon
        })
      });
    } finally {
      try { fs.unlinkSync(segwitNullAddon); } catch { /* ignore */ }
    }
  });
});
