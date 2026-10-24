'use strict';

const assert = require('assert');
const crypto = require('crypto');
const bitcoin = require('bitcoinjs-lib');
const { secp256k1, schnorr } = require('@noble/curves/secp256k1.js');

const Bond = require('../types/bond');
const Challenge = require('../types/challenge');
const Witness = require('../types/witness');
const Document = require('../types/document');
const { signerFromPriv32 } = require('../types/htlc');
const { createBlobMerkleTree } = Challenge;

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

function p2wpkh (pub) {
  return bitcoin.payments.p2wpkh({ pubkey: Buffer.from(pub, 'hex'), network: bitcoin.networks.regtest }).address;
}

function signAll (psbtBase64, privs) {
  const psbt = bitcoin.Psbt.fromBase64(psbtBase64, { network: bitcoin.networks.regtest });
  for (const p of privs) psbt.signInput(0, signerFromPriv32(p));
  return psbt.toBase64();
}

describe('Market bonds, challenges, and fraud proofs (Phase 3)', function () {
  this.timeout(20000);

  const publisher = keypair();
  const provider = keypair();
  const stranger = keypair();
  const challenger = new Challenge({ deadlineEpochs: 2 });
  let doc;
  let hashes;
  // Availability challenges commit to the blob-hash tree (the storage root),
  // not the document root that also commits payment hashes and IVs.
  let root;
  let total;
  let dest;

  const commitFor = (opts = {}) => Challenge.commit(Object.assign({
    merkleRootHex: root,
    blobTotal: total,
    fromEpoch: 0,
    untilEpoch: 100,
    providerPrivateKey: provider.priv,
    publisherPubkey: publisher.xOnly
  }, opts));

  before(() => {
    doc = Document.seal(crypto.randomBytes(7000), { chunkBytes: 2048, documentId: 'bounty-demo' });
    hashes = doc.record().blobs.map((b) => b.blobHashHex);
    root = createBlobMerkleTree(hashes).rootHex;
    total = hashes.length;
    dest = p2wpkh(publisher.pub);
    assert.ok(total >= 3);
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
      merkleRootHex: root, blobHashes: hashes, epoch: 10,
      providerPubkey: provider.xOnly, publisherPrivateKey: publisher.priv
    });
    assert.strictEqual(challenge.type, 'AvailabilityChallenge');
    assert.strictEqual(challenge.deadlineEpoch, 12);
    assert.strictEqual(challenge.blobTotal, total);
    assert.strictEqual(challenge.blobHashHex, hashes[challenge.blobIndex]);
    assert.ok(challenge.pinProof && challenge.pinProof.leafCount === total, 'the pin carries its Merkle proof');
    assert.strictEqual(Challenge.leafIndexFor(root, 10, challenge.nonceHex, total), challenge.blobIndex);
    assert.throws(() => challenger.issue({ merkleRootHex: doc.merkleRootHex, blobHashes: hashes, epoch: 10, providerPubkey: provider.xOnly, publisherPrivateKey: publisher.priv }), /do not build merkleRootHex/);

    const bytes = doc.bytesFor(challenge.blobIndex);
    const response = challenger.respond(challenge, { blobHashes: hashes, bytes, epoch: 11, commitment: commitFor(), providerPrivateKey: provider.priv });
    assert.strictEqual(response.type, 'AvailabilityResponse');
    assert.deepStrictEqual(challenger.validate(challenge, response, { bytes }), { ok: true, reason: null, late: false, fraud: null });
    assert.strictEqual(challenger.validate(challenge, response, { bytes: Buffer.from('nope') }).ok, false);
    assert.strictEqual(challenger.proofFor(challenge, response, { commitment: commitFor() }), null);

    // The provider refuses what it never committed to, and expired challenges.
    assert.throws(() => challenger.respond(challenge, { blobHashes: hashes.slice().reverse(), epoch: 11, providerPrivateKey: provider.priv }), /another tree/);
    assert.throws(() => challenger.respond(challenge, { blobHashes: hashes, epoch: 13, providerPrivateKey: provider.priv }), /deadline has passed/);
    assert.ok(challenger.respond(challenge, { blobHashes: hashes, epoch: 13, allowLate: true, providerPrivateKey: provider.priv }));
    const otherPublisher = commitFor({ publisherPubkey: stranger.xOnly });
    assert.throws(() => challenger.respond(challenge, { blobHashes: hashes, epoch: 11, commitment: otherPublisher, providerPrivateKey: provider.priv }), /committed publisher/);
    assert.throws(() => Challenge.commit({ merkleRootHex: root, fromEpoch: 0, untilEpoch: 1, providerPrivateKey: provider.priv, publisherPubkey: publisher.xOnly }), /blobTotal/);
    assert.throws(() => Challenge.commit({ merkleRootHex: root, blobTotal: total, fromEpoch: 0, untilEpoch: 1, providerPrivateKey: provider.priv }), /publisherPubkey/);

    // An answer-hash challenge needs the bytes.
    const answered = challenger.issue({ merkleRootHex: root, blobHashes: hashes, epoch: 10, bytesFor: (i) => doc.bytesFor(i), providerPubkey: provider.xOnly, publisherPrivateKey: publisher.priv });
    assert.match(answered.answerHashHex, /^[0-9a-f]{64}$/);
    assert.throws(() => challenger.respond(answered, { blobHashes: hashes, epoch: 11, providerPrivateKey: provider.priv }), /bytes required/);
    const withBytes = challenger.respond(answered, { blobHashes: hashes, bytes: doc.bytesFor(answered.blobIndex), epoch: 11, providerPrivateKey: provider.priv });
    assert.strictEqual(challenger.validate(answered, withBytes).ok, true);
  });

  it('wrong-leaf: a response for the wrong blob is provable fraud against the commitment', () => {
    const challenge = challenger.issue({
      merkleRootHex: root, blobHashes: hashes, epoch: 20,
      providerPubkey: provider.xOnly, publisherPrivateKey: publisher.priv
    });
    const wrongIndex = (challenge.blobIndex + 1) % total;
    const honest = challenger.respond(challenge, { blobHashes: hashes, epoch: 20, providerPrivateKey: provider.priv });
    const wrongProof = createBlobMerkleTree(hashes).proveInclusion(hashes[wrongIndex]);
    const cheat = Witness.signArtifact(Object.assign({}, honest, {
      blobIndex: wrongIndex,
      blobHashHex: hashes[wrongIndex],
      proof: { proof: wrongProof.proof, leafCount: wrongProof.leafCount }
    }), provider.priv);
    const v = challenger.validate(challenge, cheat);
    assert.strictEqual(v.ok, false);
    assert.strictEqual(v.fraud, 'wrong-leaf');
    assert.strictEqual(challenger.proofFor(challenge, cheat), null, 'no commitment, no proof');
    const proof = challenger.proofFor(challenge, cheat, { commitment: commitFor() });
    assert.ok(proof instanceof FraudProof);
    const verdict = FraudProof.fromBody(JSON.parse(JSON.stringify(proof.toBody()))).verify();
    assert.strictEqual(verdict.ok, true);
    assert.strictEqual(verdict.reputational, true);
    assert.strictEqual(verdict.offender, provider.xOnly);
    assert.deepStrictEqual(proof.evidenceIds(), [`challenge:${Witness.artifactHash(challenge)}`]);
  });

  it('non-response (late answer): needs an anchor the provider signed for the challenge', () => {
    const commitment = commitFor();
    const challenge = challenger.issue({
      merkleRootHex: root, blobHashes: hashes, epoch: 30,
      providerPubkey: provider.xOnly, publisherPrivateKey: publisher.priv
    });
    assert.strictEqual(challenge.deadlineHeight, null);
    assert.strictEqual(challenger.proofFor(challenge, null, { commitment, epoch: 31 }), null, 'deadline not passed');
    assert.strictEqual(challenger.proofFor(challenge, null, { commitment, epoch: 99 }), null, 'silence on the epoch clock is unprovable');
    const absence = new FraudProof({ kind: 'non-response', artifacts: { challenge, commitment } }).verify({ epoch: 99, tipHeight: 10_000 });
    assert.strictEqual(absence.ok, false);
    assert.match(absence.reason, /deadlineHeight/);

    const late = challenger.respond(challenge, { blobHashes: hashes, epoch: 40, allowLate: true, providerPrivateKey: provider.priv });
    assert.strictEqual(challenger.proofFor(challenge, late, { commitment }), null, 'the publisher can backdate its own challenge: no anchor, no proof');
    const receipt = Challenge.receipt({ challenge, epoch: 30, privateKey: provider.priv });
    const lateProof = challenger.proofFor(challenge, late, { commitment, anchor: receipt });
    assert.strictEqual(lateProof.kind, 'non-response');
    const verdict = lateProof.verify();
    assert.strictEqual(verdict.ok, true);
    assert.strictEqual(verdict.offender, provider.xOnly);
    assert.strictEqual(verdict.anchor, 'receipt');

    const bodyWith = (anchor) => new FraudProof({ kind: 'non-response', artifacts: { challenge, commitment, response: late, anchor } });
    assert.match(bodyWith(Challenge.receipt({ challenge, epoch: 30, privateKey: publisher.priv })).verify().reason, /anchor|receipt/, 'a publisher-signed receipt is self-serving');
    assert.match(bodyWith(Challenge.receipt({ challenge, epoch: 32, privateKey: provider.priv })).verify().reason, /too close to deadline/);
    const beacon = keypair();
    const attestation = Challenge.attestEpoch({ digestHex: Witness.artifactHash(challenge), epoch: 30, privateKey: beacon.priv });
    assert.strictEqual(bodyWith(attestation).verify().ok, false, 'untrusted beacon key');
    assert.strictEqual(bodyWith(attestation).verify({ beaconPubkeys: [beacon.xOnly] }).ok, true);
    assert.strictEqual(bodyWith(attestation).verify({ beaconPubkeys: [beacon.xOnly], beaconThreshold: 2 }).ok, false);

    // A commitment from someone else does not implicate this provider.
    const other = Challenge.commit({ merkleRootHex: root, blobTotal: total, fromEpoch: 0, untilEpoch: 100, providerPrivateKey: stranger.priv, publisherPubkey: publisher.xOnly });
    assert.strictEqual(new FraudProof({ kind: 'non-response', artifacts: { challenge, commitment: other, response: late, anchor: receipt } }).verify().ok, false);
  });

  it('non-response (late answer): binds the challenge to the committed publisher and epoch window', () => {
    const commitment = commitFor({ fromEpoch: 50 });
    const verdict = (challenge) => {
      const late = challenger.respond(challenge, { blobHashes: hashes, epoch: challenge.deadlineEpoch + 5, allowLate: true, providerPrivateKey: provider.priv });
      const anchor = Challenge.receipt({ challenge, epoch: challenge.epoch, privateKey: provider.priv });
      return new FraudProof({ kind: 'non-response', artifacts: { challenge, commitment, response: late, anchor } }).verify();
    };

    const inWindow = challenger.issue({ merkleRootHex: root, blobHashes: hashes, epoch: 60, providerPubkey: provider.xOnly, publisherPrivateKey: publisher.priv });
    assert.strictEqual(verdict(inWindow).ok, true);

    const early = challenger.issue({ merkleRootHex: root, blobHashes: hashes, epoch: 10, providerPubkey: provider.xOnly, publisherPrivateKey: publisher.priv });
    assert.match(verdict(early).reason, /before the commitment began/);

    const thirdParty = challenger.issue({ merkleRootHex: root, blobHashes: hashes, epoch: 60, providerPubkey: provider.xOnly, publisherPrivateKey: stranger.priv });
    assert.match(verdict(thirdParty).reason, /committed publisher/);
  });

  it('non-response (silence) without an answer path: enforceable timelock, but not proof of non-response', () => {
    const deposit = Bond.buildDeposit({ network: 'regtest', providerPubkey: provider.pub, publisherPubkey: publisher.pub, withdrawAfter: 2000, amountSats: 30000, merkleRootHex: root });
    assert.deepStrictEqual(deposit.leaves.map((l) => l.id).sort(), ['checkin', 'penalty', 'withdraw']);
    const funded = fundingFor(deposit.address);
    const fundedTxid = bitcoin.Transaction.fromHex(funded).getId();
    const commitment = commitFor({ depositAddress: deposit.address, depositTxid: fundedTxid });

    assert.throws(() => challenger.issue({ merkleRootHex: root, blobHashes: hashes, epoch: 30, deadlineHeight: 1000, providerPubkey: provider.xOnly, publisherPrivateKey: publisher.priv }), /deposit outpoint/);
    assert.throws(() => challenger.issue({ merkleRootHex: root, blobHashes: hashes, epoch: 30, deadlineHeight: 1000, deposit: { txid: fundedTxid, vout: 0, withdrawAfter: 1100 }, providerPubkey: provider.xOnly, publisherPrivateKey: publisher.priv }), /withdrawAfter/);
    const challenge = challenger.issue({
      merkleRootHex: root, blobHashes: hashes, epoch: 30, tipHeight: 990, deadlineBlocks: 10,
      deposit: { txid: fundedTxid, vout: 0, penaltyAddress: dest, withdrawAfter: 2000 },
      providerPubkey: provider.xOnly, publisherPrivateKey: publisher.priv
    });
    assert.strictEqual(challenge.deadlineHeight, 1000);
    const penalty = Bond.prepareDepositPenalty(deposit, { fundedTxHex: funded, deadlineHeight: 1000, destinationAddress: dest, feeSats: 500 });
    assert.strictEqual(penalty.locktime, 1000);
    const preSig = Bond.signPenaltyAsProvider(deposit, penalty, provider.priv, { challenge });
    assert.strictEqual(preSig.type, 'DepositPenaltyPreSig');
    assert.strictEqual(preSig.challengeHash, Witness.artifactHash(challenge));
    const expect = { providerPubkey: provider.pub, publisherPubkey: publisher.pub, deposit: challenge.deposit, deadlineHeight: 1000 };
    assert.strictEqual(Witness.verifyPenaltyPreSig(preSig, expect).ok, true);
    assert.strictEqual(Witness.verifyPenaltyPreSig(preSig, Object.assign({}, expect, { deadlineHeight: 1001 })).ok, false, 'deadline bound into nLockTime');
    assert.strictEqual(Witness.verifyPenaltyPreSig(preSig, Object.assign({}, expect, { providerPubkey: stranger.pub })).ok, false);
    assert.strictEqual(Witness.verifyPenaltyPreSig(Object.assign({}, preSig, { deadlineHeight: 999 }), expect).ok, false, 'artifact tamper');
    assert.match(Witness.verifyPenaltyPreSig(preSig, Object.assign({}, expect, { challengeHash: 'ab'.repeat(32) })).reason, /another challenge/);

    // The publisher holds P_n (paying its own destination) before co-signing C_{n-1}.
    const bond = new Bond({ network: 'regtest' });
    assert.strictEqual(bond.recordRound(0, { deposit }).resolvable, false);
    const noDestination = bond.recordRound(0, { deposit, penaltyPreSig: preSig });
    assert.strictEqual(noDestination.resolvable, false, 'no publisher destination → not enforceable');
    assert.ok(noDestination.missing.some((m) => /destination/.test(m)));
    const round = bond.recordRound(0, { deposit, penaltyPreSig: preSig, challenge });
    assert.strictEqual(round.resolvable, true);
    assert.strictEqual(round.answerable, false);
    assert.strictEqual(bond.resolutions.exitsAfter(999, '0').length, 0);
    assert.strictEqual(bond.resolutions.exitsAfter(1000, '0').length, 1);
    const checkIn = Bond.prepareDepositCheckIn(deposit, { fundedTxHex: funded, feeSats: 500 });
    assert.strictEqual(checkIn.leafId, 'checkin');
    assert.strictEqual(bitcoin.Psbt.fromBase64(checkIn.psbtBase64, { network: bitcoin.networks.regtest }).txOutputs[0].address, deposit.address, 'check-in re-deposits');

    // Absence: not before deadline + 6 blocks, never without the pre-signature.
    assert.strictEqual(challenger.proofFor(challenge, null, { commitment, tipHeight: 1005 }), null);
    assert.strictEqual(challenger.proofFor(challenge, null, { commitment, tipHeight: 1006 }), null, 'needs the pre-signature');
    const proof = challenger.proofFor(challenge, null, { commitment, penaltyPreSig: preSig, tipHeight: 1006 });
    assert.ok(proof);
    const body = JSON.parse(JSON.stringify(proof.toBody()));
    const check = (ctx) => FraudProof.fromBody(body).verify(ctx);
    assert.strictEqual(check({}).ok, false, 'no chain view');
    assert.match(check({ tipHeight: 1005, outpointUnspent: () => true }).reason, /blocks deep/);
    assert.strictEqual(check({ tipHeight: 1006, outpointUnspent: () => false }).ok, false, 'provider checked in');
    assert.match(check({ tipHeight: 1006, outpointSpend: () => ({ leafId: 'checkin' }) }).reason, /checkin/);
    const verdict = check({ tipHeight: 1006, outpointUnspent: (txid, vout) => txid === fundedTxid && vout === 0 });
    assert.strictEqual(verdict.ok, true);
    assert.strictEqual(verdict.offender, null, 'the publisher could have withheld the check-in');
    assert.strictEqual(verdict.reputational, false);
    assert.strictEqual(verdict.accused, provider.xOnly);
    assert.match(verdict.reason, /not proof of non-response/);
    assert.strictEqual(verdict.evidence, 'timelock');
    assert.strictEqual(verdict.enforceableAfterHeight, 1000);
    assert.strictEqual(verdict.enforceable, true);
    const withdrawn = check({ tipHeight: 1006, outpointSpend: () => ({ leafId: 'withdraw' }) });
    assert.strictEqual(withdrawn.withdrawn, true);
    assert.strictEqual(withdrawn.enforceable, false);

    // Enforcement is the pre-signed penalty itself, not a fresh spend.
    assert.throws(() => Bond.preparePenaltySpend(deposit, { fraudProof: body, fundedTxHex: funded, destinationAddress: dest, ctx: { tipHeight: 1006, outpointUnspent: () => true } }), /finalizePreSignedPenalty/);
    assert.throws(() => Bond.finalizePreSignedPenalty(deposit, preSig, publisher.priv, { tipHeight: 1000 }), /not enforceable/);
    assert.throws(() => Bond.finalizePreSignedPenalty(deposit, preSig, publisher.priv, { tipHeight: 999, penaltyAddress: dest }), /not reached/);
    const done = Bond.finalizePreSignedPenalty(deposit, preSig, publisher.priv, { tipHeight: 1000, penaltyAddress: dest });
    const tx = bitcoin.Transaction.fromHex(done.txHex);
    assert.strictEqual(tx.locktime, 1000);
    assert.strictEqual(tx.ins[0].witness.length, 4, '2 sigs + script + control block');
    assert.strictEqual(done.txid, preSig.txid);
  });

  it('non-response (silence) with the round answer leaf: proof of non-response; an on-chain answer defeats it', () => {
    const providerDest = p2wpkh(provider.pub);
    const plan = Challenge.planRound({ merkleRootHex: root, blobTotal: total, epoch: 30, bytesFor: (i) => doc.bytesFor(i), blobHashes: hashes });
    const d0 = Bond.buildDeposit({ network: 'regtest', providerPubkey: provider.pub, publisherPubkey: publisher.pub, withdrawAfter: 2000, amountSats: 30000, merkleRootHex: root, round: 0, answerHashHex: plan.answerHashHex, penaltyAddress: dest });
    assert.deepStrictEqual(d0.leaves.map((l) => l.id).sort(), ['answer', 'checkin', 'penalty', 'withdraw']);
    const restored = Bond.fromRecord(JSON.parse(JSON.stringify(Bond.toRecord(d0))));
    assert.strictEqual(restored.address, d0.address);
    assert.strictEqual(restored.answerHashHex, plan.answerHashHex);
    const funded = fundingFor(d0.address);
    const fundedTxid = bitcoin.Transaction.fromHex(funded).getId();
    const commitment = commitFor({ depositAddress: d0.address, depositTxid: fundedTxid });
    const challenge = challenger.issue({
      merkleRootHex: root, blobHashes: hashes, epoch: 30, nonceHex: plan.nonceHex, answerHashHex: plan.answerHashHex,
      deadlineHeight: 1000, deposit: { txid: fundedTxid, vout: 0, penaltyAddress: dest, withdrawAfter: 2000 },
      providerPubkey: provider.xOnly, publisherPrivateKey: publisher.priv
    });
    assert.strictEqual(challenge.blobIndex, plan.blobIndex);
    const bytes = doc.bytesFor(plan.blobIndex);
    const penalty = Bond.prepareDepositPenalty(d0, { fundedTxHex: funded, deadlineHeight: 1000, destinationAddress: dest, feeSats: 500 });
    assert.throws(() => Bond.signPenaltyAsProvider(d0, penalty, provider.priv, { challenge, bytes: doc.bytesFor((plan.blobIndex + 1) % total) }), /does not open/);
    const preSig = Bond.signPenaltyAsProvider(d0, penalty, provider.priv, { challenge, bytes });

    const bond = new Bond({ network: 'regtest' });
    const round0 = bond.recordRound(0, { deposit: d0, penaltyPreSig: preSig, challenge });
    assert.deepStrictEqual([round0.resolvable, round0.answerable], [true, true]);

    const answerPath = Bond.answerPath(d0);
    const proof = challenger.proofFor(challenge, null, { commitment, penaltyPreSig: preSig, answerPath, tipHeight: 1006 });
    const verdict = proof.verify({ tipHeight: 1006, outpointUnspent: () => true });
    assert.strictEqual(verdict.ok, true);
    assert.strictEqual(verdict.reputational, true);
    assert.strictEqual(verdict.offender, provider.xOnly);
    const withoutPath = challenger.proofFor(challenge, null, { commitment, penaltyPreSig: preSig, tipHeight: 1006 }).verify({ tipHeight: 1006, outpointUnspent: () => true });
    assert.strictEqual(withoutPath.reputational, false);
    const forgedPath = { controlBlockHex: Bond.answerPath(Bond.buildDeposit({ network: 'regtest', providerPubkey: provider.pub, publisherPubkey: publisher.pub, withdrawAfter: 2001, answerHashHex: plan.answerHashHex })).controlBlockHex };
    assert.strictEqual(challenger.proofFor(challenge, null, { commitment, penaltyPreSig: preSig, answerPath: forgedPath, tipHeight: 1006 }).verify({ tipHeight: 1006, outpointUnspent: () => true }).reputational, false);

    // Publisher withholds the check-in: the provider answers on-chain alone.
    const answer = Bond.prepareDepositAnswer(d0, { fundedTxHex: funded, destinationAddress: providerDest, feeSats: 500, possessionHex: plan.possessionHex });
    assert.throws(() => Bond.prepareDepositAnswer(d0, { fundedTxHex: funded, destinationAddress: providerDest, possessionHex: 'ab'.repeat(32) }), /does not open/);
    const answerTx = Bond.finalizeClaim(signAll(answer.psbtBase64, [provider.priv]), plan.possessionHex);
    assert.strictEqual(Bond.classifySpend(d0, answerTx.txHex, { txid: fundedTxid, vout: 0 }).leafId, 'answer');
    const answered = proof.verify({ tipHeight: 1006, outpointSpend: () => Bond.classifySpend(d0, answerTx.txHex, { txid: fundedTxid, vout: 0 }) });
    assert.strictEqual(answered.ok, false);
    assert.match(answered.reason, /answer/);

    // Check-in into round 1 (a fresh deposit with the next answer hash): P_1 before C_0.
    assert.throws(() => Bond.prepareDepositCheckIn(d0, { fundedTxHex: funded, feeSats: 500 }), /nextDeposit/);
    const plan1 = Challenge.planRound({ merkleRootHex: root, blobTotal: total, epoch: 40, bytesFor: (i) => doc.bytesFor(i) });
    const d1 = Bond.buildDeposit({ network: 'regtest', providerPubkey: provider.pub, publisherPubkey: publisher.pub, withdrawAfter: 2000, amountSats: 29500, merkleRootHex: root, round: 1, answerHashHex: plan1.answerHashHex, penaltyAddress: dest });
    const checkIn = Bond.prepareDepositCheckIn(d0, { fundedTxHex: funded, feeSats: 500, nextDeposit: d1 });
    assert.strictEqual(checkIn.nextDeposit.address, d1.address);
    const challenge1 = challenger.issue({
      merkleRootHex: root, blobHashes: hashes, epoch: 40, nonceHex: plan1.nonceHex, answerHashHex: plan1.answerHashHex,
      deadlineHeight: 1100, deposit: { txid: checkIn.nextDeposit.txid, vout: 0, penaltyAddress: dest, withdrawAfter: 2000 },
      providerPubkey: provider.xOnly, publisherPrivateKey: publisher.priv
    });
    const penalty1 = Bond.prepareDepositPenalty(d1, { fundedTxHex: checkIn.nextFundedTxHex, deadlineHeight: 1100, destinationAddress: dest, feeSats: 500 });
    const preSig1 = Bond.signPenaltyAsProvider(d1, penalty1, provider.priv, { challenge: challenge1 });
    assert.throws(() => bond.recordRound(1, { deposit: d1, penaltyPreSig: preSig1, challenge: challenge1, checkInPsbtBase64: checkIn.psbtBase64 }), /previousDeposit/);
    const unsigned = bond.recordRound(1, { deposit: d1, penaltyPreSig: preSig1, challenge: challenge1, previousDeposit: d0, checkInPsbtBase64: checkIn.psbtBase64 });
    assert.strictEqual(unsigned.resolvable, false, 'the check-in carries no provider signature yet');
    const signed = bond.recordRound(1, { deposit: d1, penaltyPreSig: preSig1, challenge: challenge1, previousDeposit: d0, checkInPsbtBase64: signAll(checkIn.psbtBase64, [provider.priv]) });
    assert.strictEqual(signed.resolvable, true);
    const elsewhere = Bond.prepareDepositCheckIn(d0, { fundedTxHex: funded, feeSats: 500, nextDeposit: d0 });
    assert.throws(() => bond.recordRound(1, { deposit: d1, penaltyPreSig: preSig1, challenge: challenge1, previousDeposit: d0, checkInPsbtBase64: elsewhere.psbtBase64 }), /next round/);
  });

  it('wrong-answer-hash: a publisher that commits an answer hash the blob cannot open is provable', () => {
    const commitment = commitFor();
    const bogus = challenger.issue({ merkleRootHex: root, blobHashes: hashes, epoch: 30, answerHashHex: 'ab'.repeat(32), providerPubkey: provider.xOnly, publisherPrivateKey: publisher.priv });
    const bytes = doc.bytesFor(bogus.blobIndex);
    assert.throws(() => challenger.respond(bogus, { blobHashes: hashes, bytes, epoch: 31, providerPrivateKey: provider.priv }), /wrong-answer-hash/);
    const blob = { bytesHex: bytes.toString('hex'), proof: bogus.pinProof };
    const verdict = new FraudProof({ kind: 'wrong-answer-hash', artifacts: { challenge: bogus, commitment, blob } }).verify();
    assert.strictEqual(verdict.ok, true);
    assert.strictEqual(verdict.offender, publisher.xOnly);
    const fair = challenger.issue({ merkleRootHex: root, blobHashes: hashes, epoch: 30, bytesFor: (i) => doc.bytesFor(i), providerPubkey: provider.xOnly, publisherPrivateKey: publisher.priv });
    const fairBlob = { bytesHex: doc.bytesFor(fair.blobIndex).toString('hex'), proof: fair.pinProof };
    assert.match(new FraudProof({ kind: 'wrong-answer-hash', artifacts: { challenge: fair, commitment, blob: fairBlob } }).verify().reason, /no fraud/);
    const otherBlob = { bytesHex: doc.bytesFor((bogus.blobIndex + 1) % total).toString('hex'), proof: bogus.pinProof };
    assert.match(new FraudProof({ kind: 'wrong-answer-hash', artifacts: { challenge: bogus, commitment, blob: otherBlob } }).verify().reason, /not the challenged leaf/);
  });

  function signedFileSendFrame (obj, priv) {
    const Message = require('../types/message');
    const Key = require('../types/key');
    const key = new Key({ private: priv.toString('hex') });
    return Message.fromVector(['P2P_FILE_SEND', JSON.stringify(obj)]).signWithKey(key).toBuffer().toString('hex');
  }

  it('wrong-bytes: offer + preimage + the seller-signed delivery frame for the same document, root, and blob', () => {
    const preimage = crypto.randomBytes(32);
    const paymentHashHex = crypto.createHash('sha256').update(preimage).digest('hex');
    const offerBody = { type: 'DocumentOffer', documentId: 'bounty-demo', merkleRootHex: doc.merkleRootHex, blobIndex: 0, blobHashHex: hashes[0], rateSats: 3, paymentHashHex };
    const offer = Witness.signArtifact(offerBody, provider.priv);
    const claim = { preimageHex: preimage.toString('hex') };
    const frameFor = (bytes, priv = provider.priv, extra = {}) => signedFileSendFrame(Object.assign({ name: 'bounty-demo', body: bytes.toString('base64'), blobIndex: 0, blobTotal: total, blobHashHex: crypto.createHash('sha256').update(bytes).digest('hex'), merkleRootHex: doc.merkleRootHex, paymentHashHex, sealed: true, iv: 'aa'.repeat(12) }, extra), priv);
    const garbage = Buffer.from('garbage');
    const bad = new FraudProof({ kind: 'wrong-bytes', artifacts: { offer, claim, delivery: { frameHex: frameFor(garbage) } } });
    const verdict = FraudProof.fromBody(JSON.parse(JSON.stringify(bad.toBody()))).verify();
    assert.strictEqual(verdict.ok, true);
    assert.strictEqual(verdict.offender, provider.xOnly);
    assert.strictEqual(verdict.evidence, 'signed-frame');
    assert.ok(bad.evidenceIds().includes(`payment:${provider.xOnly}:${paymentHashHex}`));
    const good = new FraudProof({ kind: 'wrong-bytes', artifacts: { offer, claim, delivery: { frameHex: frameFor(doc.bytesFor(0)) } } });
    assert.strictEqual(good.verify().ok, false, 'honest delivery is not fraud');
    assert.strictEqual(new FraudProof({ kind: 'wrong-bytes', artifacts: { offer, claim, bytesHex: 'ff' } }).verify().ok, false);
    assert.strictEqual(new FraudProof({ kind: 'wrong-bytes', artifacts: { offer, claim, delivery: { frameHex: frameFor(garbage, stranger.priv) } } }).verify().ok, false);
    const tampered = Buffer.from(frameFor(garbage), 'hex'); tampered[tampered.length - 1] ^= 1;
    assert.strictEqual(new FraudProof({ kind: 'wrong-bytes', artifacts: { offer, claim, delivery: { frameHex: tampered.toString('hex') } } }).verify().ok, false);
    // A frame for another blob, root, or document is not this delivery.
    assert.match(new FraudProof({ kind: 'wrong-bytes', artifacts: { offer, claim, delivery: { frameHex: frameFor(garbage, provider.priv, { blobIndex: 1 }) } } }).verify().reason, /another blob index/);
    assert.match(new FraudProof({ kind: 'wrong-bytes', artifacts: { offer, claim, delivery: { frameHex: frameFor(garbage, provider.priv, { merkleRootHex: 'cd'.repeat(32) }) } } }).verify().reason, /another tree root/);
    assert.match(new FraudProof({ kind: 'wrong-bytes', artifacts: { offer, claim, delivery: { frameHex: frameFor(garbage, provider.priv, { name: 'other' }) } } }).verify().reason, /another document/);
    // A seller-signed frame that does not sign the payment hash is not the paid delivery.
    const unpaidFrame = signedFileSendFrame({ name: 'bounty-demo', body: garbage.toString('base64'), blobIndex: 0, blobTotal: total, blobHashHex: crypto.createHash('sha256').update(garbage).digest('hex'), merkleRootHex: doc.merkleRootHex }, provider.priv);
    assert.match(new FraudProof({ kind: 'wrong-bytes', artifacts: { offer, claim, delivery: { frameHex: unpaidFrame } } }).verify().reason, /does not sign a paymentHashHex/);
    assert.strictEqual(new FraudProof({ kind: 'wrong-bytes', artifacts: { offer, claim, delivery: { frameHex: unpaidFrame, paymentHashHex } } }).verify().ok, false);
    const unbound = Witness.signArtifact(Object.assign({}, offerBody, { paymentHashHex: undefined }), provider.priv);
    assert.match(new FraudProof({ kind: 'wrong-bytes', artifacts: { offer: unbound, claim, delivery: { frameHex: frameFor(garbage) } } }).verify().reason, /paymentHashHex/);
    const untyped = Witness.signArtifact(Object.assign({}, offerBody, { type: 'Offer' }), provider.priv);
    assert.match(new FraudProof({ kind: 'wrong-bytes', artifacts: { offer: untyped, claim, delivery: { frameHex: frameFor(garbage) } } }).verify().reason, /DocumentOffer/);
  });

  it('wrongful-penalty: the provider\'s counter-proof needs the penalty tx and a publisher receipt for its response', () => {
    const deposit = Bond.buildDeposit({ network: 'regtest', providerPubkey: provider.pub, publisherPubkey: publisher.pub, withdrawAfter: 2000, amountSats: 30000, penaltyAddress: dest });
    const funded = fundingFor(deposit.address);
    const fundedTxid = bitcoin.Transaction.fromHex(funded).getId();
    const challenge = challenger.issue({
      merkleRootHex: root, blobHashes: hashes, epoch: 50, deadlineHeight: 1000, deposit: { txid: fundedTxid, vout: 0, penaltyAddress: dest },
      providerPubkey: provider.xOnly, publisherPrivateKey: publisher.priv
    });
    const response = challenger.respond(challenge, { blobHashes: hashes, epoch: 51, providerPrivateKey: provider.priv });
    const receipt = Challenge.receipt({ challenge, response, epoch: 51, height: 990, privateKey: publisher.priv });
    const wp = (penalty, anchor = receipt) => Challenge.wrongfulPenaltyProof(challenge, response, penalty, { anchor });
    assert.strictEqual(wp({ txid: 'ab'.repeat(32) }).verify().ok, false, 'no penalty tx → no proof');
    const penalty = Bond.prepareDepositPenalty(deposit, { fundedTxHex: funded, deadlineHeight: 1000, destinationAddress: dest, feeSats: 500 });
    const preSig = Bond.signPenaltyAsProvider(deposit, penalty, provider.priv, { challenge });
    const taken = Bond.finalizePreSignedPenalty(deposit, preSig, publisher.priv, { tipHeight: 1000 });
    const fundedOut = bitcoin.Transaction.fromHex(funded).outs[0];
    const prevouts = [{ scriptHex: Buffer.from(fundedOut.script).toString('hex'), valueSats: String(fundedOut.value) }];
    const counter = wp({ txHex: taken.txHex, txid: taken.txid, prevouts });
    assert.match(counter.verify().reason, /broadcast evidence/, 'a penalty that never reached the chain is not a penalty');
    const verdict = FraudProof.fromBody(JSON.parse(JSON.stringify(counter.toBody()))).verify({ txConfirmed: (id) => id === taken.txid });
    assert.strictEqual(verdict.ok, true);
    assert.strictEqual(verdict.offender, publisher.xOnly);
    assert.strictEqual(verdict.penaltyTxid, taken.txid);
    assert.strictEqual(counter.verify({ txConfirmed: () => false }).ok, false, 'unconfirmed penalty');
    const asked = [];
    counter.verify({ minConfirmations: 9, txConfirmed: (id, depth) => { asked.push(depth); return depth <= 6; } });
    assert.deepStrictEqual(asked, [9], 'txConfirmed is asked for the required depth');
    assert.strictEqual(counter.verify({ txConfirmations: () => 5 }).ok, false, 'fewer than 6 confirmations');
    assert.strictEqual(counter.verify({ txConfirmations: () => 6 }).ok, true);
    // The anchor: a provider can backdate its own response epoch, so only a
    // publisher receipt (or trusted attestations) dates it.
    assert.match(wp({ txHex: taken.txHex, prevouts }, null).verify({ txConfirmed: () => true }).reason, /anchor required/);
    assert.strictEqual(wp({ txHex: taken.txHex, prevouts }, Challenge.receipt({ challenge, response, epoch: 51, privateKey: provider.priv })).verify({ txConfirmed: () => true }).ok, false, 'self-signed receipt');
    assert.match(wp({ txHex: taken.txHex, prevouts }, Challenge.receipt({ challenge, response, epoch: 53, privateKey: publisher.priv })).verify({ txConfirmed: () => true }).reason, /after deadline/);
    assert.match(wp({ txHex: taken.txHex, prevouts }, Challenge.receipt({ challenge, response, epoch: 51, height: 1001, privateKey: publisher.priv })).verify({ txConfirmed: () => true }).reason, /deadline height/);

    assert.match(wp({ txHex: taken.txHex }).verify({ txConfirmed: () => true }).reason, /prevouts required/);
    const wrongValue = [Object.assign({}, prevouts[0], { valueSats: String(fundedOut.value - 1n) })];
    assert.match(wp({ txHex: taken.txHex, prevouts: wrongValue }).verify({ txConfirmed: () => true }).reason, /signatures do not verify/, 'signatures commit to the spent amount');
    const unsignedTx = new bitcoin.Transaction();
    unsignedTx.addInput(Buffer.from(fundedTxid, 'hex').reverse(), 0);
    unsignedTx.addOutput(bitcoin.address.toOutputScript(dest, bitcoin.networks.regtest), BigInt(1000));
    assert.match(wp({ txHex: unsignedTx.toHex() }).verify({ txConfirmed: () => true }).reason, /no witness/);
    const otherDeposit = Bond.buildDeposit({ network: 'regtest', providerPubkey: provider.pub, publisherPubkey: publisher.pub, withdrawAfter: 2001, amountSats: 30000 });
    const otherTaken = Bond.finalizePreSignedPenalty(otherDeposit, Bond.signPenaltyAsProvider(otherDeposit, Bond.prepareDepositPenalty(otherDeposit, { fundedTxHex: fundingFor(otherDeposit.address), deadlineHeight: 1000, destinationAddress: dest, feeSats: 500 }), provider.priv), publisher.priv, { penaltyAddress: dest });
    assert.strictEqual(wp({ txHex: otherTaken.txHex }).verify({ txConfirmed: () => true }).ok, false);

    // Check-in and withdraw also spend the deposit with a full witness — neither is a penalty.
    const checkIn = Bond.finalizeSpend(signAll(Bond.prepareDepositCheckIn(deposit, { fundedTxHex: funded, feeSats: 500 }).psbtBase64, [provider.priv, publisher.priv]));
    const withdraw = Bond.finalizeSpend(signAll(Bond.prepareDepositWithdraw(deposit, { fundedTxHex: funded, destinationAddress: dest, feeSats: 500 }).psbtBase64, [provider.priv]));
    for (const [label, spend] of [['check-in', checkIn], ['withdraw', withdraw]]) {
      const v = wp({ txHex: spend.txHex, prevouts }).verify({ txConfirmed: (id) => id === spend.txid });
      assert.strictEqual(v.ok, false, `${label} spend must not convict the publisher`);
      assert.match(v.reason, /penalty leaf/);
    }

    // The txid does not commit to the witness: re-dressing the confirmed check-in
    // with the penalty leaf is still not a penalty.
    const [penaltyLeaf, penaltyControl] = bitcoin.Transaction.fromHex(taken.txHex).ins[0].witness.slice(-2);
    const redress = (stack, controlBlock) => {
      const tx = bitcoin.Transaction.fromHex(checkIn.txHex);
      tx.ins[0].witness = [...stack, penaltyLeaf, controlBlock];
      assert.strictEqual(tx.getId(), checkIn.txid);
      return wp({ txHex: tx.toHex(), prevouts }).verify({ txConfirmed: (id) => id === checkIn.txid });
    };
    const dummySigs = [Buffer.alloc(64, 1), Buffer.alloc(64, 2)];
    const bareControl = Buffer.concat([Buffer.from([0xc0]), Buffer.from(schnorr.getPublicKey(crypto.randomBytes(32)))]);
    assert.match(redress(dummySigs, bareControl).reason, /control block does not commit/);
    assert.match(redress(dummySigs, penaltyControl).reason, /signatures do not verify/);
    const checkInSigs = bitcoin.Transaction.fromHex(checkIn.txHex).ins[0].witness.slice(0, -2);
    assert.match(redress(checkInSigs, penaltyControl).reason, /signatures do not verify/);
  });

  it('bonds build only on test networks (unknown names refused, not just mainnet)', () => {
    const opts = { providerPubkey: provider.pub, publisherPubkey: publisher.pub, withdrawAfter: 2000, amountSats: 30000 };
    for (const network of ['mainnet', 'bitcoin', 'regtset', 'prod', 'testnet3x']) {
      assert.throws(() => Bond.buildDeposit(Object.assign({ network }, opts)), /refused/, network);
    }
    assert.throws(() => Bond.buildBounty({ network: 'regtset', publisherPubkey: publisher.pub, providerPubkeys: [provider.pub], amountSats: 30000 }), /refused/);
    assert.strictEqual(Bond.buildDeposit(Object.assign({ network: 'signet' }, opts)).network, 'signet');
  });

  it('penalty pre-signature must pay the publisher-named destination (provider cannot pay itself)', () => {
    const deposit = Bond.buildDeposit({ network: 'regtest', providerPubkey: provider.pub, publisherPubkey: publisher.pub, withdrawAfter: 2000, amountSats: 30000 });
    const funded = fundingFor(deposit.address);
    const fundedTxid = bitcoin.Transaction.fromHex(funded).getId();
    const toPublisher = dest;
    const toProvider = p2wpkh(provider.pub);
    const challenge = challenger.issue({
      merkleRootHex: root, blobHashes: hashes, epoch: 30, deadlineHeight: 1000,
      deposit: { txid: fundedTxid, vout: 0, penaltyAddress: toPublisher, minPenaltySats: 45000 },
      providerPubkey: provider.xOnly, publisherPrivateKey: publisher.priv
    });
    assert.strictEqual(challenge.deposit.penaltyAddress, toPublisher);
    const preSigTo = (address, feeSats = 500) => Bond.signPenaltyAsProvider(deposit, Bond.prepareDepositPenalty(deposit, { fundedTxHex: funded, deadlineHeight: 1000, destinationAddress: address, feeSats }), provider.priv);
    const expect = { providerPubkey: provider.pub, publisherPubkey: publisher.pub, deposit: challenge.deposit, deadlineHeight: 1000 };
    assert.strictEqual(Witness.verifyPenaltyPreSig(preSigTo(toPublisher), expect).ok, true);
    assert.match(Witness.verifyPenaltyPreSig(preSigTo(toProvider), expect).reason, /does not pay/);
    assert.match(Witness.verifyPenaltyPreSig(preSigTo(toPublisher, 10000), expect).reason, /at least 45000/, 'fee cannot eat the deposit');
    assert.throws(() => Bond.signPenaltyAsProvider(deposit, Bond.prepareDepositPenalty(deposit, { fundedTxHex: funded, deadlineHeight: 1000, destinationAddress: toPublisher, feeSats: 500 }), provider.priv, { challenge, destinationAddress: toProvider }), /does not pay/);
    const commitment = commitFor({ depositAddress: deposit.address, depositTxid: fundedTxid });
    const selfPaying = new FraudProof({ kind: 'non-response', artifacts: { challenge, commitment, penaltyPreSig: preSigTo(toProvider) } });
    assert.match(selfPaying.verify({ tipHeight: 1006, outpointUnspent: () => true }).reason, /does not pay/);
    const bond = new Bond({ network: 'regtest' });
    assert.throws(() => bond.recordRound(0, { deposit, penaltyPreSig: preSigTo(toProvider), penaltyAddress: toPublisher }), /does not pay/);
    assert.strictEqual(bond.recordRound(0, { deposit, penaltyPreSig: preSigTo(toPublisher), penaltyAddress: toPublisher }).resolvable, true);
    assert.throws(() => Bond.finalizePreSignedPenalty(deposit, preSigTo(toProvider), publisher.priv, { tipHeight: 1000, penaltyAddress: toPublisher }), /does not pay/);
  });

  it('penalty pre-signature must sign the deposit\'s canonical penalty leaf', () => {
    const deposit = Bond.buildDeposit({ network: 'regtest', providerPubkey: provider.pub, publisherPubkey: publisher.pub, withdrawAfter: 2000, amountSats: 30000 });
    const funded = fundingFor(deposit.address);
    const fundedTxid = bitcoin.Transaction.fromHex(funded).getId();
    const penalty = Bond.prepareDepositPenalty(deposit, { fundedTxHex: funded, deadlineHeight: 1000, destinationAddress: dest, feeSats: 500 });
    const expect = { providerPubkey: provider.pub, publisherPubkey: publisher.pub, deposit: { txid: fundedTxid, vout: 0 }, deadlineHeight: 1000, depositAddress: deposit.address };
    assert.strictEqual(Witness.verifyPenaltyPreSig(Bond.signPenaltyAsProvider(deposit, penalty, provider.priv), expect).ok, true);
    assert.match(Witness.verifyPenaltyPreSig(Bond.signPenaltyAsProvider(deposit, penalty, provider.priv), Object.assign({}, expect, { publisherPubkey: null })).reason, /publisherPubkey required/);
    const otherDeposit = Bond.buildDeposit({ network: 'regtest', providerPubkey: provider.pub, publisherPubkey: publisher.pub, withdrawAfter: 2001, amountSats: 30000 });
    assert.match(Witness.verifyPenaltyPreSig(Bond.signPenaltyAsProvider(deposit, penalty, provider.priv), Object.assign({}, expect, { depositAddress: otherDeposit.address })).reason, /does not spend the deposit address/);

    const checkInLeaf = bitcoin.Psbt.fromBase64(Bond.prepareDepositCheckIn(deposit, { fundedTxHex: funded, feeSats: 500 }).psbtBase64).data.inputs[0].tapLeafScript;
    const penaltyLeaf = bitcoin.Psbt.fromBase64(penalty.psbtBase64).data.inputs[0].tapLeafScript;
    const preSigOver = (signLeaf, namedLeaf) => {
      const psbt = bitcoin.Psbt.fromBase64(penalty.psbtBase64);
      psbt.data.inputs[0].tapLeafScript = signLeaf;
      psbt.signInput(0, signerFromPriv32(provider.priv));
      psbt.data.inputs[0].tapLeafScript = namedLeaf;
      const tx = psbt.__CACHE.__TX;
      return Witness.signArtifact({ type: 'DepositPenaltyPreSig', version: 1, depositAddress: deposit.address, deposit: { txid: fundedTxid, vout: 0 }, deadlineHeight: 1000, txid: tx.getId(), psbtBase64: psbt.toBase64() }, provider.priv);
    };
    const alternate = preSigOver(checkInLeaf, checkInLeaf);
    assert.match(Witness.verifyPenaltyPreSig(alternate, expect).reason, /other than the penalty leaf/);
    assert.throws(() => new Bond({ network: 'regtest' }).recordRound(0, { deposit, penaltyPreSig: alternate }), /other than the penalty leaf/);
    assert.throws(() => Bond.finalizePreSignedPenalty(deposit, alternate, publisher.priv, { tipHeight: 1000, penaltyAddress: dest }), /other than the penalty leaf/);
    assert.match(Witness.verifyPenaltyPreSig(preSigOver(checkInLeaf, penaltyLeaf), expect).reason, /no provider tapscript signature on the penalty leaf/);
  });

  it('bounty: per-epoch outputs, deterministic preimages, claim + refund PSBTs', () => {
    const seed = crypto.randomBytes(32);
    const bounty = Bond.buildBounty({
      network: 'regtest', publisherPubkey: publisher.pub, providerPubkeys: [provider.pub, stranger.pub],
      seed, epochs: [{ epoch: 1, amountSats: 20000 }, { epoch: 2, amountSats: 20000 }], refundAfter: 800,
      merkleRootHex: root
    });
    assert.strictEqual(bounty.outputs.length, 2);
    assert.notStrictEqual(bounty.outputs[0].address, bounty.outputs[1].address);
    assert.deepStrictEqual(bounty.outputs[0].leaves.map((l) => l.id).sort(), ['claim-e1-' + provider.pub, 'claim-e1-' + stranger.pub, 'refund'].sort());
    const restored = Bond.fromRecord(JSON.parse(JSON.stringify(Bond.toRecord(bounty))));
    assert.strictEqual(restored.outputs[1].address, bounty.outputs[1].address);

    const preimage = Bond.deriveEpochPreimage(seed, 1, provider.pub);
    const funded = fundingFor(bounty.outputs[0].address);
    const toProvider = p2wpkh(provider.pub);
    const claim = Bond.prepareBountyClaim(restored, { epoch: 1, providerPubkey: provider.pub, preimageHex: preimage, fundedTxHex: funded, destinationAddress: toProvider, feeSats: 500 });
    assert.strictEqual(claim.witnessShape, 'preimage+sig');
    const tx = Bond.finalizeClaim(signAll(claim.psbtBase64, [provider.priv]), preimage);
    assert.ok(/^[0-9a-f]{64}$/.test(tx.txid));
    assert.throws(() => Bond.prepareBountyClaim(restored, { epoch: 1, providerPubkey: stranger.pub, preimageHex: preimage, fundedTxHex: funded, destinationAddress: toProvider }), /does not open/);

    const refund = Bond.prepareBountyRefund(restored, { epoch: 1, fundedTxHex: funded, destinationAddress: toProvider, feeSats: 500 });
    assert.strictEqual(refund.locktime, 800);
  });

  it('deposit: an unsigned penalty spend needs a verifying proof bound to this deposit, once per evidence id', () => {
    const deposit = Bond.buildDeposit({ network: 'regtest', providerPubkey: provider.pub, publisherPubkey: publisher.pub, withdrawAfter: 2000, amountSats: 30000, merkleRootHex: root });
    const funded = fundingFor(deposit.address);
    const fundedTxid = bitcoin.Transaction.fromHex(funded).getId();
    const consumed = new Set();
    assert.throws(() => Bond.preparePenaltySpend(deposit, { fundedTxHex: funded, destinationAddress: dest }), /fraudProof required/);
    const commitment = commitFor({ depositAddress: deposit.address, depositTxid: fundedTxid });

    const challenge = challenger.issue({ merkleRootHex: root, blobHashes: hashes, epoch: 60, deposit: { txid: fundedTxid, vout: 0 }, providerPubkey: provider.xOnly, publisherPrivateKey: publisher.priv });
    const honest = challenger.respond(challenge, { blobHashes: hashes, epoch: 61, providerPrivateKey: provider.priv });
    const notFraud = new FraudProof({ kind: 'wrong-leaf', artifacts: { challenge, commitment, response: honest } });
    assert.throws(() => Bond.preparePenaltySpend(deposit, { fraudProof: notFraud.toBody(), fundedTxHex: funded, destinationAddress: dest, consumed }), /does not verify/);
    assert.strictEqual(challenger.proofFor(challenge, null, { commitment, epoch: 70 }), null);

    const late = challenger.respond(challenge, { blobHashes: hashes, epoch: 70, allowLate: true, providerPrivateKey: provider.priv });
    const proof = challenger.proofFor(challenge, late, { commitment, anchor: Challenge.receipt({ challenge, epoch: 60, privateKey: provider.priv }) });
    const penalty = Bond.preparePenaltySpend(deposit, { fraudProof: proof.toBody(), fundedTxHex: funded, destinationAddress: dest, feeSats: 500, consumed });
    assert.strictEqual(penalty.leafId, 'penalty');
    assert.strictEqual(penalty.fraudProofHash, proof.hash);
    assert.strictEqual(penalty.offender, provider.xOnly);
    assert.strictEqual(penalty.enforceable, false, 'still needs the provider signature');
    assert.deepStrictEqual(penalty.signaturesRequired, [publisher.pub, provider.pub]);
    assert.throws(() => Bond.preparePenaltySpend(deposit, { fraudProof: proof.toBody(), fundedTxHex: funded, destinationAddress: dest, feeSats: 500, consumed }), /already spent/);

    // The same evidence cannot be pointed at another deposit.
    const otherDeposit = Bond.buildDeposit({ network: 'regtest', providerPubkey: provider.pub, publisherPubkey: publisher.pub, withdrawAfter: 2001, amountSats: 30000, merkleRootHex: root });
    assert.throws(() => Bond.preparePenaltySpend(otherDeposit, { fraudProof: proof.toBody(), fundedTxHex: fundingFor(otherDeposit.address), destinationAddress: dest, consumed: new Set() }), /commitment does not name this deposit/);
    assert.throws(() => Bond.preparePenaltySpend(deposit, { fraudProof: proof.toBody(), fundedTxHex: fundingFor(deposit.address), destinationAddress: dest, consumed: new Set() }), /not the challenged deposit transaction/);

    const counter = Challenge.wrongfulPenaltyProof(challenge, honest, { txHex: funded });
    assert.throws(() => Bond.preparePenaltySpend(deposit, { fraudProof: counter, fundedTxHex: funded, destinationAddress: dest }), /do not move a deposit/);

    const withdraw = Bond.prepareDepositWithdraw(deposit, { fundedTxHex: funded, destinationAddress: dest, feeSats: 500 });
    assert.strictEqual(withdraw.locktime, 2000);
  });
});

describe('DocumentBook#ingestFraudProof', function () {
  it('penalizes only sellers whose verified AMP signer is the offender, once per evidence id', () => {
    const DocumentBook = require('../types/documentBook');
    const priv = crypto.randomBytes(32);
    const pub = Buffer.from(secp256k1.getPublicKey(priv, true)).toString('hex');
    const xOnly = Buffer.from(schnorr.getPublicKey(priv)).toString('hex');
    const rootHex = 'ee'.repeat(32);
    const book = new DocumentBook();
    book.ingestInventoryResponse({ origin: 'seller-a', signerPubkeyHex: pub, items: [{ documentId: 'd', blobHashHex: 'aa'.repeat(32), rateSats: 1 }] });
    // A self-asserted sellerPubkey never routes a penalty (anyone can claim a key).
    book.ingestInventoryResponse({ origin: 'seller-b', sellerPubkey: pub, items: [{ documentId: 'd', blobHashHex: 'aa'.repeat(32), rateSats: 1 }] });
    const preimage = crypto.randomBytes(32);
    const paymentHashHex = crypto.createHash('sha256').update(preimage).digest('hex');
    const offer = Witness.signArtifact({ type: 'DocumentOffer', documentId: 'd', merkleRootHex: rootHex, blobIndex: 0, blobHashHex: 'aa'.repeat(32), paymentHashHex }, priv);
    const Message = require('../types/message');
    const Key = require('../types/key');
    const garbage = Buffer.from('ff', 'hex');
    const frameHex = Message.fromVector(['P2P_FILE_SEND', JSON.stringify({ name: 'd', body: garbage.toString('base64'), blobIndex: 0, blobTotal: 1, blobHashHex: crypto.createHash('sha256').update(garbage).digest('hex'), merkleRootHex: rootHex, paymentHashHex })]).signWithKey(new Key({ private: priv.toString('hex') })).toBuffer().toString('hex');
    const proof = new FraudProof({ kind: 'wrong-bytes', artifacts: { offer, claim: { preimageHex: preimage.toString('hex') }, delivery: { frameHex } } }).toBody();
    const res = book.ingestFraudProof(JSON.parse(JSON.stringify(proof)));
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.offender, xOnly);
    assert.deepStrictEqual(res.penalized, ['seller-a']);
    assert.strictEqual(book.providerStats('seller-a').penalties, 1);
    assert.strictEqual(book.keyPenalties(pub), 1);
    assert.strictEqual(book.scoreFor('seller-b'), 0);
    assert.strictEqual(book.providerStats('seller-b'), null);
    const again = book.ingestFraudProof(JSON.parse(JSON.stringify(proof)));
    assert.strictEqual(again.ok, false);
    assert.strictEqual(again.duplicate, true);
    assert.strictEqual(book.providerStats('seller-a').penalties, 1);
    assert.strictEqual(book.ingestFraudProof({ type: 'FraudProof', kind: 'wrong-bytes', artifacts: {} }).ok, false);
  });
});
