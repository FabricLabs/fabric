'use strict';

const assert = require('assert');
const Contract = require('../types/contract');

const sample = {};

describe('@fabric/core/types/contract', function () {
  describe('Contract', function () {
    it('is available from @fabric/core', function () {
      assert.equal(Contract instanceof Function, true);
    });

    it('can instantiate from sample data', function (done) {
      async function test () {
        const contract = new Contract(sample);
        assert.ok(contract);
        done();
      }

      test();
    });
  });
});
