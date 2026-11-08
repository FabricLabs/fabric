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

  it('rotates and evicts on capacity', function () {
    const f = new WireReplayFilter({ capacity: 1, now: () => 0 });
    const victim = h('victim');
    const first = f._current;
    f.add(victim);
    assert.ok(f._test(first, f._positions(victim)), 'in the current generation');
    assert.ok(f.has(victim));
    assert.strictEqual(f._previous, first);
    assert.notStrictEqual(f._current, first);
    f.add(h('other'));
    assert.strictEqual(f._test(f._current, f._positions(victim)), false);
    assert.strictEqual(f.has(victim), false);
    assert.notStrictEqual(f._previous, first);
  });

  it('a repeated hash does not count toward rotation', function () {
    const f = new WireReplayFilter({ capacity: 2, now: () => 0 });
    f.add(h('victim'));
    for (let i = 0; i < 4; i++) f.add(h('repeat'));
    assert.ok(f.has(h('victim')));
    for (let i = 0; i < 4; i++) f.add(h('repeat'));
    assert.ok(f.has(h('victim')), 'still within two generations');
  });

  it('a saturating filter rotates on its fill and keeps admitting new frames', function () {
    const f = new WireReplayFilter({ capacity: 100, falsePositiveRate: 0.8, now: () => 0 });
    assert.strictEqual(f.falsePositiveRate, 0.5, 'the rate is capped');
    assert.ok(f.maxSetBits < f.bits);
    for (let i = 0; i < 5000; i++) {
      f.add(h(i));
      assert.ok(f._current.set <= f.maxSetBits + f.hashes, `generation fill ${f._current.set}`);
    }
    let seen = 0;
    for (let i = 5000; i < 6000; i++) if (f.has(h(i))) seen++;
    // Each generation calls at most about half of new frames seen.
    assert.ok(seen < 850, `new frames taken for replays: ${seen}`);
    for (let i = 4990; i < 5000; i++) assert.ok(f.has(h(i)), 'recent frames are still caught');
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
