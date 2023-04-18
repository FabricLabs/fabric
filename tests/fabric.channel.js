'use strict';

const assert = require('assert');
const Actor = require('../types/actor');
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

    it('can call add', function (done) {
      async function test () {
        const channel = new Channel(sample);
        channel.add(1);
        assert.ok(channel);
        done();
      }

      test();
    });

    it('can call fund', function (done) {
      async function test () {
        const channel = new Channel(sample);

        await channel.fund({
          raw: Actor.randomBytes(32)
        });

        assert.ok(channel);
        done();
      }

      test();
    });
  });
});
