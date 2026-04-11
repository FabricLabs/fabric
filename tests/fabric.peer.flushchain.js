'use strict';

const assert = require('assert');
const Message = require('../types/message');
const Peer = require('../types/peer');
const { P2P_CHAIN_SYNC_REQUEST, P2P_FLUSH_CHAIN } = require('../constants');

const BASE_SETTINGS = {
  listen: false,
  networking: false,
  peersDb: null,
  upnp: false,
  peers: []
};

function createPeer (overrides = {}) {
  return new Peer(Object.assign({}, BASE_SETTINGS, overrides));
}

/** Inbound FLUSH_CHAIN requires {@link Peer#settings.flushChainAuthorizedPubkeys}; use the peer's own pubkey for self-signed tests. */
function authorizeFlushChain (peer) {
  peer.settings.flushChainAuthorizedPubkeys = [peer.key.pubkey];
  return peer;
}

describe('Peer P2P_FLUSH_CHAIN', function () {
  const peers = [];

  afterEach(async function () {
    while (peers.length) {
      const peer = peers.pop();
      if (!peer || typeof peer.stop !== 'function') continue;
      try {
        await peer.stop();
      } catch {}
    }
  });

  it('_wireInboundCreditCost uses flushChainCreditCost for FLUSH_CHAIN wire types', function () {
    const peer = createPeer();
    peers.push(peer);
    assert.strictEqual(peer._wireInboundCreditCost('P2P_FLUSH_CHAIN'), 120);
    assert.strictEqual(peer._wireInboundCreditCost('FlushChain'), 120);
    assert.strictEqual(peer._wireInboundCreditCost(P2P_FLUSH_CHAIN), 120);
    const custom = createPeer({ wireTraffic: { flushChainCreditCost: 200 } });
    peers.push(custom);
    assert.strictEqual(custom._wireInboundCreditCost('P2P_FLUSH_CHAIN'), 200);
  });

  it('_wireInboundCreditCost maps chain sync and Bitcoin block wire types', function () {
    const peer = createPeer();
    peers.push(peer);
    assert.strictEqual(peer._wireInboundCreditCost('P2P_CHAIN_SYNC_REQUEST'), 55);
    assert.strictEqual(peer._wireInboundCreditCost('ChainSyncRequest'), 55);
    assert.strictEqual(peer._wireInboundCreditCost(P2P_CHAIN_SYNC_REQUEST), 55);
    assert.strictEqual(peer._wireInboundCreditCost('BITCOIN_BLOCK'), 3);
    assert.strictEqual(peer._wireInboundCreditCost('BitcoinBlock'), 3);
    const custom = createPeer({
      wireTraffic: { chainSyncCreditCost: 99, bitcoinBlockCreditCost: 7, defaultCreditCost: 2 }
    });
    peers.push(custom);
    assert.strictEqual(custom._wireInboundCreditCost('P2P_CHAIN_SYNC_REQUEST'), 99);
    assert.strictEqual(custom._wireInboundCreditCost('BITCOIN_BLOCK'), 7);
    assert.strictEqual(custom._wireInboundCreditCost('Other'), 2);
  });

  it('_rememberWireHash evicts oldest entries at gossip.maxWireHashCache', function () {
    const peer = createPeer({ gossip: { maxWireHashCache: 2 } });
    peers.push(peer);
    peer._rememberWireHash('aa');
    peer._rememberWireHash('bb');
    peer._rememberWireHash('cc');
    assert.strictEqual(peer.messages.aa, undefined);
    assert.strictEqual(peer.messages.bb, true);
    assert.strictEqual(peer.messages.cc, true);
  });

  it('_gossipRememberPayload and _peeringRememberPayload evict at configured caps', function () {
    const a = createPeer({ gossip: { maxPayloadCache: 2 } });
    peers.push(a);
    a._gossipRememberPayload('g1');
    a._gossipRememberPayload('g2');
    a._gossipRememberPayload('g3');
    assert.strictEqual(a._gossipPayloadSeen.has('g1'), false);
    assert.strictEqual(a._gossipPayloadSeen.has('g3'), true);

    const b = createPeer({ peering: { maxPayloadCache: 2 } });
    peers.push(b);
    b._peeringRememberPayload('p1');
    b._peeringRememberPayload('p2');
    b._peeringRememberPayload('p3');
    assert.strictEqual(b._peeringPayloadSeen.has('p1'), false);
    assert.strictEqual(b._peeringPayloadSeen.has('p3'), true);
  });

  it('_wireInboundRateAllowPeer de-ranks once when credits exceed the window cap', function () {
    const peer = createPeer({ wireTraffic: { maxCreditsPerWindow: 8, windowMs: 600000, overLimitPenalty: 11 } });
    peers.push(peer);
    peer._state.peers = { t1: { id: 't1', address: '127.0.0.1:1', score: 50 } };
    peer._addressToId['127.0.0.1:1'] = 't1';
    const warns = [];
    peer.on('warning', (w) => warns.push(String(w)));
    assert.strictEqual(peer._wireInboundRateAllowPeer('127.0.0.1:1', 4), true);
    assert.strictEqual(peer._wireInboundRateAllowPeer('127.0.0.1:1', 4), true);
    assert.strictEqual(peer._wireInboundRateAllowPeer('127.0.0.1:1', 4), false);
    const derankMsgs = warns.filter((w) => w.includes('De-ranked') && w.includes('inbound-rate'));
    assert.strictEqual(derankMsgs.length, 1, 'expected exactly one de-rank per rolling window');
    assert.strictEqual(peer._state.peers.t1.score, 39, 'score should be reduced exactly once by overLimitPenalty');
    assert.strictEqual(peer._wireInboundRateAllowPeer('127.0.0.1:1', 1), false);
    assert.strictEqual(peer._state.peers.t1.score, 39, 'repeated overflow in same window must not de-rank again');
  });

  it('publicPeers lists connected sockets and disconnected registry entries', function () {
    const peer = createPeer();
    peers.push(peer);
    peer.connections['127.0.0.1:1'] = { _lastMessage: 'lm' };
    peer._addressToId['127.0.0.1:1'] = 'pk1';
    peer.peers = { orphan: { id: 'orphan', address: '10.0.0.1:9' } };
    const list = peer.publicPeers;
    const conn = list.find((p) => p.status === 'connected');
    assert.ok(conn);
    assert.strictEqual(conn.address, '127.0.0.1:1');
    assert.strictEqual(conn.id, 'pk1');
    assert.strictEqual(conn.lastMessage, 'lm');
    const disc = list.find((p) => p.status === 'disconnected');
    assert.ok(disc);
    assert.strictEqual(disc.id, 'orphan');
  });

  it('knownPeers overlays connections with aliases and fills gaps from this.peers', function () {
    const peer = createPeer();
    peers.push(peer);
    peer._state.peers = { reg1: { id: 'reg1', address: '192.168.0.1:1', score: 5 } };
    peer.connections['192.168.0.2:2'] = { _lastMessage: 'x', _alias: 'alice' };
    peer._addressToId['192.168.0.2:2'] = 'reg1';
    peer.peers = { onlyInPeers: { id: 'onlyInPeers', address: '172.16.0.1:1' } };
    const list = peer.knownPeers;
    const hit = list.find((p) => p.id === 'reg1');
    assert.ok(hit);
    assert.strictEqual(hit.status, 'connected');
    assert.strictEqual(hit.alias, 'alice');
    assert.strictEqual(hit.lastMessage, 'x');
    assert.ok(list.some((p) => p.id === 'onlyInPeers' && p.status === 'disconnected'));
  });

  it('sendFlushChainToTrustedPeers writes only to connections above score threshold', function () {
    const writes = [];
    const peer = createPeer();
    peers.push(peer);
    peer.connections['127.0.0.1:1'] = {
      _writeFabric: (buf) => { writes.push({ id: '127.0.0.1:1', len: buf.length }); }
    };
    peer.connections['127.0.0.1:2'] = {
      _writeFabric: (buf) => { writes.push({ id: '127.0.0.1:2', len: buf.length }); }
    };
    peer._state.peers = {
      pk_low: { id: 'pk_low', address: '127.0.0.1:1', score: 100 },
      pk_high: { id: 'pk_high', address: '127.0.0.1:2', score: 900 }
    };
    peer._addressToId['127.0.0.1:1'] = 'pk_low';
    peer._addressToId['127.0.0.1:2'] = 'pk_high';
    const n = peer.sendFlushChainToTrustedPeers({ snapshotBlockHash: '0'.repeat(64), network: 'playnet' });
    assert.strictEqual(n, 1);
    assert.strictEqual(writes.length, 1);
    assert.strictEqual(writes[0].id, '127.0.0.1:2');
  });

  it('relayFromTrustedPeers skips low-score peers and origin', function () {
    const writes = [];
    const peer = createPeer();
    peers.push(peer);
    peer.connections['127.0.0.1:1'] = { _writeFabric: () => writes.push('1') };
    peer.connections['127.0.0.1:2'] = { _writeFabric: () => writes.push('2') };
    peer._state.peers = {
      a: { id: 'a', score: 801 },
      b: { id: 'b', score: 801 }
    };
    peer._addressToId['127.0.0.1:1'] = 'a';
    peer._addressToId['127.0.0.1:2'] = 'b';
    const msg = Message.fromVector([P2P_FLUSH_CHAIN, JSON.stringify({ snapshotBlockHash: 'f'.repeat(64) })]);
    peer.relayFromTrustedPeers('127.0.0.1:1', msg, 800);
    assert.deepStrictEqual(writes, ['2']);
  });

  it('trusted relay uses strict greater-than threshold (score == threshold is excluded)', function () {
    const writes = [];
    const peer = createPeer();
    peers.push(peer);
    peer.connections['127.0.0.1:1'] = { _writeFabric: () => writes.push('1') };
    peer.connections['127.0.0.1:2'] = { _writeFabric: () => writes.push('2') };
    peer._state.peers = {
      a: { id: 'a', score: 800 },
      b: { id: 'b', score: 801 }
    };
    peer._addressToId['127.0.0.1:1'] = 'a';
    peer._addressToId['127.0.0.1:2'] = 'b';

    const msg = Message.fromVector([P2P_FLUSH_CHAIN, JSON.stringify({ snapshotBlockHash: 'f'.repeat(64) })]);
    peer.relayFromTrustedPeers(null, msg, 800);
    assert.deepStrictEqual(writes, ['2']);
  });

  it('_handleFabricMessage emits bitcoinBlock and relays from origin for BITCOIN_BLOCK', function () {
    const peer = createPeer();
    peers.push(peer);
    const events = [];
    let relayedFrom = null;
    peer.on('bitcoinBlock', (ev) => events.push(ev));
    peer.relayFrom = function (originName) { relayedFrom = originName; };
    const msg = Message.fromVector(['BITCOIN_BLOCK', JSON.stringify({ tip: 'abc' })]);
    msg.signWithKey(peer.key);
    peer._handleFabricMessage(msg.toBuffer(), { name: '127.0.0.1:9' }, null);
    assert.strictEqual(events.length, 1);
    assert.strictEqual(relayedFrom, '127.0.0.1:9');
  });

  it('_handleFabricMessage emits chainSyncRequest with parsed object', function () {
    const peer = createPeer();
    peers.push(peer);
    let seen = null;
    peer.once('chainSyncRequest', (ev) => { seen = ev; });
    const msg = Message.fromVector(['P2P_CHAIN_SYNC_REQUEST', JSON.stringify({ tip: '1234' })]);
    msg.signWithKey(peer.key);
    peer._handleFabricMessage(msg.toBuffer(), { name: '127.0.0.1:10' }, null);
    assert.ok(seen);
    assert.ok(seen.object);
    assert.strictEqual(seen.object.tip, '1234');
  });

  it('_handleFabricMessage does not emit chainSyncRequest on parse failure', function () {
    const peer = createPeer();
    peers.push(peer);
    let seen = false;
    const warns = [];
    peer.once('chainSyncRequest', () => { seen = true; });
    peer.on('warning', (w) => warns.push(String(w)));
    const msg = Message.fromVector(['P2P_CHAIN_SYNC_REQUEST', '{']);
    msg.signWithKey(peer.key);
    peer._handleFabricMessage(msg.toBuffer(), { name: '127.0.0.1:10b' }, null);
    assert.strictEqual(seen, false);
    assert.ok(warns.some((w) => w.includes('CHAIN_SYNC_REQUEST parse failed')));
  });

  it('_handleFabricMessage drops GenericMessage scalar bodies (no crash)', function () {
    const peer = createPeer();
    peers.push(peer);
    let seenGeneric = false;
    const warns = [];
    peer._handleGenericMessage = function () { seenGeneric = true; };
    peer.on('warning', (w) => warns.push(String(w)));
    const msg = Message.fromVector(['GenericMessage', 'null']);
    msg.signWithKey(peer.key);
    peer._handleFabricMessage(msg.toBuffer(), { name: '127.0.0.1:10c' }, null);
    assert.strictEqual(seenGeneric, false);
    assert.ok(warns.some((w) => w.includes('Generic message body must be a JSON object')));
  });

  it('_handleFabricMessage warns when FLUSH_CHAIN sender has no verified key', function () {
    const peer = createPeer();
    peers.push(peer);
    const warns = [];
    peer.on('warning', (w) => warns.push(String(w)));
    const msg = Message.fromVector(['P2P_FLUSH_CHAIN', JSON.stringify({ snapshotBlockHash: 'a'.repeat(64) })]);
    msg.signWithKey(peer.key);
    peer._handleFabricMessage(msg.toBuffer(), { name: '127.0.0.1:11' }, null);
    assert.ok(warns.some((w) => w.includes('no verified peer key')));
  });

  it('_handleFabricMessage warns when flushChainAuthorizedPubkeys is empty', function () {
    const peer = createPeer({ flushChainMinTrustedScore: 800, flushChainAuthorizedPubkeys: [] });
    peers.push(peer);
    const warns = [];
    peer.on('warning', (w) => warns.push(String(w)));
    peer.peers['127.0.0.1:empty'] = { publicKey: peer.key.pubkey };
    peer._state.peers = { x: { id: 'x', address: '127.0.0.1:empty', score: 900 } };
    peer._addressToId['127.0.0.1:empty'] = 'x';
    const msg = Message.fromVector(['P2P_FLUSH_CHAIN', JSON.stringify({ snapshotBlockHash: 'a'.repeat(64) })]);
    msg.signWithKey(peer.key);
    peer._handleFabricMessage(msg.toBuffer(), { name: '127.0.0.1:empty' }, null);
    assert.ok(warns.some((w) => w.includes('flushChainAuthorizedPubkeys is empty')));
  });

  it('_handleFabricMessage ignores FLUSH_CHAIN when sender pubkey is not authorized', function () {
    const peer = createPeer({
      flushChainMinTrustedScore: 800,
      flushChainAuthorizedPubkeys: ['0'.repeat(66)]
    });
    peers.push(peer);
    const warns = [];
    peer.on('warning', (w) => warns.push(String(w)));
    peer.peers['127.0.0.1:na'] = { publicKey: peer.key.pubkey };
    peer._state.peers = { x: { id: 'x', address: '127.0.0.1:na', score: 900 } };
    peer._addressToId['127.0.0.1:na'] = 'x';
    const msg = Message.fromVector(['P2P_FLUSH_CHAIN', JSON.stringify({ snapshotBlockHash: 'a'.repeat(64) })]);
    msg.signWithKey(peer.key);
    peer._handleFabricMessage(msg.toBuffer(), { name: '127.0.0.1:na' }, null);
    assert.ok(warns.some((w) => w.includes('not in flushChainAuthorizedPubkeys')));
  });

  it('_handleFabricMessage handles FLUSH_CHAIN score, parse, and hash guards', function () {
    const peer = authorizeFlushChain(createPeer({ debug: true, flushChainMinTrustedScore: 800 }));
    peers.push(peer);
    const warns = [];
    const debugs = [];
    peer.on('warning', (w) => warns.push(String(w)));
    peer.on('debug', (d) => debugs.push(String(d)));
    peer.peers['127.0.0.1:12'] = { publicKey: peer.key.pubkey };
    peer._state.peers = { good: { id: 'good', address: '127.0.0.1:12', score: 800 } };
    peer._addressToId['127.0.0.1:12'] = 'good';

    const m1 = Message.fromVector(['P2P_FLUSH_CHAIN', JSON.stringify({ snapshotBlockHash: 'a'.repeat(64) })]);
    m1.signWithKey(peer.key);
    peer._handleFabricMessage(m1.toBuffer(), { name: '127.0.0.1:12' }, null);
    assert.ok(debugs.some((d) => d.includes('sender score')));

    peer._state.peers.good.score = 900;
    const m2 = Message.fromVector(['P2P_FLUSH_CHAIN', '{not-json']);
    m2.signWithKey(peer.key);
    peer._handleFabricMessage(m2.toBuffer(), { name: '127.0.0.1:12' }, null);
    assert.ok(warns.some((w) => w.includes('JSON parse failed')));

    const m3 = Message.fromVector(['P2P_FLUSH_CHAIN', JSON.stringify({ snapshotBlockHash: 'bad' })]);
    m3.signWithKey(peer.key);
    peer._handleFabricMessage(m3.toBuffer(), { name: '127.0.0.1:12' }, null);
    assert.ok(warns.some((w) => w.includes('invalid snapshotBlockHash')));
  });

  it('_handleFabricMessage handles FlushChain friendly wire name like P2P_FLUSH_CHAIN', function () {
    const peer = authorizeFlushChain(createPeer({ flushChainMinTrustedScore: 800 }));
    peers.push(peer);
    peer.peers['127.0.0.1:14'] = { publicKey: peer.key.pubkey };
    peer._state.peers = { t2: { id: 't2', address: '127.0.0.1:14', score: 900 } };
    peer._addressToId['127.0.0.1:14'] = 't2';
    const events = [];
    peer.on('flushChain', (ev) => events.push(ev));
    const msg = Message.fromVector(['FlushChain', JSON.stringify({ snapshotBlockHash: 'c'.repeat(64) })]);
    msg.signWithKey(peer.key);
    peer._handleFabricMessage(msg.toBuffer(), { name: '127.0.0.1:14' }, null);
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].object.snapshotBlockHash, 'c'.repeat(64));
  });

  it('_handleFabricMessage emits flushChain and relays trusted peers on valid FLUSH_CHAIN', function () {
    const peer = authorizeFlushChain(createPeer({ flushChainMinTrustedScore: 800 }));
    peers.push(peer);
    peer.peers['127.0.0.1:13'] = { publicKey: peer.key.pubkey };
    peer._state.peers = { trusted: { id: 'trusted', address: '127.0.0.1:13', score: 900 } };
    peer._addressToId['127.0.0.1:13'] = 'trusted';
    const events = [];
    let relayed = null;
    peer.on('flushChain', (ev) => events.push(ev));
    peer.relayFromTrustedPeers = function (origin, _message, threshold) {
      relayed = { origin, threshold };
    };
    const msg = Message.fromVector(['P2P_FLUSH_CHAIN', JSON.stringify({ snapshotBlockHash: 'B'.repeat(64), network: 'regtest' })]);
    msg.signWithKey(peer.key);
    peer._handleFabricMessage(msg.toBuffer(), { name: '127.0.0.1:13' }, null);
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].object.snapshotBlockHash, 'b'.repeat(64));
    assert.deepStrictEqual(relayed, { origin: '127.0.0.1:13', threshold: 800 });
  });

  it('_handleFabricMessage authorizes FLUSH_CHAIN via inbound NOISE static pubkey fallback', function () {
    const peer = createPeer({ flushChainMinTrustedScore: 800 });
    peer.settings.flushChainAuthorizedPubkeys = [peer.key.pubkey];
    peers.push(peer);
    peer._inboundNoiseStaticPubkeyByAddress['127.0.0.1:15'] = peer.key.pubkey;
    peer._state.peers = {
      '127.0.0.1:15': { id: 'byAddress', address: '127.0.0.1:15', score: 900 }
    };
    const events = [];
    peer.on('flushChain', (ev) => events.push(ev));
    const msg = Message.fromVector(['P2P_FLUSH_CHAIN', JSON.stringify({ snapshotBlockHash: 'd'.repeat(64) })]);
    msg.signWithKey(peer.key);
    peer._handleFabricMessage(msg.toBuffer(), { name: '127.0.0.1:15' }, null);
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].object.snapshotBlockHash, 'd'.repeat(64));
  });
});
