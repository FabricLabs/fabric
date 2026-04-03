'use strict';

const assert = require('assert');
const Message = require('../types/message');
const Peer = require('../types/peer');

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
