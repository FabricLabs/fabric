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

    it('can start and stop cleanly', async function () {
      let swarm = new Swarm();
      await swarm.start();
      await swarm.stop();
      assert.ok(swarm);
    });
  });
});
