'use strict';

const assert = require('assert');
const Witness = require('../types/witness');

const sample = {
  data: 'Hello, world!'
};

describe('@fabric/core/types/witness', function () {
  describe('Witness', function () {
    it('is available from @fabric/core', function () {
      assert.equal(Witness instanceof Function, true);
    });

    it('can instantiate from sample data', function (done) {
      async function test () {
        const witness = new Witness(sample);
        assert.ok(witness);
        done();
      }

      test();
    });
  });
});
