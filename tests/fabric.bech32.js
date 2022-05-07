'use strict';

const Bech32 = require('../types/bech32');
const assert = require('assert');

const message = require('../assets/message');
const playnet = require('../settings/playnet');

describe('@fabric/core/types/bech32', function () {
  this.timeout(10000);

  describe('Bech32', function () {
    it('is available from @fabric/core', function () {
      assert.equal(Bech32 instanceof Function, true);
    });

    it('can create a new ECDSA bech32', function () {
      const bech32 = new Bech32();
      assert.ok(bech32);
    });
  });
});
