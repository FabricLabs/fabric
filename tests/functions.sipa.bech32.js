'use strict';

const assert = require('assert');
const b = require('../functions/sipa/bech32');

describe('@fabric/core/functions/sipa/bech32', function () {
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
