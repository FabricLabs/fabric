'use strict';

const assert = require('assert');
const b = require('../functions/sipa/bech32');

describe('@fabric/core/functions/sipa/bech32', function () {
  it('encode/decode round-trips data for bech32 and bech32m', function () {
    const data = [0, 1, 2, 3, 4, 5, 6, 7];
    const s0 = b.encode('tb', data, b.encodings.BECH32);
    const d0 = b.decode(s0, b.encodings.BECH32);
    assert.ok(d0);
    assert.strictEqual(d0.hrp, 'tb');
    assert.deepStrictEqual(d0.data, data);

    const s1 = b.encode('tb', data, b.encodings.BECH32M);
    const d1 = b.decode(s1, b.encodings.BECH32M);
    assert.ok(d1);
    assert.strictEqual(d1.hrp, 'tb');
    assert.deepStrictEqual(d1.data, data);
  });

  it('decode rejects mixed-case bech32 strings', function () {
    const s = b.encode('test', [0, 0, 0, 0, 0, 0, 0, 0], b.encodings.BECH32);
    const mixed = s.slice(0, 6) + s[6].toUpperCase() + s.slice(7);
    assert.strictEqual(b.decode(mixed, b.encodings.BECH32), null);
  });

  it('decode rejects disallowed characters', function () {
    assert.strictEqual(b.decode('bc1\x01w508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', b.encodings.BECH32), null);
  });

  it('decode rejects implausible length', function () {
    const long = 'a1' + 'q'.repeat(89);
    assert.strictEqual(b.decode(long, b.encodings.BECH32), null);
  });

  it('decode with unknown encoding constant never verifies', function () {
    const s = b.encode('zz', [1, 2, 3, 4, 5, 6, 7, 8], b.encodings.BECH32);
    assert.strictEqual(b.decode(s, 'not-an-encoding'), null);
  });
});
