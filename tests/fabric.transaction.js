'use strict';

const Fabric = require('../');
const assert = require('assert');

describe('@fabric/core/types/transaction', function () {
  describe('Transaction', function () {
    xit('is available from @fabric/core', function () {
      assert.equal(Fabric.Transaction instanceof Function, true);
    });
  });
});
