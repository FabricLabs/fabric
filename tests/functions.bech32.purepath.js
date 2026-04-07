'use strict';

/**
 * In-process coverage for {@link functions/bech32} pure fallback (FABRIC_PURE_BECH32),
 * so c8 attributes hits to the parent process (subprocess-only tests do not).
 */
const assert = require('assert');

function withPureBech32 (fn) {
  delete require.cache[require.resolve('../functions/fabricNativeAccel.js')];
  delete require.cache[require.resolve('../functions/bech32.js')];
  const prev = process.env.FABRIC_PURE_BECH32;
  const prevNative = process.env.FABRIC_NATIVE_BECH32;
  process.env.FABRIC_PURE_BECH32 = '1';
  delete process.env.FABRIC_NATIVE_BECH32;
  try {
    return fn(require('../functions/bech32.js'));
  } finally {
    if (prev === undefined) delete process.env.FABRIC_PURE_BECH32;
    else process.env.FABRIC_PURE_BECH32 = prev;
    if (prevNative === undefined) delete process.env.FABRIC_NATIVE_BECH32;
    else process.env.FABRIC_NATIVE_BECH32 = prevNative;
    delete require.cache[require.resolve('../functions/fabricNativeAccel.js')];
    delete require.cache[require.resolve('../functions/bech32.js')];
    require('../functions/bech32.js');
  }
}

describe('functions/bech32 pure path (in-process)', function () {
  it('encodeSegwitAddress / decodeSegwitAddress v0 and v1 via pure codec', function () {
    withPureBech32((b) => {
      const p20 = Buffer.alloc(20, 3);
      const a0 = b.encodeSegwitAddress('tb', 0, p20);
      assert.ok(typeof a0 === 'string');
      const d0 = b.decodeSegwitAddress('tb', a0);
      assert.ok(d0 && d0.version === 0 && d0.program.equals(p20));

      const p32 = Buffer.alloc(32, 9);
      const a1 = b.encodeSegwitAddress('tb', 1, p32);
      assert.ok(typeof a1 === 'string');
      const d1 = b.decodeSegwitAddress('tb', a1);
      assert.ok(d1 && d1.version === 1 && d1.program.equals(p32));
    });
  });

  it('decodePure errors surface through decode()', function () {
    withPureBech32((b) => {
      assert.throws(() => b.decode('Bc1qMixed'), /Mixed-case bech32/);
    });
  });
});
