'use strict';

const Fabric = require('../');
const assert = require('assert');

const message = require('../assets/message');

describe('@fabric/core/types/key', function () {
  describe('Key', function () {
    it('is available from @fabric/core', function () {
      assert.equal(Fabric.Key instanceof Function, true);
    });

    it('can create an ECDSA key', function () {
      let key = new Fabric.Key();
      assert.ok(key);
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
