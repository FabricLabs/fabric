'use strict';

const config = require('../settings/test');
const Interface = require('../types/interface');

// Testing
const assert = require('assert');

describe('@fabric/core/types/interface', function () {
  describe('Interface', function () {
    it('should expose a constructor', function () {
      assert.equal(Interface instanceof Function, true);
    });

    it('can start and stop cleanly', async function () {
      const net = new Interface(config);
      assert.ok(net);
      await net.start();
      await net.stop();
      assert.ok(net);
    });

    it('can start and stop with the test configuration', async function () {
      const net = new Interface(config);
      assert.ok(net);
      assert.equal(net.status, 'initialized');

      await net.start();
      assert.equal(net.status, 'started');

      await net.stop();
      assert.equal(net.status, 'stopped');
    });

    it('runs through a known circuit', async function () {
      const script = ['start', 'stop'];
      const cycles = [];
      const events = [];

      const net = new Interface(config);
      assert.ok(net);
      assert.equal(net.status, 'initialized');
      assert.equal(events.length, 0);
      assert.equal(cycles.length, 0);

      // TODO: remove this case / rework messages
      net.on('message', async function handler (msg) {
        // console.log('Message received:', msg);
        events.push(msg);

        switch (msg['@type']) {
          default:
            // console.warn('unhandled msg type:', msg['@type']);
            break;
          case 'Cycle':
            cycles.push(msg.data);
            break;
        }
      });

      net.on('cycle', async function handler (cycle) {
        events.push(cycle);
        cycles.push(cycle);
      });

      net.on('transaction', async function handler (transaction) {
        events.push(transaction);
      });

      await net.start();
      assert.equal(net.status, 'started');

      await net.stop();
      assert.equal(net.status, 'stopped');

      // Test various criteria...
      // Cycles should have parsed valid messages
      assert.equal(events.length, 6);
      assert.equal(cycles.length, 2);
      assert.equal(cycles[0], script[0]);
      assert.equal(cycles[1], script[1]);
    });

    it('can share some state', async function () {
      const alice = new Interface(config);
      const bob = new Interface(config);

      const genesis = alice.shared();
      const replica = bob.shared();

      alice.on('commit', function (commit) {
        // console.log('got commit:', commit);
      });

      alice.writeTo(0, 'Hello, world!');

      assert.ok(genesis);
      assert.ok(replica);
    });
  });
});
