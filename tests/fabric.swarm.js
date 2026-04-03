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

    it('can start and stop cleanly', async function () {
      const seed = process.pid % 10000;
      const port = 20000 + (seed % 10000);
      const swarm = new Swarm({ listen: true, port });
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

    it('_scheduleReconnect invokes connect after timeout for registered peer ids', function (done) {
      const swarm = new Swarm({ seeds: [], peers: [] });
      swarm.peers.pid = { id: 'pid', address: '127.0.0.1:55' };
      swarm.connect = (peer) => {
        assert.strictEqual(peer.address, '127.0.0.1:55');
        done();
      };
      const orig = global.setTimeout;
      global.setTimeout = function (fn, delay) {
        assert.strictEqual(delay, 60000);
        return orig(() => {
          global.setTimeout = orig;
          fn();
        }, 1);
      };
      swarm._scheduleReconnect({ id: 'pid', address: '127.0.0.1:55' });
    });

    it('_scheduleReconnect returns true when a timer is already pending', function () {
      const swarm = new Swarm({ seeds: [], peers: [] });
      swarm.peers.pid = { id: 'pid', address: 'a', timer: setTimeout(() => {}, 9999) };
      let calls = 0;
      const orig = global.setTimeout;
      global.setTimeout = function () {
        calls++;
        return 0;
      };
      const r = swarm._scheduleReconnect({ id: 'pid', address: 'a' });
      global.setTimeout = orig;
      clearTimeout(swarm.peers.pid.timer);
      assert.strictEqual(calls, 0);
      assert.strictEqual(r, true);
    });

    it('_fillPeerSlots calls _scheduleReconnect for configured peer addresses', function () {
      const swarm = new Swarm({ seeds: [], peers: ['127.0.0.1:99'] });
      let n = 0;
      swarm._scheduleReconnect = () => { n++; };
      swarm.nodes = {};
      swarm.peers = {};
      swarm._fillPeerSlots();
      assert.strictEqual(n, 1);
    });

    it('start/stop emit verbosity-gated debug logs', async function () {
      const swarm = new Swarm({ listen: false, seeds: { s1: '127.0.0.1:2' }, peers: [], verbosity: 5 });
      swarms.push(swarm);
      swarm.connect = function () {};
      const lines = [];
      swarm.on('debug', (m) => lines.push(String(m)));
      await swarm.start();
      await swarm.stop();
      assert.ok(lines.some((l) => l.includes('SWARM')));
    });
  });
});
