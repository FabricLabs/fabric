'use strict';

const Identity = require('../types/identity');
const assert = require('assert');

const SAMPLE = {
  seed: 'cricket grocery kingdom wool double wood happy predict worth pave build pepper bullet farm churn exhibit grit isolate short theory help vehicle denial slide'
};

describe('@fabric/core/types/identity', function () {
  describe('Identity', function () {
    it('is available from @fabric/core', function () {
      assert.equal(Identity instanceof Function, true);
    });

    it('can create a new ECDSA identity', function () {
      const identity = new Identity();
      assert.ok(identity);
    });

    it('provides the correct public key for a known seed phrase', function () {
      const identity = new Identity({
        seed: SAMPLE.seed
      });

      assert.ok(identity);
      assert.equal(identity.pubkey, '3b7a27a51582e9e9cc1d820dc9105bdbd12dfe96c471a1a5cf5cff7e8fab566');
    });
  });
});
