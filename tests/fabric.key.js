'use strict';

const Fabric = require('../');
const assert = require('assert');

const message = require('../assets/message');

describe('@fabric/core/types/key', function () {
  describe('Key', function () {
    it('is available from @fabric/core', function () {
      assert.equal(Fabric.Key instanceof Function, true);
    });

    it('can create a new ECDSA key', function () {
      let key = new Fabric.Key();
      assert.ok(key);
    });

    it('can generate a known keypair', function () {
      let key = new Fabric.Key({
        private: '1111111111111111111111111111111111111111111111111111111111111111'
      });

      assert.equal(key.public.encodeCompressed('hex'), '034f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aa');
    });

    it('can sign some data', function () {
      let key = new Fabric.Key();
      let signature = key._sign(message['@data']);

      assert.ok(signature);
    });

    it('produces a valid signature', function () {
      let key = new Fabric.Key();
      let signature = key._sign(message['@data']);
      let valid = key._verify(message['@data'], signature)
      assert.ok(valid);
    });
  });
});
