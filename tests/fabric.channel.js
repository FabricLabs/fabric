'use strict';

const assert = require('assert');
const Channel = require('../types/channel');

const sample = {};

describe('@fabric/core/types/channel', function () {
  describe('Channel', function () {
    it('is available from @fabric/core', function () {
      assert.equal(Channel instanceof Function, true);
    });

    it('can instantiate from sample data', function (done) {
      async function test () {
        const channel = new Channel(sample);
        assert.ok(channel);
        done();
      }

      test();
    });
  });
});
