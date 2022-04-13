'use strict';

// testing
const assert = require('assert');

// Types
const Bitcoin = require('../services/bitcoin');

describe('@fabric/core/services/bitcoin', function () {
  describe('Bitcoin', function () {
    it('should expose a constructor', function () {
      assert.equal(Bitcoin.constructor instanceof Function, true);
    });
  });
});
