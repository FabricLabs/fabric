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

    const msg = Message.fromVector(['P2P_CHAT_MESSAGE', 'secure-mesh']);
    msg.signWithKey(clientKey);

    let chat = null;
    hub.once('chat', (m) => { chat = m; });

    hub._handleFabricMessage(msg.toBuffer(), { name: addr }, null);

    assert.ok(chat);
    assert.strictEqual(chat.text, 'secure-mesh');
    assert.ok(relayWrites.length >= 1, 'relayFrom should write chat to non-origin edges');
  });

  it('rejects chat with a corrupted AMP signature', function () {
    const hub = mockHub();
    const author = new Key();
    const addr = '127.0.0.1:7400';
    hub.connections[addr] = { _writeFabric: () => {}, destroy: () => {} };
    hub.peers[addr] = { id: 'peer', publicKey: author.pubkey };

    const msg = Message.fromVector(['P2P_CHAT_MESSAGE', 'forged']);
    msg.signWithKey(author);
    // Flip a signature byte so AMP verify fails (author field still present).
    msg.raw.signature[0] ^= 0xff;

    let warned = false;
    hub.once('warning', (w) => {
      if (/Invalid message signature/i.test(String(w))) warned = true;
    });
    let chats = 0;
    hub.on('chat', () => { chats++; });

    hub._handleFabricMessage(msg.toBuffer(), { name: addr }, null);

    assert.ok(warned, 'expected warning for invalid AMP signature');
    assert.strictEqual(chats, 0, 'invalid signature must not dispatch chat');
  });

  it('rejects non-relayable frames when signer mismatches pinned peer key', function () {
    const hub = mockHub();
    const expectedSigner = new Key();
    const attacker = new Key();
    const addr = '127.0.0.1:7401';
    hub.connections[addr] = { _writeFabric: () => {}, destroy: () => {} };
    hub.peers[addr] = { id: 'victim', publicKey: expectedSigner.pubkey };

    // Inventory is mesh-relay-as-is (author may be a prior hop). Pin applies to local types.
    const msg = Message.fromVector(['P2P_DOCUMENT_PUBLISH', JSON.stringify({ id: 'doc', content: 'x' })]);
    msg.signWithKey(attacker);

    let warned = false;
    hub.once('warning', (w) => {
      if (/Signer mismatch/i.test(String(w))) warned = true;
    });
    let publishes = 0;
    hub.on('documentPublish', () => { publishes++; });
    hub.on('DocumentPublish', () => { publishes++; });

    hub._handleFabricMessage(msg.toBuffer(), { name: addr }, null);

    assert.ok(warned, 'expected signer mismatch for pinned non-relayable type');
    assert.strictEqual(publishes, 0, 'pinned mismatch must not dispatch document publish');
  });

  it('drops duplicate wire envelopes (reliable dedup for mesh floods)', function () {
    const hub = mockHub();
    const k = new Key();
    const addr = '127.0.0.1:7500';
    hub.connections[addr] = { _writeFabric: () => {}, destroy: () => {} };
    hub.peers[addr] = { id: 'p', publicKey: k.pubkey };

    const msg = Message.fromVector(['P2P_CHAT_MESSAGE', 'once']);
    msg.signWithKey(k);
    const buf = msg.toBuffer();

    let chats = 0;
    hub.on('chat', () => { chats++; });

    hub._handleFabricMessage(buf, { name: addr }, null);
    hub._handleFabricMessage(buf, { name: addr }, null);

    assert.strictEqual(chats, 1);
  });

  it('dispatches first-class P2P_PEER_GOSSIP over the wire (not P2P_BASE_MESSAGE fallback)', function () {
    const hub = mockHub();
    const author = new Key();
    const origin = '127.0.0.1:7650';
    const relayWrites = [];
    hub.connections[origin] = { _writeFabric: () => {}, destroy: () => {} };
    hub.connections['127.0.0.1:7651'] = {
      _writeFabric: (buf) => relayWrites.push(Buffer.isBuffer(buf) ? buf : Buffer.from(buf)),
      destroy: () => {}
    };
    hub.peers[origin] = { id: 'relay-peer', publicKey: hub.key.pubkey };

    const msg = Message.fromVector(['P2P_PEER_GOSSIP', JSON.stringify({
      host: '10.0.0.9',
      port: 9001,
      gossipHop: 3
    })]);
    msg.signWithKey(author);
    const original = msg.toBuffer();
    assert.strictEqual(msg.type, 'P2P_PEER_GOSSIP');

    let gossip = null;
    hub.once('peeringGossip', (e) => { gossip = e; });
    hub._handleFabricMessage(original, { name: origin }, null);

    assert.ok(gossip, 'expected peeringGossip from first-class wire frame');
    assert.ok(relayWrites.length >= 1, 'gossip should relay');
    assert.ok(relayWrites[0].equals(original), 'gossip relayed bit-identical');
  });

  it('relays first-class P2P_CHAT_MESSAGE frames bit-identical (no hop re-sign)', function () {
    const hub = mockHub();
    const author = new Key();
    const origin = '127.0.0.1:7700';
    const relayWrites = [];
    hub.connections[origin] = { _writeFabric: () => {}, destroy: () => {} };
    hub.connections['127.0.0.1:7701'] = {
      _writeFabric: (buf) => relayWrites.push(Buffer.isBuffer(buf) ? buf : Buffer.from(buf)),
      destroy: () => {}
    };
    // Pin is the TCP peer (Noise identity), not necessarily the message author.
    hub.peers[origin] = { id: 'relay-peer', publicKey: hub.key.pubkey };

    const msg = Message.fromVector(['P2P_CHAT_MESSAGE', 'as-is']);
    msg.signWithKey(author);
    const original = msg.toBuffer();

    hub._handleFabricMessage(original, { name: origin }, null);

    assert.ok(relayWrites.length >= 1, 'chat should relay to non-origin edge');
    assert.ok(relayWrites[0].equals(original), 'relay forwards original AMP bytes');
    const relayed = Message.fromBuffer(relayWrites[0]);
    assert.strictEqual(relayed.type, 'P2P_CHAT_MESSAGE', 'relay keeps first-class opcode');
    const relayedSigner = hub._verifiedFabricSignerPubkeyHex(relayed);
    const authorXOnly = author.pubkey.length === 66 ? author.pubkey.slice(2) : author.pubkey;
    assert.strictEqual(relayedSigner, authorXOnly, 'original author signature preserved');
    assert.strictEqual(relayed.raw.data.toString('utf8'), 'as-is', 'body is UTF-8 text');
  });

  it('relays CONTRACT_MESSAGE frames bit-identical (no hop re-sign)', function () {
    const hub = mockHub();
    const author = new Key();
    const origin = '127.0.0.1:7750';
    const relayWrites = [];
    hub.connections[origin] = { _writeFabric: () => {}, destroy: () => {} };
    hub.connections['127.0.0.1:7751'] = {
      _writeFabric: (buf) => relayWrites.push(Buffer.isBuffer(buf) ? buf : Buffer.from(buf)),
      destroy: () => {}
    };
    hub.peers[origin] = { id: 'relay-peer', publicKey: hub.key.pubkey };

    const msg = Message.fromVector(['CONTRACT_MESSAGE', JSON.stringify({
      contract: 'group-contract-id',
      type: 'GroupChat',
      object: { body: 'as-is-contract', author: author.pubkey }
    })]);
    msg.signWithKey(author);
    const original = msg.toBuffer();

    hub._handleFabricMessage(original, { name: origin }, null);

    assert.ok(relayWrites.length >= 1, 'CONTRACT_MESSAGE should relay to non-origin edge');
    assert.ok(relayWrites[0].equals(original), 'relay forwards original AMP bytes');
    const relayed = Message.fromBuffer(relayWrites[0]);
    assert.strictEqual(relayed.type, 'CONTRACT_MESSAGE');
    const relayedSigner = hub._verifiedFabricSignerPubkeyHex(relayed);
    const authorXOnly = author.pubkey.length === 66 ? author.pubkey.slice(2) : author.pubkey;
    assert.strictEqual(relayedSigner, authorXOnly, 'original author signature preserved');
  });

  it('CONTRACT_MESSAGE dispatches by namespace and does not crash on unknown contract id', function () {
    const hub = mockHub();
    const k = new Key();
    const origin = '127.0.0.1:7800';
    hub.connections[origin] = { _writeFabric: () => {}, destroy: () => {} };
    hub.connections['127.0.0.1:7801'] = { _writeFabric: () => {}, destroy: () => {} };
    hub.peers[origin] = { id: 'p', publicKey: k.pubkey };

    const events = [];
    hub.on('contract:message', (e) => events.push(e));

    const msg = Message.fromVector(['CONTRACT_MESSAGE', JSON.stringify({
      contract: 'unregistered-contract-id',
      type: 'MissionBroadcast',
      object: { mission: { id: 'm1' } }
    })]);
    msg.signWithKey(k);

    // Must not throw despite the contract not being registered locally.
    hub._handleFabricMessage(msg.toBuffer(), { name: origin }, null);

    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].contract, 'unregistered-contract-id');
    assert.strictEqual(events[0].registered, false);
  });

  it('CONTRACT_MESSAGE without a contract namespace is dropped with a warning', function () {
    const hub = mockHub();
    const k = new Key();
    const origin = '127.0.0.1:7850';
    hub.connections[origin] = { _writeFabric: () => {}, destroy: () => {} };
    hub.peers[origin] = { id: 'p', publicKey: k.pubkey };

    let warned = false;
    hub.once('warning', (w) => { if (/missing .*contract/i.test(String(w))) warned = true; });
    let events = 0;
    hub.on('contract:message', () => { events++; });

    const msg = Message.fromVector(['CONTRACT_MESSAGE', JSON.stringify({ type: 'X', object: {} })]);
    msg.signWithKey(k);
    hub._handleFabricMessage(msg.toBuffer(), { name: origin }, null);

    assert.ok(warned, 'expected warning for missing contract namespace');
    assert.strictEqual(events, 0);
  });

  it('CONTRACT_PUBLISH emits contract:publish with a deterministic id', function () {
    const hub = mockHub();
    const k = new Key();
    const origin = '127.0.0.1:7900';
    hub.connections[origin] = { _writeFabric: () => {}, destroy: () => {} };
    hub.peers[origin] = { id: 'p', publicKey: k.pubkey };

    let event = null;
    hub.once('contract:publish', (e) => { event = e; });

    const definition = { name: 'GoonCitizen', version: 1, state: {} };
    const msg = Message.fromVector(['CONTRACT_PUBLISH', JSON.stringify(definition)]);
    msg.signWithKey(k);
    hub._handleFabricMessage(msg.toBuffer(), { name: origin }, null);

    assert.ok(event, 'expected contract:publish');
    assert.ok(event.contract && /^[0-9a-f]{64}$/.test(event.contract), 'deterministic Actor id');
  });

  it('CONTRACT_PROPOSAL verifies payload and emits contract:proposal', function () {
    const hub = mockHub();
    const k = new Key();
    const origin = '127.0.0.1:7950';
    hub.connections[origin] = { _writeFabric: () => {}, destroy: () => {} };
    hub.peers[origin] = { id: 'p', publicKey: k.pubkey };

    const { createContractProposalMessage } = require('../functions/contractProposal');
    const inner = Message.fromVector(['P2P_BASE_MESSAGE', JSON.stringify({ type: 'Accept', object: { n: 1 } })]);
    inner.signWithKey(k);
    const proposal = createContractProposalMessage(k, { messages: [inner], contractId: 'goon-contract' });

    let event = null;
    hub.once('contract:proposal', (e) => { event = e; });

    hub._handleFabricMessage(proposal.toBuffer(), { name: origin }, null);

    assert.ok(event, 'expected contract:proposal');
    assert.strictEqual(event.contract, 'goon-contract');
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
