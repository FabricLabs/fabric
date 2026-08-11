'use strict';

const assert = require('assert');
const Key = require('../types/key');
const Message = require('../types/message');
const {
  createMemoryStore,
  ingestMessageBuffer,
  foldContractState,
  stateDigest,
  bufferFromPaste,
  tipFromDoc,
  loadDoc
} = require('../functions/contractMessageAccumulate');
const {
  createPending,
  markReceived,
  markReceipt,
  phaseFlags,
  allPhasesComplete,
  aggregatePhaseFlags,
  pendingForRelay
} = require('../functions/contractMessageCommit');

function signContractMessage (key, contractId, type, object) {
  const body = JSON.stringify({
    contract: contractId,
    type,
    object
  });
  return Message.fromVector(['CONTRACT_MESSAGE', body]).signWithKey(key);
}

describe('@fabric/core contractMessageAccumulate', function () {
  const contractId = 'c'.repeat(64);

  it('idempotent multi-origin ingest of the same AMP bytes', function () {
    const author = new Key();
    const msg = signContractMessage(author, contractId, 'GroupChat', {
      body: 'hello',
      author: author.pubkey,
      ts: '2026-01-01T00:00:00.000Z'
    });
    const buf = msg.toBuffer();
    const paste = `fabric:${buf.toString('hex')}`;

    const store = createMemoryStore();
    const a = ingestMessageBuffer(store, contractId, buf, { origin: 'mesh' });
    assert.strictEqual(a.accepted, true);
    const b = ingestMessageBuffer(store, contractId, buf, { origin: 'queue' });
    assert.strictEqual(b.duplicate, true);
    const c = ingestMessageBuffer(store, contractId, paste, { origin: 'paste' });
    assert.strictEqual(c.duplicate, true);
    assert.strictEqual(a.tip.stateDigest, b.tip.stateDigest);
    assert.strictEqual(a.tip.stateDigest, c.tip.stateDigest);
    assert.strictEqual(a.tip.clock, 1);
    assert.strictEqual(loadDoc(store, contractId).entries.length, 1);
  });

  it('arrival-order independence across peers', function () {
    const aKey = new Key();
    const bKey = new Key();
    const m1 = signContractMessage(aKey, contractId, 'GroupChange', {
      action: 'members.set',
      members: [aKey.pubkey, bKey.pubkey]
    });
    const m2 = signContractMessage(aKey, contractId, 'GroupChat', { body: 'one', author: aKey.pubkey });
    const m3 = signContractMessage(bKey, contractId, 'GroupChat', { body: 'two', author: bKey.pubkey });
    const bufs = [m1.toBuffer(), m2.toBuffer(), m3.toBuffer()];

    const storeA = createMemoryStore();
    for (const buf of bufs) ingestMessageBuffer(storeA, contractId, buf, { origin: 'mesh' });

    const storeB = createMemoryStore();
    for (const buf of [bufs[2], bufs[0], bufs[1]]) {
      ingestMessageBuffer(storeB, contractId, buf, { origin: 'mesh' });
    }

    const storeC = createMemoryStore();
    ingestMessageBuffer(storeC, contractId, `fabric:${bufs[1].toString('hex')}`, { origin: 'paste' });
    ingestMessageBuffer(storeC, contractId, bufs[0], { origin: 'queue' });
    ingestMessageBuffer(storeC, contractId, bufs[2], { origin: 'mesh' });

    const tipA = tipFromDoc(loadDoc(storeA, contractId));
    const tipB = tipFromDoc(loadDoc(storeB, contractId));
    const tipC = tipFromDoc(loadDoc(storeC, contractId));
    assert.strictEqual(tipA.stateDigest, tipB.stateDigest);
    assert.strictEqual(tipA.stateDigest, tipC.stateDigest);
    assert.strictEqual(tipA.clock, 3);
    assert.deepStrictEqual(tipA.content.members.slice().sort(), tipB.content.members.slice().sort());
  });

  it('publisher local accumulate matches paste-only participant', function () {
    const publisher = new Key();
    const peer = new Key();
    const out = signContractMessage(publisher, contractId, 'GroupChat', {
      body: 'from publisher',
      author: publisher.pubkey
    });
    const reply = signContractMessage(peer, contractId, 'GroupChat', {
      body: 'reply',
      author: peer.pubkey
    });

    const pubStore = createMemoryStore();
    ingestMessageBuffer(pubStore, contractId, out.toBuffer(), { origin: 'local' });
    ingestMessageBuffer(pubStore, contractId, reply.toBuffer(), { origin: 'mesh' });

    const partStore = createMemoryStore();
    ingestMessageBuffer(partStore, contractId, `fabric:${out.toBuffer().toString('hex')}`, { origin: 'paste' });
    ingestMessageBuffer(partStore, contractId, reply.toBuffer(), { origin: 'mesh' });

    assert.strictEqual(
      tipFromDoc(loadDoc(pubStore, contractId)).stateDigest,
      tipFromDoc(loadDoc(partStore, contractId)).stateDigest
    );
  });

  it('rejects wrong contract, bad signature, and leaves tip unchanged', function () {
    const author = new Key();
    const attacker = new Key();
    const store = createMemoryStore();
    const good = signContractMessage(author, contractId, 'GroupChat', { body: 'ok' });
    ingestMessageBuffer(store, contractId, good.toBuffer(), { origin: 'mesh' });
    const tip0 = tipFromDoc(loadDoc(store, contractId)).stateDigest;

    const wrongContract = signContractMessage(author, 'd'.repeat(64), 'GroupChat', { body: 'nope' });
    const badContract = ingestMessageBuffer(store, contractId, wrongContract.toBuffer());
    assert.strictEqual(badContract.accepted, false);
    assert.match(badContract.error, /mismatch/i);

    const forged = Message.fromVector(['CONTRACT_MESSAGE', JSON.stringify({
      contract: contractId,
      type: 'GroupChat',
      object: { body: 'evil' }
    })]).signWithKey(attacker);
    // Corrupt signature bytes
    const buf = forged.toBuffer();
    buf[buf.length - 1] ^= 0xff;
    const badSig = ingestMessageBuffer(store, contractId, buf);
    assert.strictEqual(badSig.accepted, false);

    assert.strictEqual(tipFromDoc(loadDoc(store, contractId)).stateDigest, tip0);
  });

  it('bufferFromPaste accepts fabric: prefix', function () {
    const buf = Buffer.from('abcd', 'hex');
    assert.ok(bufferFromPaste(`fabric:${buf.toString('hex')}`).equals(buf));
  });

  it('foldContractState sorts by hash', function () {
    const entries = [
      { hash: 'bb', type: 'GroupChat', object: { body: 'b' } },
      { hash: 'aa', type: 'GroupChat', object: { body: 'a' } }
    ];
    const state = foldContractState(entries);
    assert.strictEqual(state.content.messages[0].body, 'a');
    assert.strictEqual(state.clock, 2);
    assert.ok(stateDigest(state));
  });
});

describe('@fabric/core contractMessageCommit', function () {
  it('tracks per-reader received and receipt phases', function () {
    const a = new Key();
    const b = new Key();
    const record = createPending({
      id: 'm1',
      contractId: 'c'.repeat(64),
      readers: [a.pubkey, b.pubkey]
    });
    assert.deepStrictEqual(phaseFlags(record, a.pubkey), { received: false, receipt: false });
    markReceived(record, a.pubkey);
    assert.strictEqual(phaseFlags(record, a.pubkey).received, true);
    assert.strictEqual(aggregatePhaseFlags(record).received, false);
    markReceived(record, b.pubkey);
    assert.strictEqual(aggregatePhaseFlags(record).received, true);
    assert.strictEqual(allPhasesComplete(record), false);
    markReceipt(record, a.pubkey);
    markReceipt(record, b.pubkey, null, 'sig');
    assert.strictEqual(allPhasesComplete(record), true);
    assert.deepStrictEqual(aggregatePhaseFlags(record), { received: true, receipt: true });
    assert.strictEqual(pendingForRelay([record]).length, 0);
  });

  it('rejects mark for non-reader', function () {
    const a = new Key();
    const outsider = new Key();
    const record = createPending({
      id: 'm2',
      contractId: 'c'.repeat(64),
      readers: [a.pubkey]
    });
    assert.throws(() => markReceived(record, outsider.pubkey), /reader set/);
  });
});
