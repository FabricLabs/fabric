'use strict';

// require('debug-trace')({ always: true });

const config = require('../settings/test');
const Swarm = require('../types/swarm');

// Testing
const assert = require('assert');

describe('@fabric/core/types/swarm', function () {
  describe('Swarm', function () {
    it('should expose a constructor', function () {
      assert.equal(Swarm instanceof Function, true);
    });

    xit('can start and stop cleanly', async function () {
      const swarm = new Swarm();
      await swarm.start();
      await swarm.stop();
      assert.ok(swarm);
    });

    it('can start and stop with the test configuration', async function () {
      const swarm = new Swarm(config);
      await swarm.start();
      await swarm.stop();
      assert.ok(swarm);
    });
  });
});
