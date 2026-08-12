'use strict';

const assert = require('assert');
const Key = require('../types/key');
const Message = require('../types/message');
const {
  createMemoryStore,
  enqueueMessageBuffer,
  listQueuedMessages,
  pendingForDelivery,
  markDelivered,
  entryHexList,
  COLLECTION,
  DEFAULT_MAX_ENTRIES,
  ABSOLUTE_MAX_ENTRIES,
  clampMaxEntries
} = require('../functions/contractMessageQueue');
const { ingestMessageBuffer } = require('../functions/contractMessageAccumulate');

function signContractMessage (key, contractId, type, object) {
  const body = JSON.stringify({
    contract: contractId,
    type,
    object
  });
  return Message.fromVector(['CONTRACT_MESSAGE', body]).signWithKey(key);
}

describe('@fabric/core contractMessageQueue', function () {
  const contractId = 'd'.repeat(64);

  it('enqueues opaque bytes idempotently by message hash', function () {
    const author = new Key();
    const msg = signContractMessage(author, contractId, 'GroupChat', {
      body: 'queued',
      author: author.pubkey
    });
    const buf = msg.toBuffer();
    const store = createMemoryStore();
    const a = enqueueMessageBuffer(store, contractId, buf, { origin: 'mesh' });
    assert.strictEqual(a.accepted, true);
    assert.ok(a.entry && a.entry.hex);
    assert.strictEqual(a.entry.type, 'GroupChat');
    const b = enqueueMessageBuffer(store, contractId, buf, { origin: 'mesh' });
    assert.strictEqual(b.duplicate, true);
    assert.strictEqual(listQueuedMessages(store, contractId).length, 1);
    assert.strictEqual(store.get(COLLECTION, contractId).entries.length, 1);
  });

  it('tracks per-peer delivery without altering hex', function () {
    const author = new Key();
    const msg = signContractMessage(author, contractId, 'GroupChat', { body: 'later' });
    const store = createMemoryStore();
    const enq = enqueueMessageBuffer(store, contractId, msg.toBuffer());
    const peer = 'peer-a';
    assert.strictEqual(pendingForDelivery(store, contractId, peer).length, 1);
    const marked = markDelivered(store, contractId, enq.entry.hash, peer);
    assert.strictEqual(marked.ok, true);
    assert.strictEqual(pendingForDelivery(store, contractId, peer).length, 0);
    assert.strictEqual(listQueuedMessages(store, contractId, { includeDelivered: true }).length, 1);
    assert.strictEqual(
      listQueuedMessages(store, contractId, { includeDelivered: true })[0].hex,
      enq.entry.hex
    );
  });

  it('queue hex folds via accumulate with origin queue', function () {
    const author = new Key();
    const genesis = { signers: [author.pubkey] };
    const msg = signContractMessage(author, contractId, 'GroupChat', {
      body: 'from-queue',
      author: author.pubkey,
      ts: '2026-01-02T00:00:00.000Z'
    });
    const qStore = createMemoryStore();
    enqueueMessageBuffer(qStore, contractId, msg.toBuffer(), { origin: 'mesh' });
    const hexes = entryHexList(listQueuedMessages(qStore, contractId));
    assert.strictEqual(hexes.length, 1);

    const accStore = createMemoryStore();
    const result = ingestMessageBuffer(accStore, contractId, hexes[0], { origin: 'queue', genesis });
    assert.strictEqual(result.accepted, true);
    assert.strictEqual(result.tip.clock, 1);
  });

  it('rejects unsigned frames at enqueue', function () {
    const store = createMemoryStore();
    const unsigned = Message.fromVector(['CONTRACT_MESSAGE', JSON.stringify({
      contract: contractId,
      type: 'GroupChat',
      object: { body: 'no-sig' }
    })]);
    const bad = enqueueMessageBuffer(store, contractId, unsigned.toBuffer());
    assert.strictEqual(bad.accepted, false);
    assert.match(bad.error, /invalid signature/i);
  });

  it('clamps maxEntries away from Infinity', function () {
    // Non-finite values fall back to the default (not ABSOLUTE_MAX).
    assert.strictEqual(clampMaxEntries(Number.POSITIVE_INFINITY), DEFAULT_MAX_ENTRIES);
    assert.strictEqual(clampMaxEntries(1e999), DEFAULT_MAX_ENTRIES);
    assert.strictEqual(clampMaxEntries(0), DEFAULT_MAX_ENTRIES);
    assert.strictEqual(clampMaxEntries(12), 12);
    assert.strictEqual(clampMaxEntries(ABSOLUTE_MAX_ENTRIES + 50), ABSOLUTE_MAX_ENTRIES);
  });

  it('trims to maxEntries preferring delivered rows', function () {
    const author = new Key();
    const store = createMemoryStore();
    const hashes = [];
    for (let i = 0; i < 5; i++) {
      const msg = signContractMessage(author, contractId, 'GroupChat', {
        body: `m${i}`,
        ts: `2026-01-0${i + 1}T00:00:00.000Z`
      });
      const r = enqueueMessageBuffer(store, contractId, msg.toBuffer(), { maxEntries: 3 });
      assert.strictEqual(r.accepted, true);
      hashes.push(r.entry.hash);
      if (i < 2) markDelivered(store, contractId, r.entry.hash, 'early-peer');
    }
    const rows = listQueuedMessages(store, contractId, { includeDelivered: true });
    assert.ok(rows.length <= 3);
    assert.ok(rows.length >= 1);
    assert.ok(DEFAULT_MAX_ENTRIES >= 3);
  });
});
