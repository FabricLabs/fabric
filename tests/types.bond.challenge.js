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

  it('non-response (late answer): provable from the late response alone; silence needs a timelock', () => {
    const commitment = Challenge.commit({
      merkleRootHex: doc.merkleRootHex, blobTotal: hashes.length, fromEpoch: 0, untilEpoch: 100,
      providerPrivateKey: provider.priv, publisherPubkey: publisher.xOnly
    });
    const challenge = challenger.issue({
      merkleRootHex: doc.merkleRootHex, blobHashes: hashes, epoch: 30,
      providerPubkey: provider.xOnly, publisherPrivateKey: publisher.priv
    });
    assert.strictEqual(challenge.deadlineHeight, null);
    assert.strictEqual(challenger.proofFor(challenge, null, { commitment, epoch: 31 }), null, 'deadline not passed');
    // Epoch clock alone never yields an absence proof (silence is unprovable without a timelock).
    assert.strictEqual(challenger.proofFor(challenge, null, { commitment, epoch: 99 }), null);
    const absence = new FraudProof({ kind: 'non-response', artifacts: { challenge, commitment } }).verify({ epoch: 99, tipHeight: 10_000 });
    assert.strictEqual(absence.ok, false);
    assert.match(absence.reason, /deadlineHeight/);
    const late = challenger.respond(challenge, { blobHashes: hashes, epoch: 40, providerPrivateKey: provider.priv });
    const lateProof = challenger.proofFor(challenge, late, { commitment });
    assert.strictEqual(lateProof.kind, 'non-response');
    assert.strictEqual(lateProof.verify().ok, true);
    // A commitment from someone else does not implicate this provider.
    const other = Challenge.commit({ merkleRootHex: doc.merkleRootHex, fromEpoch: 0, untilEpoch: 100, providerPrivateKey: stranger.priv });
    assert.strictEqual(new FraudProof({ kind: 'non-response', artifacts: { challenge, commitment: other, response: late } }).verify().ok, false);
  });

  it('non-response (silence): timelocked penalty pre-signature + check-in round, enforced only from the verifier\'s chain view', () => {
    const deposit = Bond.buildDeposit({ network: 'regtest', providerPubkey: provider.pub, publisherPubkey: publisher.pub, withdrawAfter: 900, amountSats: 30000 });
    assert.deepStrictEqual(deposit.leaves.map((l) => l.id).sort(), ['checkin', 'penalty', 'withdraw']);
    const funded = fundingFor(deposit.address);
    const fundedTxid = bitcoin.Transaction.fromHex(funded).getId();
    const dest = bitcoin.payments.p2wpkh({ pubkey: Buffer.from(publisher.pub, 'hex'), network: bitcoin.networks.regtest }).address;
    const commitment = Challenge.commit({ merkleRootHex: doc.merkleRootHex, blobTotal: hashes.length, fromEpoch: 0, untilEpoch: 100, providerPrivateKey: provider.priv, depositAddress: deposit.address, depositTxid: fundedTxid });

    // Round 0: provider pre-signs the penalty for deadline 1000 before anything else is signed.
    assert.throws(() => challenger.issue({ merkleRootHex: doc.merkleRootHex, blobHashes: hashes, epoch: 30, deadlineHeight: 1000, providerPubkey: provider.xOnly, publisherPrivateKey: publisher.priv }), /deposit outpoint/);
    const challenge = challenger.issue({
      merkleRootHex: doc.merkleRootHex, blobHashes: hashes, epoch: 30, tipHeight: 990, deadlineBlocks: 10,
      deposit: { txid: fundedTxid, vout: 0 }, providerPubkey: provider.xOnly, publisherPrivateKey: publisher.priv
    });
    assert.strictEqual(challenge.deadlineHeight, 1000);
    const penalty = Bond.prepareDepositPenalty(deposit, { fundedTxHex: funded, deadlineHeight: challenge.deadlineHeight, destinationAddress: dest, feeSats: 500 });
    assert.strictEqual(penalty.locktime, 1000);
    const preSig = Bond.signPenaltyAsProvider(deposit, penalty, provider.priv);
    assert.strictEqual(preSig.type, 'DepositPenaltyPreSig');
    assert.strictEqual(Witness.verifyPenaltyPreSig(preSig, { providerPubkey: provider.pub, deposit: { txid: fundedTxid, vout: 0 }, deadlineHeight: 1000 }).ok, true);
    assert.strictEqual(Witness.verifyPenaltyPreSig(preSig, { providerPubkey: provider.pub, deposit: { txid: fundedTxid, vout: 0 }, deadlineHeight: 1001 }).ok, false, 'deadline bound into nLockTime');
    assert.strictEqual(Witness.verifyPenaltyPreSig(preSig, { providerPubkey: stranger.pub, deposit: { txid: fundedTxid, vout: 0 }, deadlineHeight: 1000 }).ok, false);
    assert.strictEqual(Witness.verifyPenaltyPreSig(Object.assign({}, preSig, { deadlineHeight: 999 }), { providerPubkey: provider.pub, deposit: { txid: fundedTxid, vout: 0 }, deadlineHeight: 1000 }).ok, false, 'artifact tamper');

    // Publisher: the round is resolvable only with the pre-signature in hand (P_{n+1} before C_n).
    const bond = new Bond({ network: 'regtest' });
    assert.strictEqual(bond.recordRound(0, { deposit }).resolvable, false);
    const checkIn = Bond.prepareDepositCheckIn(deposit, { fundedTxHex: funded, feeSats: 500 });
    assert.strictEqual(checkIn.leafId, 'checkin');
    assert.strictEqual(bitcoin.Psbt.fromBase64(checkIn.psbtBase64, { network: bitcoin.networks.regtest }).txOutputs[0].address, deposit.address, 'check-in re-deposits');
    assert.strictEqual(bond.recordRound(0, { deposit, penaltyPreSig: preSig }).resolvable, true);
    assert.strictEqual(bond.resolutions.exitsAfter(999, '0').length, 0);
    assert.strictEqual(bond.resolutions.exitsAfter(1000, '0').length, 1);

    // Absence proof: refused before the deadline, refused after a check-in, accepted otherwise.
    assert.strictEqual(challenger.proofFor(challenge, null, { commitment, tipHeight: 999 }), null);
    assert.strictEqual(challenger.proofFor(challenge, null, { commitment, tipHeight: 1000 }), null, 'needs the pre-signature');
    const proof = challenger.proofFor(challenge, null, { commitment, penaltyPreSig: preSig, tipHeight: 1000 });
    assert.ok(proof);
    const body = JSON.parse(JSON.stringify(proof.toBody()));
    assert.strictEqual(FraudProof.fromBody(body).verify({}).ok, false, 'no chain view');
    assert.strictEqual(FraudProof.fromBody(body).verify({ epoch: 999, tipHeight: 999, outpointUnspent: () => true }).ok, false, 'deadline not reached');
    assert.strictEqual(FraudProof.fromBody(body).verify({ tipHeight: 1000, outpointUnspent: () => false }).ok, false, 'provider checked in');
    const verdict = FraudProof.fromBody(body).verify({ tipHeight: 1000, outpointUnspent: (txid, vout) => txid === fundedTxid && vout === 0 });
    assert.strictEqual(verdict.ok, true);
    assert.strictEqual(verdict.offender, provider.xOnly);
    assert.strictEqual(verdict.evidence, 'timelock');
    assert.strictEqual(verdict.enforceableAfterHeight, 1000);
    // Enforcement is the pre-signed penalty itself, not a fresh spend.
    assert.throws(() => Bond.preparePenaltySpend(deposit, { fraudProof: body, fundedTxHex: funded, destinationAddress: dest, ctx: { tipHeight: 1000, outpointUnspent: () => true } }), /finalizePreSignedPenalty/);
    assert.throws(() => Bond.finalizePreSignedPenalty(deposit, preSig, publisher.priv, { tipHeight: 999 }), /not reached/);
    const done = Bond.finalizePreSignedPenalty(deposit, preSig, publisher.priv, { tipHeight: 1000 });
    const tx = bitcoin.Transaction.fromHex(done.txHex);
    assert.strictEqual(tx.locktime, 1000);
    assert.strictEqual(tx.ins[0].witness.length, 4, '2 sigs + script + control block');
    assert.strictEqual(done.txid, preSig.txid);
  });

  function signedFileSendFrame (obj, priv) {
    const Message = require('../types/message');
    const Key = require('../types/key');
    const key = new Key({ private: priv.toString('hex') });
    return Message.fromVector(['P2P_FILE_SEND', JSON.stringify(obj)]).signWithKey(key).toBuffer().toString('hex');
  }

  it('wrong-bytes: offer + preimage + the seller-signed delivery frame (bare bytes are not evidence)', () => {
    const preimage = crypto.randomBytes(32);
    const paymentHashHex = crypto.createHash('sha256').update(preimage).digest('hex');
    const offer = Witness.signArtifact({ type: 'DocumentOffer', documentId: 'bounty-demo', blobIndex: 0, blobHashHex: hashes[0], rateSats: 3, paymentHashHex }, provider.priv);
    const claim = { preimageHex: preimage.toString('hex') };
    const frameFor = (bytes, priv = provider.priv) => signedFileSendFrame({ name: 'bounty-demo', body: bytes.toString('base64'), blobIndex: 0, blobTotal: hashes.length, blobHashHex: crypto.createHash('sha256').update(bytes).digest('hex'), merkleRootHex: doc.merkleRootHex, paymentHashHex, sealed: true, iv: 'aa'.repeat(12) }, priv);
    const garbage = Buffer.from('garbage');
    const bad = new FraudProof({ kind: 'wrong-bytes', artifacts: { offer, claim, delivery: { frameHex: frameFor(garbage) } } });
    const verdict = FraudProof.fromBody(JSON.parse(JSON.stringify(bad.toBody()))).verify();
    assert.strictEqual(verdict.ok, true);
    assert.strictEqual(verdict.offender, provider.xOnly);
    assert.strictEqual(verdict.evidence, 'signed-frame');
    const good = new FraudProof({ kind: 'wrong-bytes', artifacts: { offer, claim, delivery: { frameHex: frameFor(doc.bytesFor(0)) } } });
    assert.strictEqual(good.verify().ok, false, 'honest delivery is not fraud');
    // Legacy bare bytes, a frame signed by someone else, or a tampered frame prove nothing.
    assert.strictEqual(new FraudProof({ kind: 'wrong-bytes', artifacts: { offer, claim, bytesHex: 'ff' } }).verify().ok, false);
    assert.strictEqual(new FraudProof({ kind: 'wrong-bytes', artifacts: { offer, claim, delivery: { frameHex: frameFor(garbage, stranger.priv) } } }).verify().ok, false);
    const tampered = Buffer.from(frameFor(garbage), 'hex'); tampered[tampered.length - 1] ^= 1;
    assert.strictEqual(new FraudProof({ kind: 'wrong-bytes', artifacts: { offer, claim, delivery: { frameHex: tampered.toString('hex') } } }).verify().ok, false);
    // An offer without paymentHashHex cannot bind the payment.
    const unbound = Witness.signArtifact({ type: 'DocumentOffer', blobHashHex: hashes[0], rateSats: 3 }, provider.priv);
    assert.match(new FraudProof({ kind: 'wrong-bytes', artifacts: { offer: unbound, claim, delivery: { frameHex: frameFor(garbage) } } }).verify().reason, /paymentHashHex/);
  });

  it('wrongful-penalty: the provider can always publish the counter-proof — with the penalty tx', () => {
    const deposit = Bond.buildDeposit({ network: 'regtest', providerPubkey: provider.pub, publisherPubkey: publisher.pub, withdrawAfter: 900, amountSats: 30000 });
    const funded = fundingFor(deposit.address);
    const fundedTxid = bitcoin.Transaction.fromHex(funded).getId();
    const dest = bitcoin.payments.p2wpkh({ pubkey: Buffer.from(publisher.pub, 'hex'), network: bitcoin.networks.regtest }).address;
    const challenge = challenger.issue({
      merkleRootHex: doc.merkleRootHex, blobHashes: hashes, epoch: 50, deadlineHeight: 1000, deposit: { txid: fundedTxid, vout: 0 },
      providerPubkey: provider.xOnly, publisherPrivateKey: publisher.priv
    });
    const response = challenger.respond(challenge, { blobHashes: hashes, epoch: 51, providerPrivateKey: provider.priv });
    assert.strictEqual(Challenge.wrongfulPenaltyProof(challenge, response, { txid: 'ab'.repeat(32) }).verify().ok, false, 'no penalty tx → no proof');
    const penalty = Bond.prepareDepositPenalty(deposit, { fundedTxHex: funded, deadlineHeight: 1000, destinationAddress: dest, feeSats: 500 });
    const preSig = Bond.signPenaltyAsProvider(deposit, penalty, provider.priv);
    const taken = Bond.finalizePreSignedPenalty(deposit, preSig, publisher.priv, { tipHeight: 1000 });
    const counter = Challenge.wrongfulPenaltyProof(challenge, response, { txHex: taken.txHex, txid: taken.txid });
    const verdict = FraudProof.fromBody(JSON.parse(JSON.stringify(counter.toBody()))).verify();
    assert.strictEqual(verdict.ok, true);
    assert.strictEqual(verdict.offender, publisher.xOnly);
    assert.strictEqual(verdict.penaltyTxid, taken.txid);
    assert.strictEqual(counter.verify({ txConfirmed: () => false }).ok, false, 'verifier may demand confirmation');
    // A spend of some other outpoint is not this penalty.
    const otherDeposit = Bond.buildDeposit({ network: 'regtest', providerPubkey: provider.pub, publisherPubkey: publisher.pub, withdrawAfter: 901, amountSats: 30000 });
    const otherTaken = Bond.finalizePreSignedPenalty(otherDeposit, Bond.signPenaltyAsProvider(otherDeposit, Bond.prepareDepositPenalty(otherDeposit, { fundedTxHex: fundingFor(otherDeposit.address), deadlineHeight: 1000, destinationAddress: dest, feeSats: 500 }), provider.priv), publisher.priv);
    assert.strictEqual(Challenge.wrongfulPenaltyProof(challenge, response, { txHex: otherTaken.txHex }).verify().ok, false);
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

    // Silence alone (epoch clock) is no longer a spendable verdict.
    const commitment = Challenge.commit({ merkleRootHex: doc.merkleRootHex, fromEpoch: 0, untilEpoch: 100, providerPrivateKey: provider.priv, depositAddress: deposit.address });
    assert.strictEqual(challenger.proofFor(challenge, null, { commitment, epoch: 70 }), null);
    // A late response is.
    const late = challenger.respond(challenge, { blobHashes: hashes, epoch: 70, providerPrivateKey: provider.priv });
    const proof = challenger.proofFor(challenge, late, { commitment });
    const penalty = Bond.preparePenaltySpend(deposit, { fraudProof: proof.toBody(), fundedTxHex: funded, destinationAddress: dest, feeSats: 500 });
    assert.strictEqual(penalty.leafId, 'penalty');
    assert.strictEqual(penalty.fraudProofHash, proof.hash);
    assert.strictEqual(penalty.offender, provider.xOnly);

    // Wrongful-penalty proof names the publisher, so it cannot be turned against the provider's deposit.
    const counter = Challenge.wrongfulPenaltyProof(challenge, honest, { txHex: funded });
    assert.throws(() => Bond.preparePenaltySpend(deposit, { fraudProof: counter, fundedTxHex: funded, destinationAddress: dest }), /does not verify|different offender/);

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
    const paymentHashHex = crypto.createHash('sha256').update(preimage).digest('hex');
    const offer = Witness.signArtifact({ type: 'DocumentOffer', blobHashHex: 'aa'.repeat(32), paymentHashHex }, priv);
    const Message = require('../types/message');
    const Key = require('../types/key');
    const garbage = Buffer.from('ff', 'hex');
    const frameHex = Message.fromVector(['P2P_FILE_SEND', JSON.stringify({ name: 'd', body: garbage.toString('base64'), blobIndex: 0, blobTotal: 1, blobHashHex: crypto.createHash('sha256').update(garbage).digest('hex'), paymentHashHex })]).signWithKey(new Key({ private: priv.toString('hex') })).toBuffer().toString('hex');
    const proof = new FraudProof({ kind: 'wrong-bytes', artifacts: { offer, claim: { preimageHex: preimage.toString('hex') }, delivery: { frameHex } } }).toBody();
    const res = book.ingestFraudProof(JSON.parse(JSON.stringify(proof)));
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.offender, xOnly);
    assert.deepStrictEqual(res.penalized, ['seller-a']);
    assert.strictEqual(book.exportTelemetry().providers.find((p) => p.sellerId === 'seller-a').penalties, 1);
    assert.strictEqual(book.ingestFraudProof({ type: 'FraudProof', kind: 'wrong-bytes', artifacts: {} }).ok, false);
  });
});
