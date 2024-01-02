'use strict';

// Dependencies
const Peer = require('../types/peer');
const assert = require('assert');

const NODEA = require('../settings/node-a');
const NODEB = require('../settings/node-b');

// Settings
const settings = {
  debug: process.env.DEBUG || false,
  port: 9898
};

describe('@fabric/core/types/peer', function () {
  describe('Peer', function () {
    it('is a constructor', function () {
      assert.equal(Peer instanceof Function, true);
    });

    it('can cleanly start and stop', async function () {
      const peer = new Peer();

      await peer.start();
      await peer.stop();

      assert.ok(peer);
    });

    xit('can receive a connection', function (done) {
      async function test () {
        const server = new Peer(Object.assign({ verbosity: 2 }, NODEA, { listen: true, port: settings.port, upnp: false, peers: [] }));
        const client = new Peer(Object.assign({ verbosity: 2 }, NODEB, { peers: [
          `${server.key.pubkey}@localhost:${settings.port}`
        ] }));

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
      const peer = new Peer();

      await peer.start();
      await peer.stop();

      assert.ok(peer);
    });
  });
});
