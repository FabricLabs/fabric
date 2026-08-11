'use strict';

const assert = require('assert');
const {
  SEAL_SCHEME,
  sortedMemberXOnlys,
  deriveTimelineCipherKey,
  sealGroupChatBody,
  openGroupChatBody,
  isSealedGroupChat
} = require('../functions/groupChatSeal');
const Key = require('../types/key');

describe('@fabric/core groupChatSeal', function () {
  const a = new Key();
  const b = new Key();
  const contractId = 'a'.repeat(64);
  const digest = require('crypto').createHash('sha256').update('tip-content').digest('hex');

  it('sortedMemberXOnlys normalizes compressed and x-only', function () {
    const xa = a.pubkey.slice(2).toLowerCase();
    const list = sortedMemberXOnlys([b.pubkey, a.pubkey, xa, 'nope']);
    assert.strictEqual(list.length, 2);
    assert.deepStrictEqual(list, list.slice().sort());
  });

  it('deriveTimelineCipherKey is deterministic for same tip+members', function () {
    const opts = {
      contractId,
      clock: 7,
      stateDigest: digest,
      memberPubkeys: [a.pubkey, b.pubkey]
    };
    const k1 = deriveTimelineCipherKey(opts);
    const k2 = deriveTimelineCipherKey({
      ...opts,
      memberPubkeys: [b.pubkey, a.pubkey]
    });
    assert.ok(Buffer.isBuffer(k1) && k1.length === 32);
    assert.strictEqual(k1.toString('hex'), k2.toString('hex'));
  });

  it('deriveTimelineCipherKey changes when tip or roster changes', function () {
    const base = {
      contractId,
      clock: 7,
      stateDigest: digest,
      memberPubkeys: [a.pubkey, b.pubkey]
    };
    const k0 = deriveTimelineCipherKey(base);
    const kClock = deriveTimelineCipherKey({ ...base, clock: 8 });
    const c = new Key();
    const kMembers = deriveTimelineCipherKey({
      ...base,
      memberPubkeys: [a.pubkey, b.pubkey, c.pubkey]
    });
    assert.notStrictEqual(k0.toString('hex'), kClock.toString('hex'));
    assert.notStrictEqual(k0.toString('hex'), kMembers.toString('hex'));
  });

  it('seal/open round-trip', function () {
    const tip = {
      contractId,
      clock: 2,
      stateDigest: digest,
      memberPubkeys: [a.pubkey, b.pubkey]
    };
    const seal = sealGroupChatBody({ body: 'hello sealed group', ...tip });
    assert.strictEqual(seal.scheme, SEAL_SCHEME);
    assert.strictEqual(seal.basisClock, 2);
    assert.ok(isSealedGroupChat({ seal }));
    const plain = openGroupChatBody(seal, tip);
    assert.strictEqual(plain, 'hello sealed group');
  });

  it('open fails on wrong tip clock', function () {
    const tip = {
      contractId,
      clock: 2,
      stateDigest: digest,
      memberPubkeys: [a.pubkey, b.pubkey]
    };
    const seal = sealGroupChatBody({ body: 'secret', ...tip });
    assert.throws(() => openGroupChatBody(seal, { ...tip, clock: 3 }), /clock/);
  });
});
