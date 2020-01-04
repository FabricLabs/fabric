'use strict';

const assert = require('assert');
const Wallet = require('../types/wallet');

const message = require('../assets/message');

describe('@fabric/core/types/wallet', function () {
  describe('Wallet', function () {
    it('is available from @fabric/core', function () {
      assert.equal(Wallet instanceof Function, true);
    });
  });
});
