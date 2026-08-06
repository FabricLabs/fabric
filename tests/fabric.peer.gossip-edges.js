'use strict';

const assert = require('assert');
const crypto = require('crypto');
const { describe, it } = require('mocha');

const Message = require('../types/message');
const Peer = require('../types/peer');
const Key = require('../types/key');
const Hash256 = require('../types/hash256');

describe('@fabric/core Peer gossip / peering / integrity edges', function () {
  function offlinePeer (overrides = {}) {
    return new Peer(Object.assign({
      listen: false,
      networking: false,
      peersDb: null,
      upnp: false,
      peers: [],
      debug: false
    }, overrides));
  }

  describe('P2P_PEER_GOSSIP hop & origin edges', function () {
    it('treats NaN / negative / Infinity gossipHop as maxHops (still relays once)', function () {
      for (const gossipHop of [NaN, -3, Infinity, 'nope']) {
        const peer = offlinePeer({ gossip: { maxHops: 3, maxRelaysPerOriginPerMinute: 10 } });
        let relays = 0;
        peer.relayFrom = function () { relays++; };
        const object = { host: '1.1.1.1', port: 9, gossipHop, tag: String(gossipHop) };
        const wire = Message.fromVector(['P2P_PEER_GOSSIP', JSON.stringify(object)]).signWithKey(peer.key);
        peer._handleGenericMessage({ type: 'P2P_PEER_GOSSIP', object }, { name: 'o:1' }, null, wire);
        assert.strictEqual(relays, 1, `expected relay for gossipHop=${String(gossipHop)}`);
      }
    });

    it('accepts numeric string hop and clamps above maxHops', function () {
      const peer = offlinePeer({ gossip: { maxHops: 2 } });
      let relays = 0;
      peer.relayFrom = function () { relays++; };
      const object = { host: '2.2.2.2', port: 9, gossipHop: '99' };
      const wire = Message.fromVector(['P2P_PEER_GOSSIP', JSON.stringify(object)]).signWithKey(peer.key);
      peer._handleGenericMessage({ type: 'P2P_PEER_GOSSIP', object }, { name: 'o:2' }, null, wire);
      assert.strictEqual(relays, 1);
    });

    it('dedupes logical payload even when gossipHop differs', function () {
      const peer = offlinePeer();
      let relays = 0;
      peer.relayFrom = function () { relays++; };
      const origin = { name: 'o:dedupe' };
      const base = { host: '8.8.8.8', port: 53 };
      for (const gossipHop of [5, 4, 1]) {
        const object = { ...base, gossipHop };
        const wire = Message.fromVector(['P2P_PEER_GOSSIP', JSON.stringify(object)]).signWithKey(peer.key);
        peer._handleGenericMessage({ type: 'P2P_PEER_GOSSIP', object }, origin, null, wire);
      }
      assert.strictEqual(relays, 1);
    });

    it('does not relay when origin is missing or nameless (no crash)', function () {
      const peer = offlinePeer();
      let relays = 0;
      peer.relayFrom = function () { relays++; };
      const object = { host: '9.9.9.9', port: 1 };
      const wire = Message.fromVector(['P2P_PEER_GOSSIP', JSON.stringify(object)]).signWithKey(peer.key);
      assert.doesNotThrow(() => {
        peer._handleGenericMessage({ type: 'P2P_PEER_GOSSIP', object }, null, null, wire);
        peer._handleGenericMessage({ type: 'P2P_PEER_GOSSIP', object }, {}, null, wire);
      });
      assert.strictEqual(relays, 0);
    });

    it('emits peeringGossip for valid frames', function () {
      const peer = offlinePeer();
      let seen = 0;
      peer.on('peeringGossip', () => { seen++; });
      peer.relayFrom = function () {};
      const object = { host: '3.3.3.3', port: 7 };
      const wire = Message.fromVector(['P2P_PEER_GOSSIP', JSON.stringify(object)]).signWithKey(peer.key);
      peer._handleGenericMessage({ type: 'P2P_PEER_GOSSIP', object }, { name: 'o:ev' }, null, wire);
      assert.strictEqual(seen, 1);
    });
  });

  describe('P2P_PEERING_OFFER hop & rate edges', function () {
    it('treats NaN / negative peeringHop as maxHops and still relays once', function () {
      for (const peeringHop of [NaN, -2, Infinity]) {
        const peer = offlinePeer({ peering: { maxHops: 3, maxRelaysPerOriginPerMinute: 10 } });
        let relays = 0;
        peer.relayFrom = function () { relays++; };
        const object = { host: '1.2.3.4', port: 9, transport: 'fabric', peeringHop, tag: String(peeringHop) };
        const wire = Message.fromVector(['P2P_PEERING_OFFER', JSON.stringify(object)]).signWithKey(peer.key);
        peer._handleGenericMessage({ type: 'P2P_PEERING_OFFER', object }, { name: 'o:ph' }, null, wire);
        assert.strictEqual(relays, 1, `expected relay for peeringHop=${String(peeringHop)}`);
      }
    });

    it('enforces peering rate limit without enqueue after budget exhausted', function () {
      const peer = offlinePeer({
        peering: { maxRelaysPerOriginPerMinute: 1, maxCandidates: 8 },
        constraints: { peers: { max: 32 } }
      });
      peer.relayFrom = function () {};
      const author = new Key();
      for (let i = 0; i < 3; i++) {
        const object = {
          host: `10.4.4.${i}`,
          port: 7777,
          transport: 'fabric',
          peeringHop: 5
        };
        const wire = Message.fromVector(['P2P_PEERING_OFFER', JSON.stringify(object)]).signWithKey(author);
        peer._handleGenericMessage({ type: 'P2P_PEERING_OFFER', object }, { name: 'o:pr' }, null, wire);
      }
      assert.strictEqual(peer.candidates.length, 1);
    });
  });

  describe('P2P_PEERING_OFFER candidate edges', function () {
    it('skips candidate enqueue when transport is not fabric', function () {
      const peer = offlinePeer({ constraints: { peers: { max: 32 } } });
      peer.relayFrom = function () {};
      const object = { host: '10.0.0.9', port: 7777, transport: 'webrtc' };
      const wire = Message.fromVector(['P2P_PEERING_OFFER', JSON.stringify(object)]).signWithKey(peer.key);
      peer._handleGenericMessage({ type: 'P2P_PEERING_OFFER', object }, { name: 'o:w' }, null, wire);
      assert.strictEqual(peer.candidates.length, 0);
    });

    it('skips candidate enqueue when peer slots are full', function () {
      const peer = offlinePeer({ constraints: { peers: { max: 1 } } });
      peer.connections = { 'busy:1': {} };
      peer.relayFrom = function () {};
      const object = { host: '10.0.0.10', port: 7777, transport: 'fabric' };
      const wire = Message.fromVector(['P2P_PEERING_OFFER', JSON.stringify(object)]).signWithKey(peer.key);
      peer._handleGenericMessage({ type: 'P2P_PEERING_OFFER', object }, { name: 'o:full' }, null, wire);
      assert.strictEqual(peer.candidates.length, 0);
    });

    it('dedupes candidates by host:port across different origins', function () {
      const peer = offlinePeer({ peering: { maxCandidates: 8 } });
      peer.relayFrom = function () {};
      const object = { host: '10.1.1.1', port: 1111, transport: 'fabric' };
      for (let i = 0; i < 3; i++) {
        const wire = Message.fromVector(['P2P_PEERING_OFFER', JSON.stringify({
          ...object,
          peeringHop: 5 - i
        })]).signWithKey(peer.key);
        peer._handleGenericMessage(
          { type: 'P2P_PEERING_OFFER', object: { ...object, peeringHop: 5 - i } },
          { name: `o:${i}` },
          null,
          wire
        );
      }
      assert.strictEqual(peer.candidates.length, 1);
      assert.strictEqual(peer.candidates[0].host, '10.1.1.1');
    });

    it('ignores offers missing host or port for candidate queue', function () {
      const peer = offlinePeer();
      peer.relayFrom = function () {};
      for (const object of [
        { port: 1, transport: 'fabric' },
        { host: '10.0.0.1', transport: 'fabric' },
        { host: '', port: 2, transport: 'fabric' }
      ]) {
        const wire = Message.fromVector(['P2P_PEERING_OFFER', JSON.stringify(object)]).signWithKey(peer.key);
        peer._handleGenericMessage({ type: 'P2P_PEERING_OFFER', object }, { name: 'o:bad' }, null, wire);
      }
      assert.strictEqual(peer.candidates.length, 0);
    });
  });

  describe('wire integrity & session edges', function () {
    it('drops frames with tampered body hash and emits warning', function () {
      const peer = offlinePeer({ debug: true });
      const warnings = [];
      peer.on('warning', (w) => warnings.push(String(w)));
      const msg = Message.fromVector(['P2P_PING', JSON.stringify({ t: 1 })]).signWithKey(peer.key);
      const buf = Buffer.from(msg.toBuffer());
      // Corrupt a body byte after the 208-byte header when body exists; else flip hash.
      if (buf.length > 208) {
        buf[208] = buf[208] ^ 0xff;
      } else {
        buf[80] = buf[80] ^ 0xff;
      }
      const origin = { name: '127.0.0.1:hash' };
      peer._handleFabricMessage(buf, origin, null);
      assert.ok(warnings.some((w) => /body hash mismatch/i.test(w)));
    });

    it('drops frames with invalid signature', function () {
      const peer = offlinePeer();
      const warnings = [];
      peer.on('warning', (w) => warnings.push(String(w)));
      const other = new Key();
      const msg = Message.fromVector(['P2P_PING', JSON.stringify({ t: 2 })]).signWithKey(other.key || other);
      // Zero the signature while keeping a matching body hash.
      const buf = Buffer.from(msg.toBuffer());
      buf.fill(0, 144, 208);
      peer._handleFabricMessage(buf, { name: '127.0.0.1:sig' }, null);
      assert.ok(warnings.some((w) => /Invalid message signature/i.test(w)));
    });

    it('drops signer-mismatched non-relay messages against pinned peer key', function () {
      const peer = offlinePeer();
      const warnings = [];
      peer.on('warning', (w) => warnings.push(String(w)));
      const pinned = new Key();
      const author = new Key();
      const originName = '127.0.0.1:pin';
      peer.peers[originName] = { publicKey: pinned.pubkey };
      const msg = Message.fromVector(['P2P_PING', JSON.stringify({ t: 3 })]).signWithKey(author);
      peer._handleFabricMessage(msg.toBuffer(), { name: originName }, null);
      assert.ok(warnings.some((w) => /Signer mismatch/i.test(w)));
    });

    it('ignores unsolicited P2P_PONG (no outstanding ping)', function () {
      const peer = offlinePeer({ debug: true });
      const originName = '127.0.0.1:pong';
      peer.connections[originName] = { _fabricPingOutstanding: 0 };
      // Minimal actor plumbing used by pong handler — should not throw.
      const actorStub = { id: peer.key.pubkey };
      peer.actors = peer.actors || {};
      if (!peer.actors[actorStub.id]) {
        const Actor = require('../types/actor');
        peer.actors[actorStub.id] = new Actor({ id: actorStub.id, score: 0 });
      }
      assert.doesNotThrow(() => {
        peer._handleGenericMessage(
          { type: 'P2P_PONG', object: {} },
          { name: originName },
          null,
          null
        );
      });
    });

    it('Hash256.doubleDigest matches Bitcoin-style SHA256(SHA256(body))', function () {
      const body = Buffer.from('integrity-probe');
      const once = crypto.createHash('sha256').update(body).digest();
      const twice = crypto.createHash('sha256').update(once).digest('hex');
      assert.strictEqual(Hash256.doubleDigest(body), twice);
    });
  });
});
