'use strict';

const assert = require('assert');
const {
  SEAL_SCHEME,
  SEAL_SCHEME_PARTICIPANT,
  sortedMemberXOnlys,
  deriveTimelineCipherKey,
  sealGroupChatBody,
  sealParticipantGroupChatBody,
  openGroupChatBody,
  isSealedGroupChat,
  isParticipantSealedGroupChat,
  pubkeyXOnly
} = require('../functions/groupChatSeal');
const Key = require('../types/key');

describe('@fabric/core groupChatSeal', function () {
  const a = new Key();
  const b = new Key();
  const contractId = 'a'.repeat(64);
  const digest = require('crypto').createHash('sha256').update('tip-content').digest('hex');

  it('sortedMemberXOnlys normalizes compressed and x-only', function () {
    const xa = pubkeyXOnly(a.pubkey);
    assert.ok(xa && xa.length === 64);
    assert.strictEqual(pubkeyXOnly(`02${xa}`), xa);
    assert.strictEqual(pubkeyXOnly(`03${xa}`), xa);
    const list = sortedMemberXOnlys([b.pubkey, a.pubkey, xa, 'nope']);
    assert.strictEqual(list.length, 2);
    assert.ok(list.includes(xa));
    assert.ok(list.includes(pubkeyXOnly(b.pubkey)));
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

  it('deriveTimelineCipherKey rejects missing or non-integer clocks', function () {
    const base = {
      contractId,
      stateDigest: digest,
      memberPubkeys: [a.pubkey]
    };
    assert.throws(() => deriveTimelineCipherKey({ ...base }), /non-negative integer/);
    assert.throws(() => deriveTimelineCipherKey({ ...base, clock: null }), /non-negative integer/);
    assert.throws(() => deriveTimelineCipherKey({ ...base, clock: 'nope' }), /non-negative integer/);
    assert.throws(() => deriveTimelineCipherKey({ ...base, clock: 1.5 }), /non-negative integer/);
    assert.throws(() => deriveTimelineCipherKey({ ...base, clock: -1 }), /non-negative integer/);
    const ok = deriveTimelineCipherKey({ ...base, clock: 0 });
    assert.ok(Buffer.isBuffer(ok) && ok.length === 32);
  });

  it('seal/open round-trip (v1 tip)', function () {
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

  it('open fails on wrong stateDigest, roster, or tampered ciphertext', function () {
    const tip = {
      contractId,
      clock: 2,
      stateDigest: digest,
      memberPubkeys: [a.pubkey, b.pubkey]
    };
    const seal = sealGroupChatBody({ body: 'secret', ...tip });

    const otherDigest = require('crypto').createHash('sha256').update('other-tip').digest('hex');
    assert.throws(
      () => openGroupChatBody(seal, { ...tip, stateDigest: otherDigest }),
      /stateDigest/
    );

    // Same clock/digest but different roster → different HKDF salt → AES-GCM auth fail.
    const c = new Key();
    assert.throws(
      () => openGroupChatBody(seal, {
        ...tip,
        memberPubkeys: [a.pubkey, b.pubkey, c.pubkey]
      }),
      /auth|Unsupported state|bad decrypt|unable to authenticate/i
    );

    const ct = Buffer.from(seal.ciphertext, 'base64');
    ct[0] ^= 0xff;
    const tamperedSeal = { ...seal, ciphertext: ct.toString('base64') };
    assert.throws(
      () => openGroupChatBody(tamperedSeal, tip),
      /auth|Unsupported state|bad decrypt|unable to authenticate/i
    );
  });

  it('participant seal opens for each member and not for outsiders', function () {
    const seal = sealParticipantGroupChatBody({
      body: 'hub-blind ops',
      memberPubkeys: [a.pubkey, b.pubkey],
      contractId,
      clock: 9,
      stateDigest: digest
    });
    assert.strictEqual(seal.scheme, SEAL_SCHEME_PARTICIPANT);
    assert.ok(isParticipantSealedGroupChat(seal));
    assert.ok(isSealedGroupChat({ seal }));
    assert.ok(Array.isArray(seal.wraps) && seal.wraps.length === 2);
    assert.ok(seal.ephemeralPub);
    // Tip fields on the seal are bound as AES-GCM AAD (not key material).
    assert.strictEqual(seal.basisClock, 9);
    assert.strictEqual(seal.contractId, contractId);
    assert.strictEqual(seal.stateDigest, digest);

    assert.throws(
      () => sealParticipantGroupChatBody({
        body: 'x',
        memberPubkeys: [a.pubkey],
        clock: -1
      }),
      /non-negative integer/
    );
    assert.throws(
      () => sealParticipantGroupChatBody({
        body: 'x',
        memberPubkeys: [a.pubkey],
        clock: 1.5
      }),
      /non-negative integer/
    );
    assert.throws(
      () => sealParticipantGroupChatBody({
        body: 'x',
        memberPubkeys: [a.pubkey],
        clock: 'nope'
      }),
      /non-negative integer/
    );

    assert.strictEqual(
      openGroupChatBody(seal, { keyOrPrivate: a }),
      'hub-blind ops'
    );
    assert.strictEqual(
      openGroupChatBody(seal, { keyOrPrivate: b }),
      'hub-blind ops'
    );

    const outsider = new Key();
    assert.throws(
      () => openGroupChatBody(seal, { keyOrPrivate: outsider }),
      /no wrap/
    );

    // Cut-and-paste across contract id fails AAD auth even with a valid wrap key.
    assert.throws(
      () => openGroupChatBody({ ...seal, contractId: 'b'.repeat(64) }, { keyOrPrivate: a }),
      /auth|Unsupported state|bad decrypt|unable to authenticate/i
    );
  });

  it('participant seal does not use tip HKDF (hub tip holders stay blind)', function () {
    const seal = sealGroupChatBody({
      mode: 'participant',
      body: 'still secret',
      memberPubkeys: [a.pubkey, b.pubkey],
      contractId,
      clock: 1,
      stateDigest: digest
    });
    // ECDH wrap opens without supplying tip opts; tip holders without privkeys stay blind.
    assert.strictEqual(
      openGroupChatBody(seal, { keyOrPrivate: a.xprv ? { xprv: a.xprv } : a }),
      'still secret'
    );
  });
});
