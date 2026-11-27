'use strict';

const assert = require('assert');
const crypto = require('crypto');
const bitcoin = require('bitcoinjs-lib');
const { secp256k1, schnorr } = require('@noble/curves/secp256k1.js');

const {
  offer,
  rerun,
  bountyForRun,
  answerHashForRun,
  verifyWrongRun
} = require('../functions/computeJob');
const Bond = require('../types/bond');
const Witness = require('../types/witness');

function keypair () {
  const priv = crypto.randomBytes(32);
  return {
    priv,
    pub: Buffer.from(secp256k1.getPublicKey(priv, true)).toString('hex'),
    xOnly: Buffer.from(schnorr.getPublicKey(priv)).toString('hex')
  };
}

function fundingFor (address, sats = 50000n) {
  const tx = new bitcoin.Transaction();
  tx.version = 2;
  tx.addInput(crypto.randomBytes(32), 0);
  tx.addOutput(bitcoin.address.toOutputScript(address, bitcoin.networks.regtest), sats);
  return tx.toHex();
}

const program = {
  language: 'fabric-execution',
  source: { version: 1, steps: [{ op: 'Push', value: 2 }, { op: 'Push', value: 3 }, { op: 'ADD' }] }
};

describe('compute jobs', function () {
  this.timeout(20000);
  const publisher = keypair();
  const worker = keypair();

  it('refuses javascript, trusted, and oversized programs before a bond is built', function () {
    assert.throws(() => offer({
      program: { language: 'javascript', source: { add: function add () {} }, steps: ['add'] },
      input: 1,
      priceSats: 20000,
      bondSats: 20000,
      challengeWindowBlocks: 10
    }), /javascript/);
    assert.throws(() => offer({
      program: Object.assign({ trusted: true }, program),
      input: 1,
      priceSats: 20000,
      bondSats: 20000,
      challengeWindowBlocks: 10
    }), /trusted/);
    const steps = [];
    for (let i = 0; i < 257; i++) steps.push({ op: 'Push', value: 1 });
    assert.throws(() => offer({
      program: { language: 'fabric-execution', source: { version: 1, steps } },
      input: null,
      priceSats: 20000,
      bondSats: 20000,
      challengeWindowBlocks: 10
    }), /256 steps/);
  });

  it('pays the worker for an honest run and slashes a forged commitment', function () {
    const job = offer({
      program,
      input: { n: 1 },
      priceSats: 20000,
      bondSats: 30000,
      challengeWindowBlocks: 12,
      workerPubkey: worker.xOnly
    });
    assert.strictEqual(job.type, 'ComputeOffer');
    const honest = rerun(program, { n: 1 });
    assert.strictEqual(honest.ok, true, honest.error);
    assert.strictEqual(honest.inputCommitment, job.inputCommitment);
    assert.deepStrictEqual(honest.stack[0], { n: 1 });
    const other = rerun(program, { n: 2 });
    assert.strictEqual(other.ok, true, other.error);
    assert.notStrictEqual(other.jobCommitmentHex, honest.jobCommitmentHex);
    assert.strictEqual(other.runCommitmentHex, honest.runCommitmentHex);
    const opcodes = rerun({ language: 'fabric-opcodes', steps: [] }, { n: 1 });
    const opcodesOther = rerun({ language: 'fabric-opcodes', steps: [] }, { n: 2 });
    assert.strictEqual(opcodes.ok, true, opcodes.error);
    assert.deepStrictEqual(opcodes.stack[0], { n: 1 });
    assert.notStrictEqual(opcodes.jobCommitmentHex, opcodesOther.jobCommitmentHex);

    const bounty = bountyForRun({
      programHash: job.programHash,
      runCommitmentHex: honest.runCommitmentHex,
      publisherPubkey: publisher.pub,
      workerPubkey: worker.pub,
      priceSats: job.priceSats,
      refundAfter: 500 + job.challengeWindowBlocks,
      epoch: 1
    });
    const fundedBounty = fundingFor(bounty.outputs[0].address);
    const dest = bitcoin.payments.p2wpkh({
      pubkey: Buffer.from(worker.pub, 'hex'),
      network: bitcoin.networks.regtest
    }).address;
    const claim = Bond.prepareBountyClaim(bounty, {
      epoch: 1,
      providerPubkey: worker.pub,
      preimageHex: honest.runCommitmentHex,
      fundedTxHex: fundedBounty,
      destinationAddress: dest,
      feeSats: 500
    });
    assert.strictEqual(claim.witnessShape, 'preimage+sig');

    const deposit = Bond.buildDeposit({
      network: 'regtest',
      providerPubkey: worker.pub,
      publisherPubkey: publisher.pub,
      withdrawAfter: 2000,
      amountSats: job.bondSats,
      merkleRootHex: job.programHash,
      answerHashHex: answerHashForRun('aa'.repeat(32))
    });
    const fundedDeposit = fundingFor(deposit.address);
    const fundedTxid = bitcoin.Transaction.fromHex(fundedDeposit).getId();
    const claimedRunCommitmentHex = 'ab'.repeat(32);
    const signedClaim = Witness.signArtifact({
      type: 'ComputeRunClaim',
      programHash: job.programHash,
      inputCommitment: job.inputCommitment,
      claimedRunCommitmentHex,
      depositAddress: deposit.address
    }, worker.priv);
    const artifacts = {
      program: job.program,
      programHash: job.programHash,
      input: { n: 1 },
      inputCommitment: job.inputCommitment,
      claimedRunCommitmentHex,
      workerPubkey: worker.xOnly,
      depositAddress: deposit.address,
      deposit: { txid: fundedTxid, vout: 0 },
      claim: signedClaim
    };
    assert.strictEqual(verifyWrongRun(Object.assign({}, artifacts, { claim: null })).ok, false);
    const forged = verifyWrongRun(artifacts);
    assert.strictEqual(forged.ok, true);
    assert.strictEqual(forged.offender, worker.xOnly);
    const proof = new Witness.FraudProof({ kind: 'wrong-run', artifacts });
    assert.strictEqual(proof.verify().ok, true);
    assert.ok(proof.evidenceIds()[0].includes(worker.xOnly));
    const matched = verifyWrongRun(Object.assign({}, artifacts, {
      claimedRunCommitmentHex: honest.jobCommitmentHex,
      claim: Witness.signArtifact({
        type: 'ComputeRunClaim',
        programHash: job.programHash,
        inputCommitment: job.inputCommitment,
        claimedRunCommitmentHex: honest.jobCommitmentHex,
        depositAddress: deposit.address
      }, worker.priv)
    }));
    assert.strictEqual(matched.ok, false);
    assert.match(matched.reason || '', /matches the rerun/);
    const swapped = verifyWrongRun(Object.assign({}, artifacts, {
      input: { n: 2 },
      claimedRunCommitmentHex: honest.jobCommitmentHex,
      claim: Witness.signArtifact({
        type: 'ComputeRunClaim',
        programHash: job.programHash,
        inputCommitment: job.inputCommitment,
        claimedRunCommitmentHex: honest.jobCommitmentHex,
        depositAddress: deposit.address
      }, worker.priv)
    }));
    assert.strictEqual(swapped.ok, false);

    const publisherDest = bitcoin.payments.p2wpkh({
      pubkey: Buffer.from(publisher.pub, 'hex'),
      network: bitcoin.networks.regtest
    }).address;
    const penalty = Bond.preparePenaltySpend(deposit, {
      fraudProof: proof.toBody(),
      fundedTxHex: fundedDeposit,
      destinationAddress: publisherDest,
      feeSats: 500,
      consumed: new Set()
    });
    assert.strictEqual(penalty.leafId, 'penalty');
    assert.strictEqual(penalty.fraudProofKind, 'wrong-run');
    assert.strictEqual(penalty.offender, worker.xOnly);
  });
});
