'use strict';

const assert = require('assert');
const { toWords, encode } = require('../functions/bech32');
const Bech32 = require('../types/bech32');

describe('@fabric/core/types/bech32', function () {
  it('static decode returns prefix and bytes for a generic bech32 payload', function () {
    const payload = Buffer.from([0x01, 0x02, 0x03]);
    const str = encode('zz', toWords(payload), 'bech32');
    const d = Bech32.decode(str);
    assert.strictEqual(d.prefix, 'zz');
    assert.ok(Buffer.isBuffer(d.content));
    assert.deepStrictEqual(Buffer.from(d.content), payload);
  });

  it('toString matches functions/bech32 encode(..., bech32m) for the same payload', function () {
    const payload = Buffer.alloc(32, 2);
    const b = new Bech32({ hrp: 'bc', content: payload });
    const expected = encode('bc', toWords(payload), 'bech32m');
    assert.strictEqual(b.toString(), expected);
  });

  it('words accepts hex string content', function () {
    const b = new Bech32({ hrp: 'ab', content: 'aabbcc' });
    assert.ok(Array.isArray(b.words));
    assert.ok(b.words.length > 0);
  });
});
