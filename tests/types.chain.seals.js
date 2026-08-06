'use strict';

const assert = require('assert');
const Key = require('../types/key');
const {
  signingStringForBeaconEpoch,
  verifyFederationWitnessOnMessage
} = require('../functions/beaconFederationSigning');
const Chain = require('../types/chain');
const Block = require('../types/block');

describe('@fabric/core/types/chain consensus (Block ledger)', function () {
  it('federation append is linear and digest is stable', function () {
    const a = Chain.create({ consensus: 'federation' });
    const e1 = a.append({ type: 'BEACON_EPOCH', data: { clock: 1, height: 1 } });
    const e2 = a.append({ type: 'BEACON_EPOCH', data: { clock: 2, height: 2 } });
    assert.strictEqual(a.height, 2);
    assert.strictEqual(e2.parent, e1.id);
    assert.strictEqual(a.tip.id, e2.id);
    const d1 = a.digest();
    assert.ok(d1 && d1.length >= 32);
    assert.strictEqual(a.digest(), d1);
    assert.throws(() => a.append({
      type: 'BEACON_EPOCH',
      parent: 'deadbeef',
      data: { clock: 3 }
    }), /parent must match tip/);
  });

  it('federation fromBeaconMessages / toBeaconMessages round-trip', function () {
    const messages = [
      { type: 'BEACON_EPOCH', payload: { clock: 1, height: 9, blockHash: 'aa' }, id: 'id1' },
      { type: 'BEACON_EPOCH', payload: { clock: 2, height: 10, blockHash: 'bb' }, id: 'id2', federationWitness: { signatures: {} } }
    ];
    const chain = Chain.fromBeaconMessages(messages);
    assert.strictEqual(chain.height, 2);
    assert.strictEqual(chain.at(0).id, 'id1');
    assert.strictEqual(chain.at(1).parent, 'id1');
    const back = Chain.toBeaconMessages(chain);
    assert.strictEqual(back[0].payload.height, 9);
    assert.strictEqual(back[1].id, 'id2');
    assert.ok(back[1].federationWitness);
  });

  it('federation verify accepts valid witness and reports failures', function () {
    const key = new Key({ private: '1111111111111111111111111111111111111111111111111111111111111111' });
    const epochOk = { clock: 1, height: 1 };
    const epochBad = { clock: 2, height: 2 };
    const msg = Buffer.from(signingStringForBeaconEpoch(epochOk), 'utf8');
    const chain = Chain.fromBeaconMessages([
      {
        type: 'BEACON_EPOCH',
        payload: epochOk,
        federationWitness: { signatures: { [key.pubkey]: key.signSchnorr(msg).toString('hex') } }
      },
      { type: 'BEACON_EPOCH', payload: epochBad, federationWitness: null }
    ]);
    const okOnly = Chain.fromBeaconMessages([chain.toBeaconMessages()[0]]);
    assert.strictEqual(okOnly.verify([key.pubkey], 1).ok, true);
    const bad = chain.verify([key.pubkey], 1);
    assert.strictEqual(bad.ok, false);
    assert.strictEqual(bad.failures.length, 1);
  });

  it('federation pruneByBeaconHeight', function () {
    const chain = Chain.fromBeaconMessages([
      { type: 'BEACON_EPOCH', payload: { clock: 1, height: 9, tipHash: 'aa' } },
      { type: 'BEACON_EPOCH', payload: { clock: 2, height: 10, tipHash: 'bb' } }
    ]);
    const r = chain.pruneByBeaconHeight(9);
    assert.strictEqual(r.pruned, 1);
    assert.deepStrictEqual(r.removedBeaconClocks, [2]);
    assert.strictEqual(chain.height, 1);
    assert.strictEqual(chain.tip.payload.height, 9);
  });

  it('gossip merge unions by id and split/replay work', function () {
    const a = Chain.create({ consensus: 'gossip' });
    a.append(new Block({
      type: 'SCEvent',
      author: 'alice',
      data: { kind: 'death', timestamp: '2026-01-01T00:00:00Z', fields: { player: 'A' } }
    }));
    a.append(new Block({
      type: 'SCEvent',
      author: 'alice',
      data: { kind: 'mission', timestamp: '2026-01-01T01:00:00Z', fields: { player: 'A' } }
    }));

    const b = Chain.create({ consensus: 'gossip' });
    const shared = new Block({
      type: 'SCEvent',
      author: 'alice',
      data: { kind: 'death', timestamp: '2026-01-01T00:00:00Z', fields: { player: 'A' } }
    });
    b.append(shared);
    b.append(new Block({
      type: 'SCEvent',
      author: 'bob',
      data: { kind: 'death', timestamp: '2026-01-01T00:30:00Z', fields: { player: 'B' } }
    }));

    a.merge(b);
    assert.strictEqual(a.height, 3);

    const { head, tail } = a.split({ by: 'author', author: 'bob' });
    assert.strictEqual(head.height, 1);
    assert.strictEqual(tail.height, 2);

    const replayed = a.replay({ filter: (e) => e.author === 'alice' });
    assert.strictEqual(replayed.length, 2);
  });

  it('gossip idempotent append by content id', function () {
    const c = Chain.create({ consensus: 'gossip' });
    const data = { kind: 'kill', timestamp: '2026-07-01T00:00:00Z', fields: { x: 1 } };
    c.append({ type: 'SCEvent', author: 'p', data });
    c.append({ type: 'SCEvent', author: 'p', data });
    assert.strictEqual(c.height, 1);
  });

  it('gossip author signature verifies', function () {
    const key = new Key({ private: '2222222222222222222222222222222222222222222222222222222222222222' });
    const c = Chain.create({ consensus: 'gossip' });
    c.append({
      type: 'SCEvent',
      data: { kind: 'note', timestamp: '2026-01-02T00:00:00Z', fields: {} }
    }, { signWith: key });
    assert.strictEqual(c.tip.author, key.pubkey);
    assert.ok(c.tip.signature);
    assert.strictEqual(c.verify().ok, true);
  });

  it('eventId is stable for same inputs', function () {
    const a = Chain.eventId({
      source: 'pk',
      kind: 'death',
      fields: { player: 'x' },
      timestamp: 't'
    });
    const b = Chain.eventId({
      source: 'pk',
      kind: 'death',
      fields: { player: 'x' },
      timestamp: 't'
    });
    assert.strictEqual(a, b);
    assert.strictEqual(a.length, 32);
  });

  it('default consensus remains pow/playnet compatible', async function () {
    const chain = new Chain();
    assert.strictEqual(chain.consensusMode, 'pow');
    assert.strictEqual(chain.seal, 'block');
    await chain.start();
    await chain.append({ debug: true, input: 'Hello, world.' });
    assert.ok(chain.tip);
    await chain.stop();
  });

  it('Block validate supports federation witness', function () {
    const key = new Key({ private: '1111111111111111111111111111111111111111111111111111111111111111' });
    const epoch = { clock: 1, height: 1 };
    const msg = Buffer.from(signingStringForBeaconEpoch(epoch), 'utf8');
    const block = new Block({
      type: 'BEACON_EPOCH',
      data: epoch,
      federationWitness: { signatures: { [key.pubkey]: key.signSchnorr(msg).toString('hex') } }
    });
    assert.strictEqual(block.validate({
      consensus: 'federation',
      validators: [key.pubkey],
      threshold: 1
    }).ok, true);
  });
});
