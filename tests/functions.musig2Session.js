'use strict';

const assert = require('assert');
const Key = require('../types/key');
const Message = require('../types/message');
const { individualPk, verifyAggregatedSchnorr } = require('../functions/musig2');
const {
  packPubkeys,
  unpackPubkeys,
  createLocalSession,
  createFromStart,
  recordPubnonce,
  allPubnoncesPresent,
  computeAggNonce,
  setAggNonce,
  createPartial,
  recordPartial,
  allPartialsPresent,
  aggregatePartials,
  verifyFinalSignature,
  xOnlyHex,
  startFields
} = require('../functions/musig2Session');

function skOf (key) {
  return Buffer.isBuffer(key.private) ? key.private : Buffer.from(String(key.private), 'hex');
}

function runRound (keys, msg) {
  const sks = keys.map(skOf);
  const pks = sks.map((sk) => individualPk(sk));
  const initiator = createLocalSession({
    msg,
    pubkeys: pks,
    sk: sks[0],
    purpose: 'test'
  });
  const sessions = [initiator];
  const author = xOnlyHex(pks[0]);
  for (let i = 1; i < keys.length; i++) {
    const made = createFromStart(startFields(initiator), {
      sk: sks[i],
      signerXOnly: author
    });
    assert.strictEqual(made.ok, true, made.reason);
    sessions.push(made.session);
  }
  for (let i = 0; i < sessions.length; i++) {
    for (let j = 0; j < sessions.length; j++) {
      if (i === j) continue;
      const rec = recordPubnonce(
        sessions[i],
        xOnlyHex(pks[j]),
        sessions[j].ownPubnonce
      );
      assert.strictEqual(rec.ok, true, rec.reason);
    }
    assert.strictEqual(allPubnoncesPresent(sessions[i]), true);
  }
  const aggnonce = computeAggNonce(initiator);
  assert.ok(aggnonce);
  for (const session of sessions) {
    const set = setAggNonce(session, aggnonce);
    assert.strictEqual(set.ok, true, set.reason);
  }
  const psigs = [];
  for (let i = 0; i < sessions.length; i++) {
    const signed = createPartial(sessions[i], sks[i]);
    assert.strictEqual(signed.ok, true, signed.reason);
    psigs.push(signed.psig);
  }
  for (let i = 0; i < sessions.length; i++) {
    for (let j = 0; j < sessions.length; j++) {
      if (i === j) continue;
      const rec = recordPartial(sessions[i], xOnlyHex(pks[j]), psigs[j]);
      assert.strictEqual(rec.ok, true, rec.reason);
    }
    assert.strictEqual(allPartialsPresent(sessions[i]), true);
  }
  const agg = aggregatePartials(initiator);
  assert.strictEqual(agg.ok, true, agg.reason);
  for (let i = 1; i < sessions.length; i++) {
    const v = verifyFinalSignature(sessions[i], agg.signature);
    assert.strictEqual(v.ok, true, v.reason);
  }
  assert.strictEqual(
    verifyAggregatedSchnorr(initiator.challenge, agg.signature, initiator.pubkeys),
    true
  );
  return { initiator, signature: agg.signature, pubkeys: initiator.pubkeys };
}

describe('@fabric/core/functions/musig2Session', function () {
  it('packs and unpacks compressed pubkeys', function () {
    const a = individualPk(skOf(new Key()));
    const b = individualPk(skOf(new Key()));
    const packed = packPubkeys([b, a]);
    const unpacked = unpackPubkeys(packed);
    assert.strictEqual(unpacked.length, 2);
    assert.strictEqual(packed.length, 66);
  });

  it('completes a 2-of-2 session', function () {
    runRound([new Key(), new Key()], Buffer.from('hello musig2'));
  });

  it('completes a 3-of-3 session', function () {
    runRound([new Key(), new Key(), new Key()], Buffer.from('three party'));
  });

  it('rejects a START whose AMP signer is not a participant', function () {
    const a = new Key();
    const b = new Key();
    const rogue = new Key();
    const session = createLocalSession({
      msg: Buffer.from('x'),
      pubkeys: [individualPk(skOf(a)), individualPk(skOf(b))],
      sk: skOf(a)
    });
    const made = createFromStart(startFields(session), {
      sk: skOf(b),
      signerXOnly: xOnlyHex(individualPk(skOf(rogue)))
    });
    assert.strictEqual(made.ok, false);
    assert.strictEqual(made.reason, 'signer-not-participant');
  });

  it('rejects a claimed aggnonce that does not recompute', function () {
    const a = new Key();
    const b = new Key();
    const session = createLocalSession({
      msg: Buffer.from('x'),
      pubkeys: [individualPk(skOf(a)), individualPk(skOf(b))],
      sk: skOf(a)
    });
    const other = createFromStart(startFields(session), {
      sk: skOf(b),
      signerXOnly: xOnlyHex(individualPk(skOf(a)))
    });
    assert.ok(other.ok);
    recordPubnonce(session, xOnlyHex(individualPk(skOf(b))), other.session.ownPubnonce);
    const fake = Buffer.alloc(66, 2);
    fake[0] = 0x02;
    fake[33] = 0x02;
    const set = setAggNonce(session, fake);
    assert.strictEqual(set.ok, false);
    assert.strictEqual(set.reason, 'aggnonce-mismatch');
  });

  it('encodes P2P_MUSIG_START as a first-class AMP type', function () {
    const a = new Key();
    const b = new Key();
    const session = createLocalSession({
      msg: Buffer.from('wire'),
      pubkeys: [individualPk(skOf(a)), individualPk(skOf(b))],
      sk: skOf(a)
    });
    const msg = Message.fromFields('P2P_MUSIG_START', startFields(session));
    assert.strictEqual(msg.type, 'P2P_MUSIG_START');
    const decoded = Message.fromBuffer(msg.toBuffer());
    assert.strictEqual(decoded.type, 'P2P_MUSIG_START');
    const fields = decoded.toFields();
    assert.ok(fields);
    assert.ok(Buffer.isBuffer(fields.sessionId));
    assert.strictEqual(fields.sessionId.equals(session.sessionId), true);
  });
});
