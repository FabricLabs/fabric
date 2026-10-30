'use strict';

const assert = require('assert');
const { crypto: btcCrypto } = require('bitcoinjs-lib');
const Hash256 = require('../types/hash256');
const HKDF = require('../types/hkdf');
const taggedHash = require('../functions/taggedHash');

const hex = (s) => Buffer.from(s, 'hex');

describe('@fabric/core/types/hash256 statics', function () {
  describe('Hash256.tagged', function () {
    it('matches bitcoinjs-lib for BIP-340 and BIP-341 tags', function () {
      const data = hex('cc8a4bc64d897bddc5fbc2f670f7a8ba0b386779106cf1223c6fc5d7cd6fc115');
      for (const tag of ['TapTweak', 'BIP0340/challenge', 'BIP0340/aux', 'TapLeaf']) {
        assert.ok(Hash256.tagged(tag, data).equals(Buffer.from(btcCrypto.taggedHash(tag, data))), tag);
      }
    });

    it('is what functions/taggedHash exports', function () {
      assert.strictEqual(taggedHash, Hash256.tagged);
    });

    it('returns a fresh buffer each call', function () {
      const a = Hash256.tagged('Fabric/Test', Buffer.from('x'));
      a.fill(0);
      assert.notDeepStrictEqual(Hash256.tagged('Fabric/Test', Buffer.from('x')), a);
    });

    it('keeps the same digest for a Buffer tag and its string', function () {
      const data = Buffer.from('payload');
      assert.ok(Hash256.tagged(Buffer.from('Fabric/Message'), data).equals(Hash256.tagged('Fabric/Message', data)));
    });
  });

  describe('Hash256.hmac', function () {
    it('matches RFC 4231 test cases 1 and 2', function () {
      assert.strictEqual(
        Hash256.hmac(Buffer.alloc(20, 0x0b), 'Hi There').toString('hex'),
        'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7'
      );
      assert.strictEqual(
        Hash256.hmac('Jefe', 'what do ya want for nothing?').toString('hex'),
        '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843'
      );
    });

    it('matches RFC 4231 test case 6 (key longer than a block)', function () {
      assert.strictEqual(
        Hash256.hmac(Buffer.alloc(131, 0xaa), 'Test Using Larger Than Block-Size Key - Hash Key First').toString('hex'),
        '60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54'
      );
    });

    it('refuses other input types', function () {
      assert.throws(() => Hash256.hmac(42, 'x'), TypeError);
    });
  });

  describe('Hash256.keystream', function () {
    const key = hex('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f');

    it('is HMAC-SHA256 of prefix ‖ uint32be(j), truncated', function () {
      const prefix = Buffer.from('enc');
      const counter = (j) => {
        const b = Buffer.alloc(4);
        b.writeUInt32BE(j);
        return Buffer.concat([prefix, b]);
      };
      const expected = Buffer.concat([0, 1, 2].map((j) => Hash256.hmac(key, counter(j)))).subarray(0, 70);
      assert.ok(Hash256.keystream(key, 70, prefix).equals(expected));
    });

    it('defaults to no prefix and is a prefix of longer output', function () {
      const short = Hash256.keystream(key, 10);
      const long = Hash256.keystream(key, 100);
      assert.strictEqual(short.length, 10);
      assert.strictEqual(long.length, 100);
      assert.ok(long.subarray(0, 10).equals(short));
      assert.ok(short.equals(Hash256.hmac(key, Buffer.alloc(4)).subarray(0, 10)));
    });

    it('separates prefixes and keys', function () {
      assert.ok(!Hash256.keystream(key, 32, 'enc').equals(Hash256.keystream(key, 32, 'mac')));
      assert.ok(!Hash256.keystream(key, 32).equals(Hash256.keystream(Buffer.alloc(32), 32)));
    });

    it('returns nothing for n = 0 and refuses bad lengths', function () {
      assert.strictEqual(Hash256.keystream(key, 0).length, 0);
      assert.throws(() => Hash256.keystream(key, -1), RangeError);
      assert.throws(() => Hash256.keystream(key, 1.5), RangeError);
    });
  });

  describe('HKDF.extract / HKDF.expand', function () {
    it('match RFC 5869 test case 1', function () {
      const prk = HKDF.extract(Buffer.alloc(22, 0x0b), hex('000102030405060708090a0b0c'));
      assert.strictEqual(prk.toString('hex'), '077709362c2e32df0ddc3f0dc47bba6390b6c73bb50f9c3122ec844ad7c2b3e5');
      assert.strictEqual(
        HKDF.expand(prk, hex('f0f1f2f3f4f5f6f7f8f9'), 42).toString('hex'),
        '3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865'
      );
    });

    it('match RFC 5869 test case 3 (no salt, no info)', function () {
      const prk = HKDF.extract(Buffer.alloc(22, 0x0b));
      assert.strictEqual(prk.toString('hex'), '19ef24a32c717b167f33a91d6f648bdf96596776afdb6377ac434c1c293ccb04');
      assert.strictEqual(
        HKDF.expand(prk, undefined, 42).toString('hex'),
        '8da4e775a563c18f715f802a063c5a31b8a11f5c5ee1879ec3454e5f3c738d2d9d201395faa4b61a96c8'
      );
    });

    it('the constructor defaults to a zero-byte salt (RFC 5869)', function () {
      const kdf = new HKDF({ initial: Buffer.alloc(22, 0x0b) });
      assert.strictEqual(kdf.prk.toString('hex'), '19ef24a32c717b167f33a91d6f648bdf96596776afdb6377ac434c1c293ccb04');
      assert.ok(kdf.derive('', 42).equals(HKDF.expand(kdf.prk, '', 42)));
    });

    it('supports SHA-512 and refuses other hashes', function () {
      const prk = HKDF.extract('ikm', 'salt', 'sha512');
      assert.strictEqual(prk.length, 64);
      assert.strictEqual(HKDF.expand(prk, 'info', 100, 'sha512').length, 100);
      assert.throws(() => HKDF.extract('ikm', 'salt', 'md5'), /Unsupported HKDF hash/);
    });

    it('refuses short keys and out-of-range lengths', function () {
      assert.throws(() => HKDF.expand(Buffer.alloc(16), 'x', 32), RangeError);
      assert.throws(() => HKDF.expand(Buffer.alloc(32), 'x', 0), RangeError);
      assert.throws(() => HKDF.expand(Buffer.alloc(32), 'x', 255 * 32 + 1), RangeError);
      assert.strictEqual(HKDF.expand(Buffer.alloc(32), 'x', 255 * 32).length, 255 * 32);
    });
  });
});
