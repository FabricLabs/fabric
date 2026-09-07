'use strict';

const assert = require('assert');
const {
  BITCOIN_L1_BLOCK_BYTES,
  BITCOIN_L1_BLOCK_INTERVAL_MS,
  MAX_PEERS
} = require('../constants');
const {
  aggregatePeerBandwidth,
  peerBandwidthByteLength,
  peerBandwidthSnapshot,
  perPeerBandwidthBudgetBytes,
  recordPeerBandwidth
} = require('../functions/peerBandwidth');
const Peer = require('../types/peer');

describe('@fabric/core/functions/peerBandwidth', function () {
  it('splits the L1 1 MiB / 10 min window across MAX_PEERS', function () {
    assert.strictEqual(BITCOIN_L1_BLOCK_BYTES, 1024 * 1024);
    assert.strictEqual(BITCOIN_L1_BLOCK_INTERVAL_MS, 10 * 60 * 1000);
    assert.strictEqual(MAX_PEERS, 32);
    assert.strictEqual(perPeerBandwidthBudgetBytes(), 32768);
    assert.strictEqual(perPeerBandwidthBudgetBytes(1024, 4), 256);
  });

  it('counts Buffer and numeric lengths', function () {
    assert.strictEqual(peerBandwidthByteLength(Buffer.from('abcd')), 4);
    assert.strictEqual(peerBandwidthByteLength(12.9), 12);
    assert.strictEqual(peerBandwidthByteLength(null), 0);
  });

  it('rolls the window and snapshots budget share', function () {
    const t0 = 1_000_000;
    let slot = recordPeerBandwidth(null, 'in', 100, t0, 1000);
    slot = recordPeerBandwidth(slot, 'out', 50, t0 + 10, 1000);
    const snap = peerBandwidthSnapshot(slot, t0 + 10, {
      windowMs: 1000,
      budgetBytes: 200
    });
    assert.strictEqual(snap.bytesIn, 100);
    assert.strictEqual(snap.bytesOut, 50);
    assert.strictEqual(snap.windowBytes, 150);
    assert.strictEqual(snap.overBudget, false);
    slot = recordPeerBandwidth(slot, 'in', 100, t0 + 20, 1000);
    const hot = peerBandwidthSnapshot(slot, t0 + 20, { windowMs: 1000, budgetBytes: 200 });
    assert.strictEqual(hot.windowBytes, 250);
    assert.strictEqual(hot.overBudget, true);
    const rolled = recordPeerBandwidth(slot, 'out', 8, t0 + 2000, 1000);
    assert.strictEqual(rolled.bytesIn, 200);
    assert.strictEqual(rolled.windowBytesIn, 0);
    assert.strictEqual(rolled.windowBytesOut, 8);
  });

  it('aggregates node-wide usage against the L1 window', function () {
    const a = peerBandwidthSnapshot(
      recordPeerBandwidth(null, 'in', 10, 1, 600000),
      1,
      { windowMs: 600000, windowBytes: 100, maxPeers: 2 }
    );
    const b = peerBandwidthSnapshot(
      recordPeerBandwidth(null, 'out', 90, 1, 600000),
      1,
      { windowMs: 600000, windowBytes: 100, maxPeers: 2 }
    );
    const sum = aggregatePeerBandwidth([a, b], {
      windowMs: 600000,
      windowBytes: 100,
      maxPeers: 2
    });
    assert.strictEqual(sum.windowBytes, 100);
    assert.strictEqual(sum.peerBudgetBytes, 50);
    assert.strictEqual(sum.overBudget, false);
  });
});

describe('@fabric/core Peer bandwidth overlay', function () {
  it('knownPeers and bandwidthSummary include L1 budget fields', function () {
    const peer = new Peer({ listen: false, networking: false, peersDb: null, upnp: false, peers: [] });
    peer._recordPeerBandwidth('127.0.0.1:7777', 'in', 1024);
    peer._recordPeerBandwidth('127.0.0.1:7777', 'out', 2048);
    peer._state.peers = {
      id1: { id: 'id1', address: '127.0.0.1:7777', score: 1 }
    };
    const row = peer.knownPeers.find((p) => p.address === '127.0.0.1:7777');
    assert.ok(row);
    assert.strictEqual(row.bytesIn, 1024);
    assert.strictEqual(row.bytesOut, 2048);
    assert.strictEqual(row.windowBytes, 3072);
    assert.strictEqual(row.budgetBytes, 32768);
    assert.strictEqual(row.overBudget, false);
    const sum = peer.bandwidthSummary;
    assert.strictEqual(sum.peerBudgetBytes, 32768);
    assert.strictEqual(sum.windowBudgetBytes, 1024 * 1024);
    assert.strictEqual(sum.bytesIn, 1024);
    assert.strictEqual(sum.bytesOut, 2048);
    assert.strictEqual(sum.maxPeers, 32);
  });
});
