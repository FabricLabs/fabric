'use strict';

const Key = require('../types/key');
const assert = require('assert');

const message = require('../assets/message');

describe('@fabric/core/types/key', function () {
  describe('Key', function () {
    it('is available from @fabric/core', function () {
      assert.equal(Key instanceof Function, true);
    });

    it('can create a new ECDSA key', function () {
      const key = new Key();
      assert.ok(key);
    });

    it('can generate a known keypair', function () {
      const key = new Key({
        private: '1111111111111111111111111111111111111111111111111111111111111111'
      });

      assert.equal(key.public.encodeCompressed('hex'), '034f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aa');
    });

    it('can sign some data', function () {
      const key = new Key();
      const signature = key._sign(message['@data']);

      assert.ok(signature);
    });

    it('produces a valid signature', function () {
      const key = new Key();
      const signature = key._sign(message['@data']);
      const valid = key._verify(message['@data'], signature);
      assert.ok(valid);
    });
  });
});
