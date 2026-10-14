'use strict';

const assert = require('assert');
const crypto = require('crypto');
const bitcoin = require('bitcoinjs-lib');
const { secp256k1, schnorr } = require('@noble/curves/secp256k1.js');

const Bond = require('../types/bond');
const Challenge = require('../types/challenge');
const Witness = require('../types/witness');
const Document = require('../types/document');
const { signerFromPriv32 } = require('../functions/inventoryHtlc');

const { FraudProof } = Witness;

function keypair () {
  const priv = crypto.randomBytes(32);
  return {
    priv,
    pub: Buffer.from(secp256k1.getPublicKey(priv, true)).toString('hex'),
    xOnly: Buffer.from(schnorr.getPublicKey(priv)).toString('hex')
  };
}

function fundingFor (address, sats = 50_000n) {
  const tx = new bitcoin.Transaction();
  tx.version = 2;
  tx.addInput(crypto.randomBytes(32), 0);
  tx.addOutput(bitcoin.address.toOutputScript(address, bitcoin.networks.regtest), sats);
  return tx.toHex();
}

describe('Market bonds, challenges, and fraud proofs (Phase 3)', function () {
  this.timeout(20000);

  const publisher = keypair();
  const provider = keypair();
  const stranger = keypair();
  const challenger = new Challenge({ deadlineEpochs: 2 });
  let doc;
  let hashes;

  before(() => {
    doc = Document.seal(crypto.randomBytes(7000), { chunkBytes: 2048, documentId: 'bounty-demo' });
    hashes = doc.record().blobs.map((b) => b.blobHashHex);
    assert.ok(hashes.length >= 3);
  });

  it('signed artifacts verify and reject tampering', () => {
    const a = Witness.signArtifact({ type: 'Offer', blobHashHex: hashes[0], rateSats: 5 }, provider.priv);
    assert.strictEqual(a.pubkey, provider.xOnly);
    assert.ok(Witness.verifyArtifact(a));
    assert.ok(Witness.verifyArtifact(a, provider.xOnly));
    assert.ok(!Witness.verifyArtifact(a, stranger.xOnly));
    assert.ok(!Witness.verifyArtifact(Object.assign({}, a, { rateSats: 1 })));
  });

  it('challenge → response round-trip validates with the possession digest', () => {
    const challenge = challenger.issue({
      merkleRootHex: doc.merkleRootHex, blobHashes: hashes, epoch: 10,
      providerPubkey: provider.xOnly, publisherPrivateKey: publisher.priv
    });
    assert.strictEqual(challenge.type, 'AvailabilityChallenge');
    assert.strictEqual(challenge.deadlineEpoch, 12);
    assert.strictEqual(challenge.blobHashHex, hashes[challenge.blobIndex]);
    assert.strictEqual(Challenge.leafIndexFor(doc.merkleRootHex, 10, challenge.nonceHex, hashes.length), challenge.blobIndex);

    const bytes = doc.bytesFor(challenge.blobIndex);
    const response = challenger.respond(challenge, { blobHashes: hashes, bytes, epoch: 11, providerPrivateKey: provider.priv });
    assert.strictEqual(response.type, 'AvailabilityResponse');
    assert.deepStrictEqual(challenger.validate(challenge, response, { bytes }), { ok: true, reason: null, late: false, fraud: null });
    assert.strictEqual(challenger.validate(challenge, response, { bytes: Buffer.from('nope') }).ok, false);
    assert.strictEqual(challenger.proofFor(challenge, response), null);
  });

  it('wrong-leaf: a response for the wrong blob is provable fraud', () => {
    const challenge = challenger.issue({
      merkleRootHex: doc.merkleRootHex, blobHashes: hashes, epoch: 20,
      providerPubkey: provider.xOnly, publisherPrivateKey: publisher.priv
    });
    const wrongIndex = (challenge.blobIndex + 1) % hashes.length;
    // A cheating provider answers the real challenge with a different (valid) leaf.
    const honest = challenger.respond(challenge, { blobHashes: hashes, epoch: 20, providerPrivateKey: provider.priv });
    const { createBlobMerkleTree } = require('../functions/documentBlobManifest');
    const wrongProof = createBlobMerkleTree(hashes).proveInclusion(hashes[wrongIndex]);
    const cheat = Witness.signArtifact(Object.assign({}, honest, {
      blobIndex: wrongIndex,
      blobHashHex: hashes[wrongIndex],
      proof: { proof: wrongProof.proof, leafCount: wrongProof.leafCount }
    }), provider.priv);
    const v = challenger.validate(challenge, cheat);
    assert.strictEqual(v.ok, false);
    assert.strictEqual(v.fraud, 'wrong-leaf');
    const proof = challenger.proofFor(challenge, cheat);
    assert.ok(proof instanceof FraudProof);
    const verdict = FraudProof.fromBody(JSON.parse(JSON.stringify(proof.toBody()))).verify();
    assert.strictEqual(verdict.ok, true);
    assert.strictEqual(verdict.offender, provider.xOnly);
  });

  it('non-response: provable only against the epoch clock with a commitment', () => {
    const commitment = Challenge.commit({
      merkleRootHex: doc.merkleRootHex, blobTotal: hashes.length, fromEpoch: 0, untilEpoch: 100,
      providerPrivateKey: provider.priv, publisherPubkey: publisher.xOnly
    });
    const challenge = challenger.issue({
      merkleRootHex: doc.merkleRootHex, blobHashes: hashes, epoch: 30,
      providerPubkey: provider.xOnly, publisherPrivateKey: publisher.priv
    });
    assert.strictEqual(challenger.proofFor(challenge, null, { commitment, epoch: 31 }), null, 'deadline not passed');
    const proof = challenger.proofFor(challenge, null, { commitment, epoch: 33 });
    assert.ok(proof);
    assert.strictEqual(proof.verify({ epoch: 32 }).ok, false, 'verifier clock still inside deadline');
    assert.strictEqual(proof.verify({ epoch: 33 }).ok, true);
    const late = challenger.respond(challenge, { blobHashes: hashes, epoch: 40, providerPrivateKey: provider.priv });
    const lateProof = challenger.proofFor(challenge, late, { commitment });
    assert.strictEqual(lateProof.kind, 'non-response');
    assert.strictEqual(lateProof.verify().ok, true);
    // A commitment from someone else does not implicate this provider.
    const other = Challenge.commit({ merkleRootHex: doc.merkleRootHex, fromEpoch: 0, untilEpoch: 100, providerPrivateKey: stranger.priv });
    assert.strictEqual(new FraudProof({ kind: 'non-response', artifacts: { challenge, commitment: other } }).verify({ epoch: 99 }).ok, false);
  });

  it('wrong-bytes: signed offer + preimage + mismatching ciphertext', () => {
    const preimage = crypto.randomBytes(32);
    const offer = Witness.signArtifact({
      type: 'DocumentOffer', blobHashHex: hashes[0], rateSats: 3,
      paymentHashHex: crypto.createHash('sha256').update(preimage).digest('hex')
    }, provider.priv);
    const bad = new FraudProof({ kind: 'wrong-bytes', artifacts: { offer, claim: { preimageHex: preimage.toString('hex') }, bytesHex: Buffer.from('garbage').toString('hex') } });
    assert.strictEqual(bad.verify().ok, true);
    const good = new FraudProof({ kind: 'wrong-bytes', artifacts: { offer, claim: { preimageHex: preimage.toString('hex') }, bytesHex: doc.bytesFor(0).toString('hex') } });
    assert.strictEqual(good.verify().ok, false, 'honest delivery is not fraud');
  });

  it('wrongful-penalty: the provider can always publish the counter-proof', () => {
    const challenge = challenger.issue({
      merkleRootHex: doc.merkleRootHex, blobHashes: hashes, epoch: 50,
      providerPubkey: provider.xOnly, publisherPrivateKey: publisher.priv
    });
    const response = challenger.respond(challenge, { blobHashes: hashes, epoch: 51, providerPrivateKey: provider.priv });
    const counter = Challenge.wrongfulPenaltyProof(challenge, response, { txid: 'ab'.repeat(32) });
    const verdict = counter.verify();
    assert.strictEqual(verdict.ok, true);
    assert.strictEqual(verdict.offender, publisher.xOnly);
  });

  it('bounty: per-epoch outputs, deterministic preimages, claim + refund PSBTs', () => {
    const seed = crypto.randomBytes(32);
    const bounty = Bond.buildBounty({
      network: 'regtest', publisherPubkey: publisher.pub, providerPubkeys: [provider.pub, stranger.pub],
      seed, epochs: [{ epoch: 1, amountSats: 20000 }, { epoch: 2, amountSats: 20000 }], refundAfter: 800,
      merkleRootHex: doc.merkleRootHex
    });
    assert.strictEqual(bounty.outputs.length, 2);
    assert.notStrictEqual(bounty.outputs[0].address, bounty.outputs[1].address);
    assert.deepStrictEqual(bounty.outputs[0].leaves.map((l) => l.id).sort(), ['claim-e1-' + provider.pub.slice(0, 16), 'claim-e1-' + stranger.pub.slice(0, 16), 'refund'].sort());
    const restored = Bond.fromRecord(JSON.parse(JSON.stringify(Bond.toRecord(bounty))));
    assert.strictEqual(restored.outputs[1].address, bounty.outputs[1].address);

    const preimage = Bond.deriveEpochPreimage(seed, 1, provider.pub);
    const funded = fundingFor(bounty.outputs[0].address);
    const dest = bitcoin.payments.p2wpkh({ pubkey: Buffer.from(provider.pub, 'hex'), network: bitcoin.networks.regtest }).address;
    const claim = Bond.prepareBountyClaim(restored, { epoch: 1, providerPubkey: provider.pub, preimageHex: preimage, fundedTxHex: funded, destinationAddress: dest, feeSats: 500 });
    assert.ok(claim.psbtBase64);
    assert.strictEqual(claim.witnessShape, 'preimage+sig');
    const psbt = bitcoin.Psbt.fromBase64(claim.psbtBase64, { network: bitcoin.networks.regtest });
    psbt.signInput(0, signerFromPriv32(provider.priv));
    const tx = Bond.finalizeClaim(psbt.toBase64(), preimage);
    assert.ok(/^[0-9a-f]{64}$/.test(tx.txid));
    assert.throws(() => Bond.prepareBountyClaim(restored, { epoch: 1, providerPubkey: stranger.pub, preimageHex: preimage, fundedTxHex: funded, destinationAddress: dest }), /does not open/);

    const refund = Bond.prepareBountyRefund(restored, { epoch: 1, fundedTxHex: funded, destinationAddress: dest, feeSats: 500 });
    assert.strictEqual(refund.locktime, 800);
  });

  it('deposit: penalty spend is impossible without a verifying fraud proof naming the provider', () => {
    const deposit = Bond.buildDeposit({ network: 'regtest', providerPubkey: provider.pub, publisherPubkey: publisher.pub, withdrawAfter: 900, amountSats: 30000 });
    const funded = fundingFor(deposit.address);
    const dest = bitcoin.payments.p2wpkh({ pubkey: Buffer.from(publisher.pub, 'hex'), network: bitcoin.networks.regtest }).address;
    assert.throws(() => Bond.preparePenaltySpend(deposit, { fundedTxHex: funded, destinationAddress: dest }), /fraudProof required/);

    const challenge = challenger.issue({ merkleRootHex: doc.merkleRootHex, blobHashes: hashes, epoch: 60, providerPubkey: provider.xOnly, publisherPrivateKey: publisher.priv });
    const honest = challenger.respond(challenge, { blobHashes: hashes, epoch: 61, providerPrivateKey: provider.priv });
    const notFraud = new FraudProof({ kind: 'wrong-leaf', artifacts: { challenge, response: honest } });
    assert.throws(() => Bond.preparePenaltySpend(deposit, { fraudProof: notFraud.toBody(), fundedTxHex: funded, destinationAddress: dest }), /does not verify/);

    const commitment = Challenge.commit({ merkleRootHex: doc.merkleRootHex, fromEpoch: 0, untilEpoch: 100, providerPrivateKey: provider.priv, depositAddress: deposit.address });
    const proof = challenger.proofFor(challenge, null, { commitment, epoch: 70 });
    const penalty = Bond.preparePenaltySpend(deposit, { fraudProof: proof.toBody(), epoch: 70, fundedTxHex: funded, destinationAddress: dest, feeSats: 500 });
    assert.strictEqual(penalty.leafId, 'penalty');
    assert.strictEqual(penalty.fraudProofHash, proof.hash);
    assert.strictEqual(penalty.offender, provider.xOnly);

    // Wrongful-penalty proof names the publisher, so it cannot be turned against the provider's deposit.
    const counter = Challenge.wrongfulPenaltyProof(challenge, honest);
    assert.throws(() => Bond.preparePenaltySpend(deposit, { fraudProof: counter, fundedTxHex: funded, destinationAddress: dest }), /different offender/);

    const withdraw = Bond.prepareDepositWithdraw(deposit, { fundedTxHex: funded, destinationAddress: dest, feeSats: 500 });
    assert.strictEqual(withdraw.locktime, 900);
  });
});

describe('DocumentOfferBook#ingestFraudProof', function () {
  it('penalizes the offender locally and ignores proofs that do not verify', () => {
    const DocumentOfferBook = require('../types/offerBook');
    const priv = crypto.randomBytes(32);
    const pub = Buffer.from(secp256k1.getPublicKey(priv, true)).toString('hex');
    const xOnly = Buffer.from(schnorr.getPublicKey(priv)).toString('hex');
    const book = new DocumentOfferBook();
    book.ingestInventoryResponse({ origin: 'seller-a', sellerPubkey: pub, items: [{ documentId: 'd', blobHashHex: 'aa'.repeat(32), rateSats: 1 }] });
    const preimage = crypto.randomBytes(32);
    const offer = Witness.signArtifact({ type: 'DocumentOffer', blobHashHex: 'aa'.repeat(32), paymentHashHex: crypto.createHash('sha256').update(preimage).digest('hex') }, priv);
    const proof = new FraudProof({ kind: 'wrong-bytes', artifacts: { offer, claim: { preimageHex: preimage.toString('hex') }, bytesHex: 'ff' } }).toBody();
    const res = book.ingestFraudProof(JSON.parse(JSON.stringify(proof)));
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.offender, xOnly);
    assert.deepStrictEqual(res.penalized, ['seller-a']);
    assert.strictEqual(book.exportTelemetry().providers.find((p) => p.sellerId === 'seller-a').penalties, 1);
    assert.strictEqual(book.ingestFraudProof({ type: 'FraudProof', kind: 'wrong-bytes', artifacts: {} }).ok, false);
  });
});
