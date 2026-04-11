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

    const inner = Message.fromVector(['P2P_BASE_MESSAGE', JSON.stringify({
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

    const bWrites = [];
    const cWrites = [];
    hub.connections[a] = wireMock([]);
    hub.connections[b] = { _writeFabric: (buf) => { bWrites.push(buf); }, destroy: () => {} };
    hub.connections[c] = { _writeFabric: (buf) => { cWrites.push(buf); }, destroy: () => {} };

    hub.peers[a] = { id: 'id-a', publicKey: k.pubkey };

    const inner = Message.fromVector(['P2P_BASE_MESSAGE', JSON.stringify({
      type: 'P2P_CHAT_MESSAGE',
      object: { text: 'relayed' }
    })]);
    inner.signWithKey(k);
    const relay = Message.fromVector(['P2P_RELAY', inner.toBuffer()]);
    relay.signWithKey(k);

    hub._handleFabricMessage(relay.toBuffer(), { name: a }, null);

    assert.ok(bWrites.length >= 1);
    assert.ok(cWrites.length >= 1);
    assert.ok(bWrites.some((buf) => Message.fromBuffer(buf).type === 'P2P_RELAY'));
    assert.ok(cWrites.some((buf) => Message.fromBuffer(buf).type === 'P2P_RELAY'));
  });

  it('P2P_RELAY body carries raw relayed message bytes', function () {
    const hub = mockHub();
    const k = new Key();
    const a = '127.0.0.1:7250';
    const bWrites = [];
    hub.connections[a] = wireMock([]);
    hub.connections['127.0.0.1:7251'] = {
      _writeFabric: (buf) => bWrites.push(buf),
      destroy: () => {}
    };
    hub.peers[a] = { id: 'id-a', publicKey: k.pubkey };

    const inner = Message.fromVector(['P2P_BASE_MESSAGE', JSON.stringify({
      type: 'P2P_CHAT_MESSAGE',
      object: { text: 'raw-relay' }
    })]);
    inner.signWithKey(k);
    const relay = Message.fromVector(['P2P_RELAY', inner.toBuffer()]);
    relay.signWithKey(k);

    hub._handleFabricMessage(relay.toBuffer(), { name: a }, null);

    assert.ok(bWrites.length >= 1);
    const relayBuffer = bWrites.find((buf) => Message.fromBuffer(buf).type === 'P2P_RELAY');
    assert.ok(relayBuffer, 'expected relayed P2P_RELAY wire');
    const outer = Message.fromBuffer(relayBuffer);
    assert.strictEqual(outer.type, 'P2P_RELAY');
    const relayedInner = Message.fromBuffer(outer.raw.data);
    assert.strictEqual(relayedInner.type, 'P2P_BASE_MESSAGE');
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
    const msg = Message.fromVector(['P2P_BASE_MESSAGE', JSON.stringify(content)]);
    msg.signWithKey(clientKey);

    let chat = null;
    hub.once('chat', (m) => { chat = m; });

    hub._handleFabricMessage(msg.toBuffer(), { name: addr }, null);

    assert.ok(chat);
    assert.strictEqual(chat.object.text, 'secure-mesh');
    assert.ok(relayWrites.length >= 1, 'relayFrom should write ChatMessage to non-origin edges');
  });

  it('rejects messages with invalid signature when sender pubkey is known', function () {
    const hub = mockHub();
    const expectedSigner = new Key();
    const attacker = new Key();
    const addr = '127.0.0.1:7400';
    hub.connections[addr] = { _writeFabric: () => {}, destroy: () => {} };
    hub.peers[addr] = { id: 'victim', publicKey: expectedSigner.pubkey };

    const content = { type: 'P2P_CHAT_MESSAGE', object: { text: 'forged' } };
    const msg = Message.fromVector(['P2P_BASE_MESSAGE', JSON.stringify(content)]);
    msg.signWithKey(attacker);

    let warned = false;
    hub.once('warning', (w) => {
      const s = String(w);
      if (/Invalid message signature|signature|Signer mismatch/i.test(s)) warned = true;
    });
    let chats = 0;
    hub.on('chat', () => { chats++; });

    hub._handleFabricMessage(msg.toBuffer(), { name: addr }, null);

    assert.ok(warned, 'expected warning when signature does not match stored peer pubkey');
    assert.strictEqual(chats, 0, 'forged P2P_BASE_MESSAGE must not dispatch chat');
  });

  it('drops duplicate wire envelopes (reliable dedup for mesh floods)', function () {
    const hub = mockHub();
    const k = new Key();
    const addr = '127.0.0.1:7500';
    hub.connections[addr] = { _writeFabric: () => {}, destroy: () => {} };
    hub.peers[addr] = { id: 'p', publicKey: k.pubkey };

    const content = { type: 'P2P_CHAT_MESSAGE', object: { text: 'once' } };
    const msg = Message.fromVector(['P2P_BASE_MESSAGE', JSON.stringify(content)]);
    msg.signWithKey(k);
    const buf = msg.toBuffer();

    let chats = 0;
    hub.on('chat', () => { chats++; });

    hub._handleFabricMessage(buf, { name: addr }, null);
    hub._handleFabricMessage(buf, { name: addr }, null);

    assert.strictEqual(chats, 1);
  });

  it('drops body hash mismatch before signature (wire integrity warning)', function () {
    const hub = mockHub();
    const k = new Key();
    const addr = '127.0.0.1:7600';
    hub.connections[addr] = { _writeFabric: () => {}, destroy: () => {} };
    hub.peers[addr] = { id: 'p', publicKey: k.pubkey };

    const msg = Message.fromVector(['P2P_BASE_MESSAGE', JSON.stringify({
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
      let warned = false;
      hub.once('warning', (w) => {
        if (/body hash mismatch/i.test(String(w))) warned = true;
      });
      hub._handleFabricMessage(buf, { name: addr }, null);
      assert.ok(warned, 'expected warning when body hash does not match payload (signature not verified)');
    } finally {
      Message.fromBuffer = origFromBuffer;
    }
  });
});
