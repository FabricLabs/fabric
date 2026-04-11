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
const testVariantAddonPath = require.resolve('../fixtures/native/fabricNativeAccelTestVariantAddon.js');
const throwStringAddonPath = require.resolve('../fixtures/native/fabricNativeAccelThrowStringAddon.js');

function resetFabricNativeAccelModule () {
  delete require.cache[require.resolve('../functions/fabricNativeAccel.js')];
}

/**
 * Fresh {@link fabricNativeAccel} instance (new module scope) with temporary env.
 */
function withFabricNativeAccelFresh (envPairs, fn) {
  const saved = {};
  for (const k of Object.keys(envPairs)) {
    saved[k] = process.env[k];
    const v = envPairs[k];
    if (v == null || v === '') delete process.env[k];
    else process.env[k] = String(v);
  }
  resetFabricNativeAccelModule();
  try {
    return fn(require('../functions/fabricNativeAccel.js'));
  } finally {
    for (const k of Object.keys(envPairs)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    resetFabricNativeAccelModule();
    require('../functions/fabricNativeAccel.js');
  }
}

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

  it('bad double-sha addon stub exports are callable in-process (codecov fixture)', function () {
    const a = require(badShaAddonPath);
    assert.ok(Buffer.isBuffer(a.doubleSha256(Buffer.alloc(0))));
    assert.strictEqual(a.bech32Encode(), '');
    assert.strictEqual(a.bech32Decode(), null);
    assert.strictEqual(a.segwitAddrEncode(), null);
    assert.strictEqual(a.segwitAddrDecode(), null);
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

  it('in-process: status reports error when addon load throws a non-Error', function () {
    withFabricNativeAccelFresh({
      FABRIC_NATIVE_DOUBLE_SHA256: '1',
      FABRIC_ADDON_PATH_STRICT: '1',
      FABRIC_ADDON_PATH: throwStringAddonPath
    }, (m) => {
      const s = m.status();
      assert.ok(typeof s.error === 'string' && s.error.length > 0);
    });
  });

  it('in-process: status reports error for empty Error.message addon load', function () {
    withFabricNativeAccelFresh({
      FABRIC_NATIVE_DOUBLE_SHA256: '1',
      FABRIC_ADDON_PATH_STRICT: '1',
      FABRIC_ADDON_PATH: throwEmptyAddonPath
    }, (m) => {
      const s = m.status();
      assert.ok(typeof s.error === 'string' && s.error.length > 0);
    });
  });

  it('in-process: bech32Encode accepts Uint8Array words via mock addon', function () {
    withFabricNativeAccelFresh({
      FABRIC_NATIVE_BECH32: '1',
      FABRIC_ADDON_PATH_STRICT: '1',
      FABRIC_ADDON_PATH: mockAddonPath,
      FABRIC_NATIVE_TEST_ADDON: ''
    }, (m) => {
      const enc = m.bech32Encode('id', new Uint8Array([0, 1, 2]), 'bech32m');
      assert.ok(typeof enc === 'string' && enc.length > 0);
    });
  });

  it('in-process: bech32Encode rejects unknown spec values', function () {
    withFabricNativeAccelFresh({
      FABRIC_NATIVE_BECH32: '1',
      FABRIC_ADDON_PATH_STRICT: '1',
      FABRIC_ADDON_PATH: mockAddonPath,
      FABRIC_NATIVE_TEST_ADDON: ''
    }, (m) => {
      assert.strictEqual(m.bech32Encode('id', Buffer.from([0, 1, 2]), 'bad-spec'), null);
    });
  });

  it('in-process: bech32Decode returns null for non-string input', function () {
    withFabricNativeAccelFresh({
      FABRIC_NATIVE_BECH32: '1',
      FABRIC_ADDON_PATH_STRICT: '1',
      FABRIC_ADDON_PATH: mockAddonPath,
      FABRIC_NATIVE_TEST_ADDON: ''
    }, (m) => {
      assert.strictEqual(m.bech32Decode(null), null);
    });
  });

  it('in-process: addon path lists build/Release when not strict and not skipping builtin', function () {
    withFabricNativeAccelFresh({
      FABRIC_NATIVE_BECH32: '1',
      FABRIC_ADDON_PATH: mockAddonPath
    }, (m) => {
      assert.strictEqual(m.isNativeBech32Callable(), true);
    });
  });

  it('in-process: FABRIC_SKIP_NATIVE_ADDON still loads FABRIC_ADDON_PATH', function () {
    withFabricNativeAccelFresh({
      FABRIC_NATIVE_BECH32: '1',
      FABRIC_SKIP_NATIVE_ADDON: '1',
      FABRIC_ADDON_PATH_STRICT: '1',
      FABRIC_ADDON_PATH: mockAddonPath
    }, (m) => {
      assert.strictEqual(m.isNativeBech32Callable(), true);
    });
  });

  it('in-process: strict addon path skips missing file before failing', function () {
    const missing = path.join(os.tmpdir(), `fabric-missing-addon-${Date.now()}.node`);
    withFabricNativeAccelFresh({
      FABRIC_NATIVE_BECH32: '1',
      FABRIC_ADDON_PATH_STRICT: '1',
      FABRIC_ADDON_PATH: missing
    }, (m) => {
      assert.strictEqual(m.isNativeBech32Callable(), false);
      const s = m.status();
      assert.ok(s.error && s.error.includes('not found'));
    });
  });

  it('in-process: status lists doubleSha256 when opted in and addon loads', function () {
    withFabricNativeAccelFresh({
      FABRIC_NATIVE_DOUBLE_SHA256: '1',
      FABRIC_ADDON_PATH: mockAddonPath
    }, (m) => {
      const s = m.status();
      assert.ok(s.methods.includes('doubleSha256'));
    });
  });

  it('in-process: status lists doubleSha256 and bech32 methods when both opted in', function () {
    withFabricNativeAccelFresh({
      FABRIC_NATIVE_DOUBLE_SHA256: '1',
      FABRIC_NATIVE_BECH32: '1',
      FABRIC_ADDON_PATH: mockAddonPath
    }, (m) => {
      const s = m.status();
      assert.ok(s.methods.includes('doubleSha256'));
      assert.ok(s.methods.includes('bech32Encode'));
      assert.ok(s.methods.includes('segwitAddrDecode'));
    });
  });

  it('in-process: bech32Encode catch path when addon throws', function () {
    withFabricNativeAccelFresh({
      FABRIC_NATIVE_BECH32: '1',
      FABRIC_ADDON_PATH_STRICT: '1',
      FABRIC_ADDON_PATH: testVariantAddonPath,
      FABRIC_NATIVE_TEST_ADDON: 'bech32_encode_throw'
    }, (m) => {
      assert.strictEqual(m.bech32Encode('id', Buffer.from([0, 1, 2]), 'bech32m'), null);
    });
  });

  it('in-process: bech32Decode accepts Uint8Array-like words from addon', function () {
    withFabricNativeAccelFresh({
      FABRIC_NATIVE_BECH32: '1',
      FABRIC_ADDON_PATH_STRICT: '1',
      FABRIC_ADDON_PATH: testVariantAddonPath,
      FABRIC_NATIVE_TEST_ADDON: 'bech32_words_uint8'
    }, (m) => {
      const d = m.bech32Decode('id1qpz4j4pq');
      assert.ok(d && Array.isArray(d.words) && d.spec === 'bech32m');
    });
  });

  it('in-process: bech32Decode accepts plain array words from addon', function () {
    withFabricNativeAccelFresh({
      FABRIC_NATIVE_BECH32: '1',
      FABRIC_ADDON_PATH_STRICT: '1',
      FABRIC_ADDON_PATH: testVariantAddonPath,
      FABRIC_NATIVE_TEST_ADDON: 'bech32_words_js_array'
    }, (m) => {
      const d = m.bech32Decode('id1qpz4j4pq');
      assert.deepStrictEqual(d.words, [0, 1, 2, 3]);
      assert.strictEqual(d.spec, 'bech32m');
    });
  });

  it('in-process: bech32Decode catch and malformed addon results return null', function () {
    const addr = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
    withFabricNativeAccelFresh({
      FABRIC_NATIVE_BECH32: '1',
      FABRIC_ADDON_PATH_STRICT: '1',
      FABRIC_ADDON_PATH: testVariantAddonPath,
      FABRIC_NATIVE_TEST_ADDON: 'bech32_decode_throw'
    }, (m) => {
      assert.strictEqual(m.bech32Decode(addr), null);
    });
    withFabricNativeAccelFresh({
      FABRIC_NATIVE_BECH32: '1',
      FABRIC_ADDON_PATH_STRICT: '1',
      FABRIC_ADDON_PATH: testVariantAddonPath,
      FABRIC_NATIVE_TEST_ADDON: 'bech32_bad_words'
    }, (m) => {
      assert.strictEqual(m.bech32Decode(addr), null);
    });
    withFabricNativeAccelFresh({
      FABRIC_NATIVE_BECH32: '1',
      FABRIC_ADDON_PATH_STRICT: '1',
      FABRIC_ADDON_PATH: testVariantAddonPath,
      FABRIC_NATIVE_TEST_ADDON: 'bech32_bad_spec'
    }, (m) => {
      assert.strictEqual(m.bech32Decode(addr), null);
    });
  });

  it('in-process: segwit encode/decode catch and bad version return null', function () {
    const program = Buffer.alloc(20, 3);
    let tbAddr;
    withFabricNativeAccelFresh({
      FABRIC_NATIVE_BECH32: '1',
      FABRIC_ADDON_PATH_STRICT: '1',
      FABRIC_ADDON_PATH: mockAddonPath,
      FABRIC_NATIVE_TEST_ADDON: ''
    }, (m) => {
      tbAddr = m.segwitAddrEncode('tb', 0, program);
    });
    assert.ok(typeof tbAddr === 'string');
    withFabricNativeAccelFresh({
      FABRIC_NATIVE_BECH32: '1',
      FABRIC_ADDON_PATH_STRICT: '1',
      FABRIC_ADDON_PATH: testVariantAddonPath,
      FABRIC_NATIVE_TEST_ADDON: 'segwit_encode_throw'
    }, (m) => {
      assert.strictEqual(m.segwitAddrEncode('tb', 0, program), null);
    });
    withFabricNativeAccelFresh({
      FABRIC_NATIVE_BECH32: '1',
      FABRIC_ADDON_PATH_STRICT: '1',
      FABRIC_ADDON_PATH: testVariantAddonPath,
      FABRIC_NATIVE_TEST_ADDON: 'segwit_decode_throw'
    }, (m) => {
      assert.strictEqual(m.segwitAddrDecode('tb', tbAddr), null);
    });
    withFabricNativeAccelFresh({
      FABRIC_NATIVE_BECH32: '1',
      FABRIC_ADDON_PATH_STRICT: '1',
      FABRIC_ADDON_PATH: testVariantAddonPath,
      FABRIC_NATIVE_TEST_ADDON: 'segwit_bad_version'
    }, (m) => {
      assert.strictEqual(m.segwitAddrDecode('tb', tbAddr), null);
    });
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
