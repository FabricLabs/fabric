'use strict';

/**
 * Production gossip / peering network flows.
 *
 * Exercises the full wire path ({@link Peer#_handleFabricMessage}) for
 * {@link P2P_PEER_GOSSIP} and {@link P2P_PEERING_OFFER}: bit-identical mesh
 * fan-out, logical dedup, per-origin budgets, FIFO caches, hop=0, RELAY-as-is
 * consistency, and independence from chat / alias / onion side-channels.
 *
 * These mirror the SECURITY.md amplification controls operators rely on in
 * production hubs and mesh relays.
 */

const assert = require('assert');
const { describe, it } = require('mocha');

const Key = require('../types/key');
const Message = require('../types/message');
const Peer = require('../types/peer');
const {
  GOSSIP_MAX_HOPS,
  GOSSIP_MAX_RELAYS_PER_ORIGIN_PER_MINUTE,
  PEERING_OFFER_MAX_HOPS,
  PEERING_OFFER_MAX_RELAYS_PER_ORIGIN_PER_MINUTE,
  PEER_MAX_CANDIDATES_QUEUE
} = require('../constants');
const { offlinePeerSettings } = require('./helpers/peer');
const { wrapOnionPath, xOnlyFromKey } = require('../functions/fabricOnion');

describe('@fabric/core Peer gossip / peering production network', function () {
  this.timeout(30000);

  function offlinePeer (overrides = {}) {
    return new Peer(offlinePeerSettings(overrides));
  }

  function wireConn (writes) {
    return {
      _writeFabric (buf) { writes.push(Buffer.isBuffer(buf) ? buf : Buffer.from(buf)); },
      destroy () { this.destroyed = true; },
      destroyed: false
    };
  }

  function meshPeer (edgeCount, overrides = {}) {
    const peer = offlinePeer(overrides);
    const edges = {};
    for (let i = 0; i < edgeCount; i++) {
      const addr = `127.0.0.1:${8100 + i}`;
      const writes = [];
      peer.connections[addr] = wireConn(writes);
      peer.peers[addr] = { id: `e${i}`, publicKey: new Key().pubkey };
      edges[addr] = writes;
    }
    return { peer, edges };
  }

  function signGossip (key, object) {
    return Message.fromVector(['P2P_PEER_GOSSIP', JSON.stringify(object)]).signWithKey(key);
  }

  function signOffer (key, object) {
    return Message.fromVector(['P2P_PEERING_OFFER', JSON.stringify(object)]).signWithKey(key);
  }

  describe('constants align with SECURITY.md defaults', function () {
    it('exports production gossip / peering budgets', function () {
      assert.strictEqual(GOSSIP_MAX_HOPS, 5);
      assert.strictEqual(GOSSIP_MAX_RELAYS_PER_ORIGIN_PER_MINUTE, 60);
      assert.strictEqual(PEERING_OFFER_MAX_HOPS, 5);
      assert.strictEqual(PEERING_OFFER_MAX_RELAYS_PER_ORIGIN_PER_MINUTE, 60);
      assert.strictEqual(PEER_MAX_CANDIDATES_QUEUE, 128);
    });
  });

  describe('P2P_PEER_GOSSIP wire mesh', function () {
    it('fans out bit-identical gossip to every edge except origin', function () {
      const { peer, edges } = meshPeer(4, {
        gossip: { maxRelaysPerOriginPerMinute: 30 }
      });
      const author = new Key();
      const origin = '127.0.0.1:8100';
      peer.peers[origin] = { publicKey: author.pubkey };

      const object = { host: '198.51.100.1', port: 7777, gossipHop: 5, nonce: 'g1' };
      const msg = signGossip(author, object);
      const wire = msg.toBuffer();
      const events = [];
      peer.on('peeringGossip', (d) => events.push(d));

      peer._handleFabricMessage(wire, { name: origin }, null);

      assert.strictEqual(events.length, 1);
      for (const [addr, writes] of Object.entries(edges)) {
        if (addr === origin) {
          assert.strictEqual(writes.length, 0, 'origin must not receive echo');
        } else {
          assert.strictEqual(writes.length, 1, `${addr} must receive gossip`);
          assert.ok(wire.equals(writes[0]), 'mesh forward must be bit-identical');
          assert.strictEqual(Message.fromBuffer(writes[0]).type, 'P2P_PEER_GOSSIP');
        }
      }
    });

    it('does not decrement advisory gossipHop on relay (bit-identical)', function () {
      const { peer, edges } = meshPeer(2);
      const author = new Key();
      const origin = '127.0.0.1:8100';
      peer.peers[origin] = { publicKey: author.pubkey };
      const object = { host: '198.51.100.2', port: 7777, gossipHop: 4, tag: 'hop-keep' };
      const wire = signGossip(author, object).toBuffer();
      peer._handleFabricMessage(wire, { name: origin }, null);

      const fwd = edges['127.0.0.1:8101'][0];
      const parsed = JSON.parse(Message.fromBuffer(fwd).data.toString('utf8'));
      assert.strictEqual(parsed.gossipHop, 4);
      assert.ok(wire.equals(fwd));
    });

    it('drops hop<=0 before emit / relay / budget burn', function () {
      const { peer, edges } = meshPeer(2, {
        gossip: { maxRelaysPerOriginPerMinute: 5 }
      });
      const author = new Key();
      const origin = '127.0.0.1:8100';
      peer.peers[origin] = { publicKey: author.pubkey };
      let seen = 0;
      peer.on('peeringGossip', () => { seen++; });

      peer._handleFabricMessage(
        signGossip(author, { host: '198.51.100.3', port: 1, gossipHop: 0 }).toBuffer(),
        { name: origin },
        null
      );

      assert.strictEqual(seen, 0);
      assert.strictEqual(edges['127.0.0.1:8101'].length, 0);
      assert.strictEqual(peer._gossipRelayByOrigin.has(origin), false);
    });

    it('logical dedupe ignores hop and re-signed copies with same body', function () {
      const { peer, edges } = meshPeer(2);
      const a = new Key();
      const b = new Key();
      const origin = '127.0.0.1:8100';
      peer.peers[origin] = { publicKey: a.pubkey };
      let seen = 0;
      peer.on('peeringGossip', () => { seen++; });

      const body = { host: '198.51.100.4', port: 53 };
      peer._handleFabricMessage(
        signGossip(a, { ...body, gossipHop: 5 }).toBuffer(),
        { name: origin },
        null
      );
      // Different AMP author + hop — same logical payload key.
      peer.peers[origin] = { publicKey: b.pubkey };
      peer._handleFabricMessage(
        signGossip(b, { ...body, gossipHop: 1 }).toBuffer(),
        { name: origin },
        null
      );

      assert.strictEqual(seen, 1);
      assert.strictEqual(edges['127.0.0.1:8101'].length, 1);
    });

    it('exact wire duplicate is silent (wire-hash cache) with no second relay', function () {
      const { peer, edges } = meshPeer(2);
      const author = new Key();
      const origin = '127.0.0.1:8100';
      peer.peers[origin] = { publicKey: author.pubkey };
      let seen = 0;
      peer.on('peeringGossip', () => { seen++; });

      const wire = signGossip(author, {
        host: '198.51.100.5',
        port: 9,
        gossipHop: 3,
        uniq: 'wire-dup'
      }).toBuffer();
      peer._handleFabricMessage(wire, { name: origin }, null);
      peer._handleFabricMessage(Buffer.from(wire), { name: origin }, null);

      assert.strictEqual(seen, 1);
      assert.strictEqual(edges['127.0.0.1:8101'].length, 1);
    });

    it('enforces per-origin gossip relay budget and window rollover', function () {
      const { peer, edges } = meshPeer(2, {
        gossip: { maxRelaysPerOriginPerMinute: 2 }
      });
      const author = new Key();
      const origin = '127.0.0.1:8100';
      peer.peers[origin] = { publicKey: author.pubkey };
      let seen = 0;
      peer.on('peeringGossip', () => { seen++; });

      for (let i = 0; i < 4; i++) {
        peer._handleFabricMessage(
          signGossip(author, {
            host: '198.51.100.6',
            port: 7000 + i,
            gossipHop: 5,
            i
          }).toBuffer(),
          { name: origin },
          null
        );
      }
      assert.strictEqual(seen, 2, 'rate limit applies before emit when budget exhausted mid-burst');
      assert.strictEqual(edges['127.0.0.1:8101'].length, 2);

      const slot = peer._gossipRelayByOrigin.get(origin);
      slot.windowStart = Date.now() - 61_000;
      peer._gossipRelayByOrigin.set(origin, slot);

      peer._handleFabricMessage(
        signGossip(author, {
          host: '198.51.100.6',
          port: 7099,
          gossipHop: 5,
          i: 'rollover'
        }).toBuffer(),
        { name: origin },
        null
      );
      assert.strictEqual(edges['127.0.0.1:8101'].length, 3);
    });

    it('FIFO-evicts gossip payload cache so older keys can be claimed again', function () {
      const peer = offlinePeer({ gossip: { maxPayloadCache: 2 } });
      peer.relayFrom = function () {};
      const author = new Key();
      const origin = { name: 'o:fifo' };
      const keys = [];
      for (let i = 0; i < 3; i++) {
        const object = { host: `10.0.0.${i}`, port: 1, gossipHop: 2 };
        const wire = signGossip(author, object);
        peer._handleGenericMessage({ type: 'P2P_PEER_GOSSIP', object }, origin, null, wire);
        keys.push(peer._gossipPayloadDedupKey({ type: 'P2P_PEER_GOSSIP', object }));
      }
      assert.strictEqual(peer._gossipPayloadSeen.size, 2);
      assert.strictEqual(peer._gossipPayloadSeen.has(keys[0]), false);
      assert.strictEqual(peer._gossipPayloadSeen.has(keys[1]), true);
      assert.strictEqual(peer._gossipPayloadSeen.has(keys[2]), true);

      // Evicted key can be accepted again.
      let relays = 0;
      peer.relayFrom = function () { relays++; };
      const again = { host: '10.0.0.0', port: 1, gossipHop: 2 };
      peer._handleGenericMessage(
        { type: 'P2P_PEER_GOSSIP', object: again },
        origin,
        null,
        signGossip(author, again)
      );
      assert.strictEqual(relays, 1);
    });

    it('separate origins have independent gossip budgets', function () {
      const { peer, edges } = meshPeer(3, {
        gossip: { maxRelaysPerOriginPerMinute: 1 }
      });
      const a = new Key();
      const b = new Key();
      const o0 = '127.0.0.1:8100';
      const o1 = '127.0.0.1:8101';
      peer.peers[o0] = { publicKey: a.pubkey };
      peer.peers[o1] = { publicKey: b.pubkey };

      peer._handleFabricMessage(
        signGossip(a, { host: '10.2.0.1', port: 1, gossipHop: 5, n: 1 }).toBuffer(),
        { name: o0 },
        null
      );
      peer._handleFabricMessage(
        signGossip(b, { host: '10.2.0.2', port: 1, gossipHop: 5, n: 2 }).toBuffer(),
        { name: o1 },
        null
      );

      // Each origin may relay once; destination edge 8102 should see both.
      assert.ok(edges['127.0.0.1:8102'].length >= 2);
    });
  });

  describe('P2P_PEERING_OFFER wire mesh', function () {
    it('relays bit-identical offers and enqueues fabric candidates', function () {
      const { peer, edges } = meshPeer(3, {
        peering: { maxRelaysPerOriginPerMinute: 20, maxCandidates: 16 },
        constraints: { peers: { max: 32 } }
      });
      const author = new Key();
      const origin = '127.0.0.1:8100';
      peer.peers[origin] = { publicKey: author.pubkey };
      const offers = [];
      peer.on('peeringOffer', (d) => offers.push(d));

      const object = {
        transport: 'fabric',
        host: '203.0.113.10',
        port: 7777,
        peeringHop: 5
      };
      const wire = signOffer(author, object).toBuffer();
      peer._handleFabricMessage(wire, { name: origin }, null);

      assert.strictEqual(offers.length, 1);
      assert.strictEqual(peer.candidates.length, 1);
      assert.deepStrictEqual(peer.candidates[0], {
        host: '203.0.113.10',
        port: 7777,
        pubkey: xOnlyFromKey(author).toString('hex')
      });
      assert.ok(peer._candidateKeys.has('203.0.113.10:7777'));
      assert.ok(wire.equals(edges['127.0.0.1:8101'][0]));
      assert.ok(wire.equals(edges['127.0.0.1:8102'][0]));
    });

    it('FIFO-caps candidate queue and preserves newest addresses', function () {
      const peer = offlinePeer({
        peering: { maxCandidates: 2 },
        constraints: { peers: { max: 32 } }
      });
      peer.relayFrom = function () {};
      const author = new Key();
      for (let i = 0; i < 3; i++) {
        const object = {
          transport: 'fabric',
          host: `203.0.113.${20 + i}`,
          port: 7777,
          peeringHop: 3
        };
        peer._handleGenericMessage(
          { type: 'P2P_PEERING_OFFER', object },
          { name: `o:${i}` },
          null,
          signOffer(author, object)
        );
      }
      assert.strictEqual(peer.candidates.length, 2);
      assert.strictEqual(peer.candidates[0].host, '203.0.113.21');
      assert.strictEqual(peer.candidates[1].host, '203.0.113.22');
      assert.ok(!peer._candidateKeys.has('203.0.113.20:7777'));
    });

    it('enforces per-origin peering budget independently of gossip', function () {
      const { peer, edges } = meshPeer(2, {
        peering: { maxRelaysPerOriginPerMinute: 1 },
        gossip: { maxRelaysPerOriginPerMinute: 10 },
        constraints: { peers: { max: 32 } }
      });
      const author = new Key();
      const origin = '127.0.0.1:8100';
      peer.peers[origin] = { publicKey: author.pubkey };

      for (let i = 0; i < 3; i++) {
        peer._handleFabricMessage(
          signOffer(author, {
            transport: 'fabric',
            host: `203.0.113.${30 + i}`,
            port: 7777,
            peeringHop: 5
          }).toBuffer(),
          { name: origin },
          null
        );
      }
      assert.strictEqual(edges['127.0.0.1:8101'].length, 1);
      assert.strictEqual(peer.candidates.length, 1);

      // Gossip budget untouched — still may relay gossip from same origin.
      peer._handleFabricMessage(
        signGossip(author, {
          host: '198.51.100.9',
          port: 1,
          gossipHop: 5,
          indep: true
        }).toBuffer(),
        { name: origin },
        null
      );
      assert.strictEqual(edges['127.0.0.1:8101'].length, 2);
    });

    it('drops peeringHop<=0 before enqueue / relay', function () {
      const { peer, edges } = meshPeer(2, { constraints: { peers: { max: 32 } } });
      const author = new Key();
      const origin = '127.0.0.1:8100';
      peer.peers[origin] = { publicKey: author.pubkey };
      let seen = 0;
      peer.on('peeringOffer', () => { seen++; });

      peer._handleFabricMessage(
        signOffer(author, {
          transport: 'fabric',
          host: '203.0.113.40',
          port: 7777,
          peeringHop: 0
        }).toBuffer(),
        { name: origin },
        null
      );

      assert.strictEqual(seen, 0);
      assert.strictEqual(peer.candidates.length, 0);
      assert.strictEqual(edges['127.0.0.1:8101'].length, 0);
    });
  });

  describe('RELAY / onion consistency with gossip + peering', function () {
    it('foreign-signed P2P_RELAY gossip floods outer only (no inner mesh / budget)', function () {
      const { peer, edges } = meshPeer(3, {
        gossip: { maxRelaysPerOriginPerMinute: 1 }
      });
      const attacker = new Key();
      const forwarder = new Key();
      const origin = '127.0.0.1:8100';
      peer.peers[origin] = { publicKey: forwarder.pubkey };
      peer._addressToId[origin] = 'fwd';
      peer._state.peers = {
        fwd: { id: 'fwd', address: origin, score: 200, publicKey: forwarder.pubkey }
      };

      const inner = signGossip(attacker, {
        host: '198.51.100.50',
        port: 9,
        gossipHop: 5,
        via: 'relay'
      });
      const outer = Message.fromVector(['P2P_RELAY', inner.toBuffer()]).signWithKey(attacker);
      const outerBuf = outer.toBuffer();
      const gossips = [];
      peer.on('peeringGossip', (d) => gossips.push(d));

      peer._handleFabricMessage(outerBuf, { name: origin }, null);

      assert.strictEqual(gossips.length, 1);
      assert.strictEqual(gossips[0].peeledForward, true);
      assert.strictEqual(peer._gossipRelayByOrigin.has(origin), false);
      // Outer RELAY bit-identical to other edges; must not also push inner gossip frames.
      for (const [addr, writes] of Object.entries(edges)) {
        if (addr === origin) continue;
        assert.ok(writes.length >= 1);
        assert.strictEqual(Message.fromBuffer(writes[0]).type, 'P2P_RELAY');
        assert.ok(outerBuf.equals(writes[0]));
        assert.ok(!writes.some((w) => Message.fromBuffer(w).type === 'P2P_PEER_GOSSIP'));
      }
    });

    it('foreign-signed P2P_RELAY peering offer does not enqueue or burn budget', function () {
      const { peer, edges } = meshPeer(2, {
        peering: { maxRelaysPerOriginPerMinute: 1 },
        constraints: { peers: { max: 32 } }
      });
      const attacker = new Key();
      const forwarder = new Key();
      const origin = '127.0.0.1:8100';
      peer.peers[origin] = { publicKey: forwarder.pubkey };

      const inner = signOffer(attacker, {
        transport: 'fabric',
        host: '203.0.113.99',
        port: 17777,
        peeringHop: 5
      });
      const outer = Message.fromVector(['P2P_RELAY', inner.toBuffer()]).signWithKey(attacker);
      const offers = [];
      peer.on('peeringOffer', (d) => offers.push(d));

      peer._handleFabricMessage(outer.toBuffer(), { name: origin }, null);

      assert.strictEqual(offers.length, 1);
      assert.strictEqual(offers[0].peeledForward, true);
      assert.strictEqual(peer.candidates.length, 0);
      assert.strictEqual(peer._peeringRelayByOrigin.has(origin), false);
      assert.ok(edges['127.0.0.1:8101'].some((w) => Message.fromBuffer(w).type === 'P2P_RELAY'));
    });

    it('three-node gossip path: A→B→C is bit-identical and loop-free', function () {
      const author = new Key();
      const nodes = [0, 1, 2].map((i) => {
        const peer = offlinePeer();
        const writes = {};
        return { peer, writes, id: i };
      });
      // Fully connect mock edges between nodes using address keys.
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          if (i === j) continue;
          const addr = `n${j}:7777`;
          nodes[i].writes[addr] = [];
          nodes[i].peer.connections[addr] = wireConn(nodes[i].writes[addr]);
          nodes[i].peer.peers[addr] = {
            id: `n${j}`,
            publicKey: (j === 0 ? author : nodes[j].peer.key).pubkey
          };
        }
      }

      const object = { host: '198.51.100.60', port: 7777, gossipHop: 5, path: 'A-B-C' };
      const wire = signGossip(author, object).toBuffer();

      // A originates to B
      nodes[0].peer.peers['n1:7777'] = { publicKey: author.pubkey };
      // Deliver into B as if from A
      nodes[1].peer.peers['n0:7777'] = { publicKey: author.pubkey };
      nodes[1].peer._handleFabricMessage(wire, { name: 'n0:7777' }, null);

      const bToC = nodes[1].writes['n2:7777'];
      assert.strictEqual(bToC.length, 1);
      assert.ok(wire.equals(bToC[0]));

      // C receives from B — must not echo back to B (origin skip) and must not
      // re-process if B also got a loop (wire hash on C).
      nodes[2].peer.peers['n1:7777'] = { publicKey: author.pubkey };
      nodes[2].peer._handleFabricMessage(bToC[0], { name: 'n1:7777' }, null);
      assert.strictEqual(nodes[2].writes['n1:7777'].length, 0, 'C must not bounce to B');
      assert.ok(nodes[2].writes['n0:7777'].length >= 1);
      assert.ok(wire.equals(nodes[2].writes['n0:7777'][0]));

      // Replay into C — wire dedupe silent.
      const before = nodes[2].writes['n0:7777'].length;
      nodes[2].peer._handleFabricMessage(Buffer.from(wire), { name: 'n1:7777' }, null);
      assert.strictEqual(nodes[2].writes['n0:7777'].length, before);
    });

    it('onion-delivered gossip remains local-only on destination', function () {
      const destKey = new Key();
      const originKey = new Key();
      const peer = offlinePeer({
        key: { mnemonic: destKey.mnemonic },
        gossip: { maxRelaysPerOriginPerMinute: 1 }
      });
      const addr = '127.0.0.1:8800';
      const other = '127.0.0.1:8801';
      const otherWrites = [];
      peer.connections[addr] = wireConn([]);
      peer.connections[other] = wireConn(otherWrites);
      peer.peers[addr] = { publicKey: originKey.pubkey };

      const payload = signGossip(originKey, {
        host: '198.51.100.70',
        port: 1,
        gossipHop: 5,
        onion: true
      });
      const outer = wrapOnionPath({
        path: [xOnlyFromKey(peer.key)],
        payload,
        key: originKey
      });
      const seen = [];
      peer.on('peeringGossip', (d) => seen.push(d));
      peer._handleFabricMessage(outer.toBuffer(), { name: addr }, null);

      assert.strictEqual(seen.length, 1);
      assert.strictEqual(seen[0].peeledForward, true);
      assert.strictEqual(otherWrites.length, 0);
      assert.strictEqual(peer._gossipRelayByOrigin.has(addr), false);
    });
  });

  describe('cross-feature logical consistency', function () {
    it('chat and gossip budgets do not share counters', function () {
      const { peer, edges } = meshPeer(2, {
        chat: { maxRelaysPerOriginPerMinute: 1 },
        gossip: { maxRelaysPerOriginPerMinute: 1 }
      });
      const author = new Key();
      const origin = '127.0.0.1:8100';
      peer.peers[origin] = { publicKey: author.pubkey };

      peer._handleFabricMessage(
        Message.fromVector(['P2P_CHAT_MESSAGE', `chat-${Date.now()}`]).signWithKey(author).toBuffer(),
        { name: origin },
        null
      );
      peer._handleFabricMessage(
        signGossip(author, {
          host: '10.9.9.9',
          port: 1,
          gossipHop: 5,
          split: true
        }).toBuffer(),
        { name: origin },
        null
      );

      const types = edges['127.0.0.1:8101'].map((w) => Message.fromBuffer(w).type);
      assert.ok(types.includes('P2P_CHAT_MESSAGE'));
      assert.ok(types.includes('P2P_PEER_GOSSIP'));
    });

    it('alias mesh relay does not consume gossip or peering budgets', function () {
      const { peer, edges } = meshPeer(2, {
        gossip: { maxRelaysPerOriginPerMinute: 1 },
        peering: { maxRelaysPerOriginPerMinute: 1 }
      });
      const author = new Key();
      const origin = '127.0.0.1:8100';
      peer.peers[origin] = { publicKey: author.pubkey };

      peer._handleFabricMessage(
        Message.fromVector(['P2P_PEER_ALIAS', 'prod-nick']).signWithKey(author).toBuffer(),
        { name: origin },
        null
      );
      assert.ok(edges['127.0.0.1:8101'].some((w) => Message.fromBuffer(w).type === 'P2P_PEER_ALIAS'));
      assert.strictEqual(peer._gossipRelayByOrigin.has(origin), false);
      assert.strictEqual(peer._peeringRelayByOrigin.has(origin), false);

      // Budgets still available for gossip + peering.
      peer._handleFabricMessage(
        signGossip(author, { host: '10.8.8.8', port: 1, gossipHop: 2 }).toBuffer(),
        { name: origin },
        null
      );
      peer._handleFabricMessage(
        signOffer(author, {
          transport: 'fabric',
          host: '203.0.113.55',
          port: 7777,
          peeringHop: 2
        }).toBuffer(),
        { name: origin },
        null
      );
      const types = edges['127.0.0.1:8101'].map((w) => Message.fromBuffer(w).type);
      assert.ok(types.includes('P2P_PEER_GOSSIP'));
      assert.ok(types.includes('P2P_PEERING_OFFER'));
    });

    it('default peer settings expose gossip/peering knobs without networking', function () {
      const peer = offlinePeer();
      assert.ok(peer.settings.gossip == null || typeof peer.settings.gossip === 'object');
      // Runtime maps exist even when settings.gossip is unset (constants defaults).
      assert.ok(peer._gossipPayloadSeen instanceof Map);
      assert.ok(peer._peeringPayloadSeen instanceof Map);
      assert.ok(Array.isArray(peer.candidates));
      assert.ok(peer._candidateKeys instanceof Set);
    });
  });
});
