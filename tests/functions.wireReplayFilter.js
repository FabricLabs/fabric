'use strict';

const assert = require('assert');
const crypto = require('crypto');
const WireReplayFilter = require('../functions/wireReplayFilter');

const h = (i) => crypto.createHash('sha256').update(String(i)).digest('hex');

describe('@fabric/core/functions/wireReplayFilter', function () {
  it('remembers hashes and does not report unseen ones', function () {
    const f = new WireReplayFilter({ capacity: 1000 });
    for (let i = 0; i < 1000; i++) f.add(h(i));
    for (let i = 0; i < 1000; i++) assert.ok(f.has(h(i)), `seen ${i}`);
    let fp = 0;
    for (let i = 1000; i < 11000; i++) if (f.has(h(i))) fp++;
    assert.ok(fp <= 2, `false positives ${fp}`);
  });

  it('keeps a flooded-out hash for a full generation after rotating on capacity', function () {
    const f = new WireReplayFilter({ capacity: 100 });
    f.add(h('victim'));
    for (let i = 0; i < 150; i++) f.add(h(i));
    assert.ok(f.has(h('victim')), 'still in the previous generation');
  });

  it('forgets after two windows', function () {
    let now = 0;
    const f = new WireReplayFilter({ capacity: 100, maxAgeMs: 1000, now: () => now });
    f.add(h('x'));
    now = 1500;
    assert.ok(f.has(h('x')), 'previous generation');
    now = 4000;
    assert.strictEqual(f.has(h('x')), false);
  });
});

describe('Peer wire replay filter', function () {
  const Peer = require('../types/peer');
  it('drops a frame replayed after the FIFO cache evicted it', function () {
    const peer = new Peer({ listen: false, gossip: { maxWireHashCache: 2 } });
    peer._rememberWireHash(h('old'));
    peer._rememberWireHash(h('a'));
    peer._rememberWireHash(h('b'));
    assert.strictEqual(peer.messages[h('old')], undefined, 'evicted from the FIFO cache');
    assert.ok(peer._wireReplayFilter.has(h('old')), 'still caught by the filter');
  });

  it('can be turned off', function () {
    const peer = new Peer({ listen: false, gossip: { replayFilter: false } });
    assert.strictEqual(peer._wireReplayFilter, null);
  });
});
