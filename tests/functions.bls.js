'use strict';

const assert = require('assert');
const Key = require('../types/key');
const bls = require('../functions/bls');
const bfs = require('../functions/beaconFederationSigning');

describe('@fabric/core/functions/bls', function () {
  this.timeout(30000);

  const secretA = Buffer.from('11'.repeat(32), 'hex');
  const secretB = Buffer.from('22'.repeat(32), 'hex');

  it('normalizes federation signature schemes', function () {
    assert.strictEqual(bls.normalizeSignatureScheme(undefined), 'schnorr');
    assert.strictEqual(bls.normalizeSignatureScheme('SCHNORR'), 'schnorr');
    assert.strictEqual(bls.normalizeSignatureScheme('bls'), 'bls');
    assert.strictEqual(bls.normalizeSignatureScheme('BLS12-381'), 'bls');
    assert.strictEqual(bls.normalizeSignatureScheme(true), 'bls');
    assert.strictEqual(bls.normalizeSignatureScheme('musig2'), 'schnorr');
  });

  it('signs and verifies a BLS12-381 minimal-pubkey-size signature', function () {
    const signer = bls.deriveFederationSigner(secretA);
    assert.strictEqual(signer.publicKey.length, bls.PUBLIC_KEY_BYTES);
    assert.strictEqual(signer.secretKey.length, bls.SECRET_KEY_BYTES);
    const again = bls.deriveFederationSigner(secretA);
    assert.strictEqual(again.publicKey.toString('hex'), signer.publicKey.toString('hex'));
    const message = Buffer.from('fabric federation', 'utf8');
    const signature = bls.sign(message, signer.secretKey);
    assert.strictEqual(signature.length, bls.SIGNATURE_BYTES);
    assert.strictEqual(bls.verify(signature, message, signer.publicKey), true);
    assert.strictEqual(bls.verify(signature, Buffer.from('other', 'utf8'), signer.publicKey), false);
    assert.strictEqual(bls.getPublicKey(signer.secretKey).toString('hex'), signer.publicKey.toString('hex'));
  });

  it('aggregates n-of-n signatures over one message', function () {
    const a = bls.deriveFederationSigner(secretA);
    const b = bls.deriveFederationSigner(secretB);
    const message = 'same message';
    const sigA = bls.sign(message, a.secretKey);
    const sigB = bls.sign(message, b.secretKey);
    const agg = bls.aggregateSignatures([sigA, sigB]);
    assert.strictEqual(bls.verifyAggregate(agg, message, [a.publicKey, b.publicKey]), true);
    assert.strictEqual(bls.verifyAggregate(agg, message, [a.publicKey]), false);
    assert.throws(() => bls.aggregateSignatures([]), /at least one/);
  });

  it('verifies a federation bundle bound to a secp256k1 validator', function () {
    const key = new Key({ private: secretA.toString('hex') });
    const message = Buffer.from('epoch signing string', 'utf8');
    const bundle = bls.createFederationBlsBundle(message, key);
    assert.strictEqual(bls.verifyFederationBlsBundle(message, key.pubkey, bundle), true);
    assert.strictEqual(bls.verifyFederationBlsBundle(message, key.pubkey, Object.assign({}, bundle, {
      link: '00'.repeat(64)
    })), false);
    const other = new Key({ private: secretB.toString('hex') });
    assert.strictEqual(bls.verifyFederationBlsBundle(message, other.pubkey, bundle), false);
  });

  it('signs v2 bundles with a domain-tagged link', function () {
    const key = new Key({ private: secretA.toString('hex') });
    const message = Buffer.from('epoch signing string', 'utf8');
    const bundle = bls.createFederationBlsBundle(message, key);
    assert.strictEqual(bls.BUNDLE_VERSION, 2);
    assert.strictEqual(bundle.v, 2);
    assert.ok(key.verifySchnorr(
      Buffer.from(bls.LINK_PREFIX + bundle.blsPublicKey, 'utf8'),
      Buffer.from(bundle.link, 'hex')
    ));
    assert.strictEqual(bls.verifyFederationBlsBundle(message, key.pubkey, bundle), true);
    assert.strictEqual(bls.verifyFederationBlsBundle(message, key.pubkey, bundle, { allowLegacy: false }), true);
    const untagged = Buffer.from(key.signSchnorr(Buffer.from(bundle.blsPublicKey, 'hex'))).toString('hex');
    assert.strictEqual(bls.verifyFederationBlsBundle(message, key.pubkey, Object.assign({}, bundle, { link: untagged })), false);
    assert.strictEqual(bls.verifyFederationBlsBundle(message, key.pubkey, Object.assign({}, bundle, { v: 3 })), false);
  });

  it('verifies legacy v1 bundles (untagged link) unless allowLegacy is false', function () {
    const key = new Key({ private: secretA.toString('hex') });
    const message = Buffer.from('epoch signing string', 'utf8');
    const bundle = bls.createFederationBlsBundle(message, key);
    const untagged = Buffer.from(key.signSchnorr(Buffer.from(bundle.blsPublicKey, 'hex'))).toString('hex');
    const legacy = Object.assign({}, bundle, { v: bls.LEGACY_BUNDLE_VERSION, link: untagged });
    assert.strictEqual(bls.verifyFederationBlsBundle(message, key.pubkey, legacy), true);
    assert.strictEqual(bls.verifyFederationBlsBundle(message, key.pubkey, legacy, { allowLegacy: false }), false);
    assert.strictEqual(bls.verifyFederationBlsBundle(message, key.pubkey, Object.assign({}, bundle, { v: 1 })), false);

    const witness = { scheme: 'bls', signatures: { [key.pubkey]: legacy } };
    assert.strictEqual(bls.verifyFederationBlsWitness(message, witness, [key.pubkey], 1), true);
    assert.strictEqual(bfs.verifyFederationWitnessOnMessage(message, witness, [key.pubkey], 1), true);
    assert.strictEqual(
      bfs.verifyFederationWitnessOnMessage(message, witness, [key.pubkey], 1, undefined, { allowLegacy: false }),
      false
    );

    const round = bfs.createRound({ clock: 1, height: 1, blockHash: 'ab'.repeat(32) }, {
      validators: [key.pubkey],
      threshold: 1,
      signatureScheme: 'bls'
    });
    const roundMsg = bfs.messageBufferForPayload(round.payload);
    const legacyForRound = Object.assign(bls.createFederationBlsBundle(roundMsg, key), { v: 1 });
    legacyForRound.link = untagged;
    assert.strictEqual(bfs.addSignature(round, key.pubkey, JSON.stringify(legacyForRound)).ok, false);
  });

  it('accepts an x-only validator id for a BLS bundle', function () {
    const key = new Key({ private: secretB.toString('hex') });
    const message = Buffer.from('epoch signing string', 'utf8');
    const bundle = bls.createFederationBlsBundle(message, key);
    const xOnly = key.pubkey.slice(2);
    assert.strictEqual(bls.verifyFederationBlsBundle(message, xOnly, bundle), true);
    const witness = { scheme: 'bls', signatures: { [key.pubkey]: bundle } };
    assert.strictEqual(bls.verifyFederationBlsWitness(message, witness, [xOnly], 1), true);
  });

  it('counts one bundle once when a validator id is respelled', function () {
    const key = new Key({ private: secretA.toString('hex') });
    const message = Buffer.from('epoch signing string', 'utf8');
    const bundle = bls.createFederationBlsBundle(message, key);
    const upper = key.pubkey.toUpperCase();
    const witness = { scheme: 'bls', signatures: { [key.pubkey]: bundle, [upper]: bundle } };
    assert.strictEqual(bls.verifyFederationBlsWitness(message, witness, [key.pubkey, upper], 1), true);
    assert.strictEqual(bls.verifyFederationBlsWitness(message, witness, [key.pubkey, upper], 2), false);
  });

  it('counts one Schnorr signature once when a validator id is respelled', function () {
    const key = new Key({ private: secretA.toString('hex') });
    const msg = Buffer.from('epoch signing string', 'utf8');
    const sig = Buffer.from(key.signSchnorr(msg)).toString('hex');
    const upper = key.pubkey.toUpperCase();
    const witness = { signatures: { [key.pubkey]: sig, [upper]: sig } };
    assert.strictEqual(bfs.verifyFederationWitnessOnMessage(msg, witness, [key.pubkey, upper], 1), true);
    assert.strictEqual(bfs.verifyFederationWitnessOnMessage(msg, witness, [key.pubkey, upper], 2), false);
  });

  it('defaults a round threshold to a strict majority', function () {
    const keys = [secretA, secretB, Buffer.from('33'.repeat(32), 'hex')]
      .map((s) => new Key({ private: s.toString('hex') }).pubkey);
    const epoch = { clock: 1, blockHash: 'cd'.repeat(32), height: 2 };
    assert.strictEqual(bfs.createRound(epoch, { validators: keys }).threshold, 2);
    assert.strictEqual(bfs.createRound(epoch, { validators: keys, threshold: 1 }).threshold, 1);
  });

  it('collects a k-of-n BLS witness on a beacon round', function () {
    const k1 = new Key({ private: secretA.toString('hex') });
    const k2 = new Key({ private: secretB.toString('hex') });
    const k3 = new Key({ private: '33'.repeat(32) });
    const epoch = { clock: 3, blockHash: 'ab'.repeat(32), height: 9 };
    const round = bfs.createRound(epoch, {
      validators: [k1.pubkey, k2.pubkey, k3.pubkey],
      threshold: 2,
      signatureScheme: 'bls'
    });
    assert.strictEqual(round.signatureScheme, 'bls');
    assert.strictEqual(round.witness.scheme, 'bls');
    assert.strictEqual(bfs.roundMeetsThreshold(round), false);
    const msg = bfs.messageBufferForPayload(epoch);
    const b1 = bls.createFederationBlsBundle(msg, k1);
    const b2 = bls.createFederationBlsBundle(msg, k2);
    assert.strictEqual(bfs.addSignature(round, k1.pubkey, b1).sealed, false);
    assert.strictEqual(bfs.addSignature(round, k2.pubkey, JSON.stringify(b2)).sealed, true);
    assert.strictEqual(bfs.addSignature(round, k3.pubkey, 'not-a-bundle').ok, false);
    const req = bfs.encodeSignRequest(round);
    assert.strictEqual(req.signatureScheme, 'bls');
  });
});
