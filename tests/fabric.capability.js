'use strict';

const assert = require('assert');
const Capability = require('../types/capability');

const sample = {};

describe('@fabric/core/types/capability', function () {
  describe('Capability', function () {
    it('is available from @fabric/core', function () {
      assert.equal(Capability instanceof Function, true);
    });

    it('can instantiate from sample data', function (done) {
      async function test () {
        const capability = new Capability(sample);
        assert.ok(capability);
        done();
      }

      test();
    });
  });
});
