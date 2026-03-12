'use strict';

// Dependencies
const Peer = require('../types/peer');
const assert = require('assert');
const net = require('net');

const NODEA = require('../settings/node-a');
const NODEB = require('../settings/node-b');

// Settings
const settings = {
  debug: process.env.DEBUG || false,
  // Avoid fixed ports in tests (can conflict with dev machines/CI).
  port: 0
};

async function getFreePort () {
  return await new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address();
      const port = addr && typeof addr === 'object' ? addr.port : null;
      s.close(() => {
        if (!port) return reject(new Error('Could not allocate a free port'));
        resolve(port);
      });
    });
  });
}

describe('@fabric/core/types/peer', function () {
  this.timeout(30000);

  // Track all peers created during tests for cleanup
  const peers = [];

  // Cleanup hook to ensure all peers are stopped even if tests fail
  after(async function () {
    for (const peer of peers) {
      try {
        if (peer && typeof peer.stop === 'function') {
          await peer.stop();
        }
      } catch (error) {
        // Ignore cleanup errors to avoid masking test failures
        console.warn('[TEST:CLEANUP] Error stopping peer:', error.message);
      }
    }
    peers.length = 0; // Clear the array
  });

  describe('Peer', function () {
    it('is a constructor', function () {
      assert.equal(Peer instanceof Function, true);
    });

    it('can cleanly start and stop', async function () {
      const port = await getFreePort();
      const peer = new Peer({ ...settings, port, peers: [], upnp: false, networking: false, peersDb: null });
      peers.push(peer);

      await peer.start();
      await peer.stop();

      assert.ok(peer);
    });

    it('provides documentation', function () {
      const peer = new Peer();
      assert.ok(peer.documentation);
    });

    it('can receive a connection', function (done) {
      async function test () {
        const port = await getFreePort();
        const server = new Peer(Object.assign(
          { verbosity: 2 },
          NODEA,
          { listen: true, port, upnp: false, peers: [], networking: false, peersDb: null }
        ));
        const client = new Peer(Object.assign(
          { verbosity: 2 },
          NODEB,
          {
            listen: false,
            port: 0,
            upnp: false,
            peersDb: null,
            peers: [`${server.key.pubkey}@localhost:${port}`]
          }
        ));

        // Track peers for cleanup
        peers.push(server, client);

        async function handleClientMessage (msg) {
          console.log(`[TEST:SERVER] event "message" - <${typeof msg}>`, msg);
        }

        async function handleClientWarning (msg) {
          console.warn(`[TEST:SERVER] event "warning" - <${typeof msg}>`, msg);
        }

        async function handleClientError (msg) {
          console.error(`[TEST:SERVER] event "error" - <${typeof msg}>`, msg);
        }

        async function handleMessage (msg) {
          console.log(`[TEST:SERVER] event "message" - <${typeof msg}>`, msg);
        }

        async function handleWarning (msg) {
          console.warn(`[TEST:SERVER] event "warning" - <${typeof msg}>`, msg);
        }

        async function handleError (msg) {
          console.error(`[TEST:SERVER] event "error" - <${typeof msg}>`, msg);
        }

        if (settings.debug) {
          client.on('message', handleClientMessage);
          client.on('warning', handleClientWarning);
          client.on('error', handleClientError);
          server.on('message', handleMessage);
          server.on('warning', handleWarning);
          server.on('error', handleError);
        }

        server.on('peer', async function handlePeer (peer) {
          await client.stop();
          await server.stop();

          assert.ok(server);
          assert.ok(client);

          done();
        });

        await server.start();
        await client.start();
      }

      test();
    });

    it('can recover a message', async function () {
      const port = await getFreePort();
      const peer = new Peer({ ...settings, port, peers: [], upnp: false, networking: false, peersDb: null });
      peers.push(peer);

      await peer.start();
      await peer.stop();

      assert.ok(peer);
    });

    describe('peer registry persistence guards', function () {
      it('skips scheduling registry save when stopping', async function () {
        const peer = new Peer({ ...settings, peersDb: 'stores/test-peers-guard-1', networking: false, listen: false });
        peer._state.status = 'STOPPING';
        peer._state.peers = { a: { id: 'a' } };

        let putCalls = 0;
        peer._peersDb = {
          status: 'open',
          put: async () => { putCalls++; }
        };

        peer._savePeerRegistry();
        await new Promise(resolve => setTimeout(resolve, 650));

        assert.strictEqual(putCalls, 0);
      });

      it('does not write when registry DB is not open', async function () {
        const peer = new Peer({ ...settings, peersDb: 'stores/test-peers-guard-2', networking: false, listen: false });
        peer._state.status = 'STARTED';
        peer._state.peers = { a: { id: 'a' } };

        let putCalls = 0;
        peer._peersDb = {
          status: 'closed',
          put: async () => { putCalls++; }
        };

        peer._savePeerRegistry();
        await new Promise(resolve => setTimeout(resolve, 650));

        assert.strictEqual(putCalls, 0);
      });

      it('suppresses transient "Database is not open" registry save errors', async function () {
        const peer = new Peer({ ...settings, peersDb: 'stores/test-peers-guard-3', networking: false, listen: false });
        peer._state.status = 'STARTED';
        peer._state.peers = { a: { id: 'a' } };

        const emittedErrors = [];
        peer.on('error', (msg) => emittedErrors.push(String(msg)));

        peer._peersDb = {
          status: 'open',
          put: async () => { throw new Error('Database is not open'); }
        };

        peer._savePeerRegistry();
        await new Promise(resolve => setTimeout(resolve, 650));

        assert.strictEqual(emittedErrors.length, 0);
      });
    });
  });
});
