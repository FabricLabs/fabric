'use strict';

/**
 * Peer + Message integration tests for multi-connection meshes.
 *
 * Downstream apps (hubs, relays, mesh gateways) rely on:
 * - Fan-out: {@link Peer#broadcast} / {@link Peer#relayFrom} to all edges except origin
 * - Wire integrity: double-SHA256 body hash + optional pubkey signature verification
 * - Dedup: same wire bytes are not processed twice ({@link Peer#messages})
 *
 * These tests use mocked TCP edges (`_writeFabric`) so CI stays deterministic without a full network.
 */

const assert = require('assert');
const crypto = require('crypto');
const Peer = require('../types/peer');
const Message = require('../types/message');
const Key = require('../types/key');

describe('peer/message integration (mesh & secure delivery)', function () {
  this.timeout(60000);

  const peers = [];

  after(async function () {
    for (const p of peers) {
      try {
        if (p && typeof p.stop === 'function') await p.stop();
      } catch (e) {
        console.warn('[TEST:CLEANUP]', e.message);
      }
    }
    peers.length = 0;
  });

  function mockHub (name = 'hub') {
    const hub = new Peer({ listen: false, peersDb: null, networking: false });
    peers.push(hub);
    return hub;
  }

  function wireMock (writes) {
    return {
      _writeFabric: (buf) => {
        writes.push(Buffer.isBuffer(buf) ? buf : Buffer.from(buf));
      },
      destroy: () => {}
    };
  }

  it('broadcast fans out to all connections except origin (large mesh)', function () {
    const hub = mockHub();
    const n = 8;
    const received = {};
    for (let i = 0; i < n; i++) {
      const id = `127.0.0.1:${7000 + i}`;
      received[id] = 0;
      hub.connections[id] = {
        _writeFabric: (buf) => { received[id]++; },
        destroy: () => {}
      };
    }

    const origin = '127.0.0.1:7003';
    const payload = Buffer.from('mesh-fanout');
    hub.broadcast(payload, origin);

    let total = 0;
    for (const id of Object.keys(received)) {
      if (id === origin) {
        assert.strictEqual(received[id], 0, `origin ${id} must not receive own broadcast`);
      } else {
        assert.strictEqual(received[id], 1, `edge ${id} must receive broadcast`);
        total++;
      }
    }
    assert.strictEqual(total, n - 1);
  });

  it('relayFrom forwards signed buffers to every edge except origin', function () {
    const hub = mockHub();
    const signer = new Key();
    const edges = ['127.0.0.1:7100', '127.0.0.1:7101', '127.0.0.1:7102'];
    const written = {};
    for (const id of edges) {
      written[id] = 0;
      hub.connections[id] = {
        _writeFabric: () => { written[id]++; },
        destroy: () => {}
      };
    }

    const inner = Message.fromVector(['GenericMessage', JSON.stringify({
      type: 'P2P_CHAT_MESSAGE',
      object: { text: 'relay-test' }
    })]);
    inner.signWithKey(signer);

    const origin = edges[0];
    hub.relayFrom(origin, inner);

    assert.strictEqual(written[origin], 0);
    assert.strictEqual(written[edges[1]], 1);
    assert.strictEqual(written[edges[2]], 1);
  });

  it('P2P_RELAY envelopes are relayed to other edges', function () {
    const hub = mockHub();
    const k = new Key();
    const a = '127.0.0.1:7200';
    const b = '127.0.0.1:7201';
    const c = '127.0.0.1:7202';

    let bGot = 0;
    let cGot = 0;
    hub.connections[a] = wireMock([]);
    hub.connections[b] = { _writeFabric: () => { bGot++; }, destroy: () => {} };
    hub.connections[c] = { _writeFabric: () => { cGot++; }, destroy: () => {} };

    hub.peers[a] = { id: 'id-a', publicKey: k.pubkey };

    const relay = Message.fromVector(['P2P_RELAY', JSON.stringify({ hop: 1, payload: 'test' })]);
    relay.signWithKey(k);

    hub._handleFabricMessage(relay.toBuffer(), { name: a }, null);

    assert.strictEqual(bGot, 1);
    assert.strictEqual(cGot, 1);
  });

  it('accepts signed chat from known pubkey and relays to mesh', function () {
    const hub = mockHub();
    const clientKey = new Key();
    const addr = '127.0.0.1:7300';
    const relayWrites = [];
    hub.connections[addr] = { _writeFabric: () => {}, destroy: () => {} };
    hub.connections['127.0.0.1:7301'] = {
      _writeFabric: (m) => relayWrites.push(m),
      destroy: () => {}
    };
    hub.peers[addr] = { id: 'client', publicKey: clientKey.pubkey };

    const content = { type: 'P2P_CHAT_MESSAGE', object: { text: 'secure-mesh' } };
    const msg = Message.fromVector(['GenericMessage', JSON.stringify(content)]);
    msg.signWithKey(clientKey);

    let chat = null;
    hub.once('chat', (m) => { chat = m; });

    hub._handleFabricMessage(msg.toBuffer(), { name: addr }, null);

    assert.ok(chat);
    assert.strictEqual(chat.object.text, 'secure-mesh');
    assert.ok(relayWrites.length >= 1, 'relayFrom should write ChatMessage to non-origin edges');
  });

  it('rejects messages with invalid signature when sender pubkey is known', function (done) {
    const hub = mockHub();
    const expectedSigner = new Key();
    const attacker = new Key();
    const addr = '127.0.0.1:7400';
    hub.connections[addr] = { _writeFabric: () => {}, destroy: () => {} };
    hub.peers[addr] = { id: 'victim', publicKey: expectedSigner.pubkey };

    const content = { type: 'P2P_CHAT_MESSAGE', object: { text: 'forged' } };
    const msg = Message.fromVector(['GenericMessage', JSON.stringify(content)]);
    msg.signWithKey(attacker);

    hub.once('error', (err) => {
      assert.ok(String(err).includes('Invalid') || String(err).includes('signature'), String(err));
      done();
    });

    hub._handleFabricMessage(msg.toBuffer(), { name: addr }, null);
  });

  it('drops duplicate wire envelopes (reliable dedup for mesh floods)', function () {
    const hub = mockHub();
    const k = new Key();
    const addr = '127.0.0.1:7500';
    hub.connections[addr] = { _writeFabric: () => {}, destroy: () => {} };
    hub.peers[addr] = { id: 'p', publicKey: k.pubkey };

    const content = { type: 'P2P_CHAT_MESSAGE', object: { text: 'once' } };
    const msg = Message.fromVector(['GenericMessage', JSON.stringify(content)]);
    msg.signWithKey(k);
    const buf = msg.toBuffer();

    let chats = 0;
    hub.on('chat', () => { chats++; });

    hub._handleFabricMessage(buf, { name: addr }, null);
    hub._handleFabricMessage(buf, { name: addr }, null);

    assert.strictEqual(chats, 1);
  });

  it('rejects body hash mismatch before signature (downstream integrity)', function () {
    const hub = mockHub();
    const k = new Key();
    const addr = '127.0.0.1:7600';
    hub.connections[addr] = { _writeFabric: () => {}, destroy: () => {} };
    hub.peers[addr] = { id: 'p', publicKey: k.pubkey };

    const msg = Message.fromVector(['GenericMessage', JSON.stringify({
      type: 'P2P_CHAT_MESSAGE',
      object: { text: 'x' }
    })]);
    msg.signWithKey(k);
    const buf = msg.toBuffer();

    const origFromBuffer = Message.fromBuffer;
    Message.fromBuffer = (b) => {
      const m = origFromBuffer(b);
      m.raw.hash = Buffer.alloc(32, 1);
      return m;
    };
    try {
      assert.throws(
        () => hub._handleFabricMessage(buf, { name: addr }, null),
        /incorrect hash/
      );
    } finally {
      Message.fromBuffer = origFromBuffer;
    }
  });
});
