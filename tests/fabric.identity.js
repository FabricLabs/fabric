'use strict';

const Identity = require('../types/identity');
const assert = require('assert');

const SAMPLE = {
  seed: 'cricket grocery kingdom wool double wood happy predict worth pave build pepper bullet farm churn exhibit grit isolate short theory help vehicle denial slide'
};

describe('@fabric/core/types/identity', function () {
  this.timeout(10000);

  describe('Identity', function () {
    it('is available from @fabric/core', function () {
      assert.equal(Identity instanceof Function, true);
    });

    it('can create a new ECDSA identity', function () {
      const identity = new Identity();
      assert.ok(identity);
    });
  });
});
