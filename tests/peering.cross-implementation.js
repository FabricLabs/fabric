'use strict';

/**
 * Basic peering tests across implementations.
 * Validates wire-format compatibility and JS↔JS message exchange.
 */
const assert = require('assert');
const net = require('net');
const Peer = require('../types/peer');
const Message = require('../types/message');
const Key = require('../types/key');

const settings = {
  debug: process.env.DEBUG || false,
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

describe('peering (cross-implementation)', function () {
  this.timeout(30000);

  const peers = [];

  after(async function () {
    for (const peer of peers) {
      try {
        if (peer && typeof peer.stop === 'function') {
          await peer.stop();
        }
      } catch (err) {
        console.warn('[TEST:CLEANUP]', err.message);
      }
    }
    peers.length = 0;
  });

  describe('wire format', function () {
    it('round-trips: Message → toBuffer → fromBuffer → verify', function () {
      const signer = new Key();
      const content = { type: 'GenericMessage', object: { greeting: 'hello' } };
      const msg = Message.fromVector(['GenericMessage', JSON.stringify(content)]);
      msg.signWithKey(signer);

      const buf = msg.toBuffer();
      assert.ok(Buffer.isBuffer(buf), 'toBuffer returns Buffer');
      assert.ok(buf.length >= 208, 'wire format has 208-byte header');

      const restored = Message.fromBuffer(buf);
      assert.strictEqual(restored.data, msg.data);
      assert.strictEqual(restored.raw.hash.toString('hex'), msg.raw.hash.toString('hex'));

      assert.ok(restored.verifyWithKey(signer), 'restored message verifies');
    });

    it('body hash (double-SHA256) is consistent across serialize/parse', function () {
      const body = '{"test":true}';
      const msg = Message.fromVector(['GenericMessage', body]);
      msg.signWithKey(new Key());

      const hashBefore = msg.raw.hash.toString('hex');
      const buf = msg.toBuffer();
      const restored = Message.fromBuffer(buf);
      const hashAfter = restored.raw.hash.toString('hex');

      assert.strictEqual(hashBefore, hashAfter, 'body hash preserved across round-trip');
    });
  });

  describe('JS ↔ JS message handling', function () {
    it('server parses and handles GenericMessage from wire buffer (simulates C→JS or JS→JS)', function () {
      const server = new Peer({ listen: false, peersDb: null });
      const clientKey = new Key();
      const connAddress = '127.0.0.1:9999';

      server.connections[connAddress] = { _writeFabric: () => {}, destroy: () => {} };
      server.peers[connAddress] = { id: 'client-1', publicKey: clientKey.pubkey };

      const content = { type: 'P2P_CHAT_MESSAGE', object: { text: 'hello from wire' } };
      const msg = Message.fromVector(['GenericMessage', JSON.stringify(content)]);
      msg.signWithKey(clientKey);

      let chatReceived = null;
      server.once('chat', (m) => { chatReceived = m; });

      server._handleFabricMessage(msg.toBuffer(), { name: connAddress }, null);

      assert.ok(chatReceived);
      assert.strictEqual(chatReceived.object.text, 'hello from wire');
      peers.push(server);
    });

    it('server verifies signature on received message', function () {
      const server = new Peer({ listen: false, peersDb: null });
      const clientKey = new Key();
      const connAddress = '127.0.0.1:9999';

      server.connections[connAddress] = { _writeFabric: () => {}, destroy: () => {} };
      server.peers[connAddress] = { id: 'client-1', publicKey: clientKey.pubkey };

      const content = { type: 'P2P_CHAT_MESSAGE', object: { text: 'signed' } };
      const msg = Message.fromVector(['GenericMessage', JSON.stringify(content)]);
      msg.signWithKey(clientKey);

      let chatReceived = null;
      server.once('chat', (m) => { chatReceived = m; });

      server._handleFabricMessage(msg.toBuffer(), { name: connAddress }, null);

      assert.ok(chatReceived);
      const restored = Message.fromBuffer(msg.toBuffer());
      assert.ok(restored.verifyWithKey(new Key({ public: clientKey.pubkey })));
      peers.push(server);
    });

    it('rejects message with incorrect body hash (wire integrity)', function () {
      const peer = new Peer({ listen: false, peersDb: null });
      const msg = Message.fromVector(['GenericMessage', JSON.stringify({ type: 'P2P_CHAT_MESSAGE', object: { text: 'x' } })]);
      msg.signWithKey(peer.key);
      const buf = msg.toBuffer();

      const origFromBuffer = Message.fromBuffer;
      Message.fromBuffer = (b) => {
        const m = origFromBuffer(b);
        m.raw.hash = Buffer.alloc(32, 0); // wrong hash so checksum fails
        return m;
      };
      try {
        assert.throws(
          () => peer._handleFabricMessage(buf, { name: 'x' }, null),
          /incorrect hash/
        );
      } finally {
        Message.fromBuffer = origFromBuffer;
      }
      peers.push(peer);
    });
  });
});
