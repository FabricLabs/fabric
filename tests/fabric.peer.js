'use strict';

// Dependencies
const Peer = require('../types/peer');
const assert = require('assert');

// Settings
const settings = {
  port: 9898
};

describe('@fabric/core/types/peer', function () {
  describe('Peer', function () {
    it('is a constructor', function () {
      assert.equal(Peer instanceof Function, true);
    });

    it('can cleanly start and stop', async function () {
      let peer = new Peer();

      await peer.start();
      await peer.stop();

      assert.ok(peer);
    });

    it('can receive a connection', function (done) {
      async function test () {
        let server = new Peer({ listen: true, port: 9898 });
        let client = new Peer({ peers: ['localhost:9898'] });

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
  });
});
