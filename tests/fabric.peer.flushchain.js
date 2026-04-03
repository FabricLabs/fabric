'use strict';

const assert = require('assert');
const Message = require('../types/message');
const Peer = require('../types/peer');
const { P2P_CHAIN_SYNC_REQUEST } = require('../constants');

describe('Peer P2P_FLUSH_CHAIN', function () {
  it('_wireInboundCreditCost uses flushChainCreditCost for FLUSH_CHAIN wire types', function () {
    const peer = new Peer({ listen: false, networking: false, peersDb: null, upnp: false, peers: [] });
    assert.strictEqual(peer._wireInboundCreditCost('P2P_FLUSH_CHAIN'), 120);
    assert.strictEqual(peer._wireInboundCreditCost('FlushChain'), 120);
    const { P2P_FLUSH_CHAIN: FLUSH } = require('../constants');
    assert.strictEqual(peer._wireInboundCreditCost(FLUSH), 120);
    const custom = new Peer({
      listen: false,
      networking: false,
      peersDb: null,
      upnp: false,
      peers: [],
      wireTraffic: { flushChainCreditCost: 200 }
    });
    assert.strictEqual(custom._wireInboundCreditCost('P2P_FLUSH_CHAIN'), 200);
  });

  it('_wireInboundCreditCost maps chain sync and Bitcoin block wire types', function () {
    const peer = new Peer({ listen: false, networking: false, peersDb: null, upnp: false, peers: [] });
    assert.strictEqual(peer._wireInboundCreditCost('P2P_CHAIN_SYNC_REQUEST'), 55);
    assert.strictEqual(peer._wireInboundCreditCost('ChainSyncRequest'), 55);
    assert.strictEqual(peer._wireInboundCreditCost(P2P_CHAIN_SYNC_REQUEST), 55);
    assert.strictEqual(peer._wireInboundCreditCost('BITCOIN_BLOCK'), 3);
    assert.strictEqual(peer._wireInboundCreditCost('BitcoinBlock'), 3);
    const custom = new Peer({
      listen: false,
      networking: false,
      peersDb: null,
      upnp: false,
      peers: [],
      wireTraffic: { chainSyncCreditCost: 99, bitcoinBlockCreditCost: 7, defaultCreditCost: 2 }
    });
    assert.strictEqual(custom._wireInboundCreditCost('P2P_CHAIN_SYNC_REQUEST'), 99);
    assert.strictEqual(custom._wireInboundCreditCost('BITCOIN_BLOCK'), 7);
    assert.strictEqual(custom._wireInboundCreditCost('Other'), 2);
  });

  it('_rememberWireHash evicts oldest entries at gossip.maxWireHashCache', function () {
    const peer = new Peer({
      listen: false,
      networking: false,
      peersDb: null,
      upnp: false,
      peers: [],
      gossip: { maxWireHashCache: 2 }
    });
    peer._rememberWireHash('aa');
    peer._rememberWireHash('bb');
    peer._rememberWireHash('cc');
    assert.strictEqual(peer.messages.aa, undefined);
    assert.strictEqual(peer.messages.bb, true);
    assert.strictEqual(peer.messages.cc, true);
  });

  it('_gossipRememberPayload and _peeringRememberPayload evict at configured caps', function () {
    const a = new Peer({
      listen: false,
      networking: false,
      peersDb: null,
      upnp: false,
      peers: [],
      gossip: { maxPayloadCache: 2 }
    });
    a._gossipRememberPayload('g1');
    a._gossipRememberPayload('g2');
    a._gossipRememberPayload('g3');
    assert.strictEqual(a._gossipPayloadSeen.has('g1'), false);
    assert.strictEqual(a._gossipPayloadSeen.has('g3'), true);

    const b = new Peer({
      listen: false,
      networking: false,
      peersDb: null,
      upnp: false,
      peers: [],
      peering: { maxPayloadCache: 2 }
    });
    b._peeringRememberPayload('p1');
    b._peeringRememberPayload('p2');
    b._peeringRememberPayload('p3');
    assert.strictEqual(b._peeringPayloadSeen.has('p1'), false);
    assert.strictEqual(b._peeringPayloadSeen.has('p3'), true);
  });

  it('_wireInboundRateAllowPeer de-ranks once when credits exceed the window cap', function () {
    const peer = new Peer({
      listen: false,
      networking: false,
      peersDb: null,
      upnp: false,
      peers: [],
      wireTraffic: { maxCreditsPerWindow: 8, windowMs: 600000, overLimitPenalty: 11 }
    });
    const warns = [];
    peer.on('warning', (w) => warns.push(String(w)));
    assert.strictEqual(peer._wireInboundRateAllowPeer('127.0.0.1:1', 4), true);
    assert.strictEqual(peer._wireInboundRateAllowPeer('127.0.0.1:1', 4), true);
    assert.strictEqual(peer._wireInboundRateAllowPeer('127.0.0.1:1', 4), false);
    assert.ok(warns.some((w) => w.includes('De-ranked') && w.includes('inbound-rate')));
    assert.strictEqual(peer._wireInboundRateAllowPeer('127.0.0.1:1', 1), false);
  });

  it('publicPeers lists connected sockets and disconnected registry entries', function () {
    const peer = new Peer({ listen: false, networking: false, peersDb: null, upnp: false, peers: [] });
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
    const peer = new Peer({ listen: false, networking: false, peersDb: null, upnp: false, peers: [] });
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
    const peer = new Peer({ listen: false, networking: false, peersDb: null, upnp: false, peers: [] });
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
    const peer = new Peer({ listen: false, networking: false, peersDb: null, upnp: false, peers: [] });
    peer.connections['127.0.0.1:1'] = { _writeFabric: () => writes.push('1') };
    peer.connections['127.0.0.1:2'] = { _writeFabric: () => writes.push('2') };
    peer._state.peers = {
      a: { id: 'a', score: 801 },
      b: { id: 'b', score: 801 }
    };
    peer._addressToId['127.0.0.1:1'] = 'a';
    peer._addressToId['127.0.0.1:2'] = 'b';
    const msg = Message.fromVector(['P2P_FLUSH_CHAIN', JSON.stringify({ snapshotBlockHash: 'f'.repeat(64) })]);
    peer.relayFromTrustedPeers('127.0.0.1:1', msg, 800);
    assert.deepStrictEqual(writes, ['2']);
  });
});
