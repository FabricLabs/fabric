'use strict';

const Key = require('../types/key');
const assert = require('assert');

const message = require('../assets/message');
const playnet = require('../settings/playnet');

describe('@fabric/core/types/key', function () {
  this.timeout(10000);

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

      assert.equal(key.pubkey, '034f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aa');
    });

    it('can load from an existing seed', function () {
      const key = new Key({ seed: playnet.key.seed });
      assert.equal(key.public.encodeCompressed('hex'), '0223cffd5e94da3c8915c6b868f06d15183c1aeffad8ddf58fcb35a428e3158e71');
    });

    it('can load from an existing xprv', function () {
      const key = new Key({ xprv: playnet.key.xprv });
      assert.equal(key.public.encodeCompressed('hex'), '0223cffd5e94da3c8915c6b868f06d15183c1aeffad8ddf58fcb35a428e3158e71');
    });

    it('can load from an existing xpub', function () {
      const key = new Key({ xpub: playnet.key.xpub });
      assert.equal(key.public.encodeCompressed('hex'), '0223cffd5e94da3c8915c6b868f06d15183c1aeffad8ddf58fcb35a428e3158e71');
    });

    it('can generate many keypairs', function () {
      // 31 byte keys every ~256 iterations
      for (let i = 0; i < 1024; i++) {
        const key = new Key();
        assert.ok(key);
      }
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
