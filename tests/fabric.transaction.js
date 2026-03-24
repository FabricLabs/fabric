'use strict';

const Fabric = require('../');
const Transaction = require('../types/transaction');
const assert = require('assert');

describe('@fabric/core/types/transaction', function () {
  describe('Transaction', function () {
    it('is available as a direct type module', function () {
      assert.equal(Transaction instanceof Function, true);
      assert.equal(Fabric.Transaction instanceof Function, false);
    });
  });
});
