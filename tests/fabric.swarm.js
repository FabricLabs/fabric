'use strict';

// require('debug-trace')({ always: true });

const config = require('../settings/test');
const { Swarm } = require('../types/peer');

// Testing
const assert = require('assert');

describe('@fabric/core/types/peer (Swarm)', function () {
  // Track all swarms created during tests for cleanup
  const swarms = [];

  // Cleanup hook to ensure all swarms are stopped even if tests fail
  after(async function () {
    for (const swarm of swarms) {
      try {
        if (swarm && typeof swarm.stop === 'function') {
          await swarm.stop();
        }
      } catch (error) {
        // Ignore cleanup errors to avoid masking test failures
        console.warn('[TEST:CLEANUP] Error stopping swarm:', error.message);
      }
    }
    swarms.length = 0; // Clear the array
  });

  describe('Swarm', function () {
    it('should expose a constructor', function () {
      assert.equal(Swarm instanceof Function, true);
    });

    xit('can start and stop cleanly', async function () {
      const swarm = new Swarm();
      swarms.push(swarm);
      await swarm.start();
      await swarm.stop();
      assert.ok(swarm);
    });

    it('can start and stop with the test configuration', async function () {
      const swarm = new Swarm(config);
      swarms.push(swarm);
      await swarm.start();
      await swarm.stop();
      assert.ok(swarm);
    });
  });
});
