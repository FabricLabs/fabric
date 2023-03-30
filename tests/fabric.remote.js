'use strict';

const assert = require('assert');
const Remote = require('../types/remote');

const sample = {};

describe('@fabric/core/types/remote', function () {
  describe('Remote', function () {
    it('is available from @fabric/core', function () {
      assert.equal(Remote instanceof Function, true);
    });

    it('can instantiate from sample data', function (done) {
      async function test () {
        const remote = new Remote(sample);
        assert.ok(remote);
        done();
      }

      test();
    });
  });
});
