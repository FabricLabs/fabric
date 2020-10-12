'use strict';

const HKDF = require('../types/hkdf');
const assert = require('assert');

// Test Vectors (cut to 32 bytes)
const vectors = {
  ikm: Buffer.from('0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b', 'hex'),
  salt: Buffer.from('000102030405060708090a0b0c', 'hex'),
  info: Buffer.from('f0f1f2f3f4f5f6f7f8f9', 'hex'),
  prk: Buffer.from('077709362c2e32df0ddc3f0dc47bba6390b6c73bb50f9c3122ec844ad7c2b3e5', 'hex'),
  okm: Buffer.from('3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf', 'hex')
};

describe('@fabric/core/types/hkdf', function () {
  describe('HKDF', function () {
    it('is a constructor', function () {
      assert.equal(HKDF instanceof Function, true);
    });

    it('can generate correct PRK', function () {
      let hkdf = new HKDF({
        initial: vectors.ikm.toString(),
        salt: vectors.salt.toString()
      });

      assert.ok(hkdf);
      assert.equal(hkdf.size, 32);
      assert.deepEqual(hkdf.prk, vectors.prk);
    });

    it('can generate correct HKDF output', function () {
      let hkdf = new HKDF({
        initial: vectors.ikm.toString(),
        salt: vectors.salt.toString()
      });

      assert.ok(hkdf);
      assert.equal(hkdf.size, 32);
      assert.deepEqual(hkdf.prk, vectors.prk);
      assert.deepEqual(hkdf.derive(vectors.info), vectors.okm);
    });
  });
});
