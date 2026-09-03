'use strict';

const assert = require('assert');
const bitcoin = require('bitcoinjs-lib');
const ecc = require('../types/ecc');
const Key = require('../types/key');
const Message = require('../types/message');
const Machine = require('../types/machine');
const Program = require('../types/program');
const {
  buildContractProposalPayload
} = require('../functions/contractProposal');
const {
  composeGarblerPublish,
  recordProposalDecision,
  finalizeBlindedExecution,
  bindBlindedExecutionToHashlock,
  decisionSigningMessage,
  HASHLOCK_LEAF_ID,
  DECISION_SIGNING_VERSION
} = require('../functions/blindedExecutionCircuit');
const { toAddress, synthesizeDefaultLadder } = require('../functions/contractTaproot');

describe('functions/blindedExecutionCircuit', function () {
  const keys = [];
  before(function () {
    bitcoin.initEccLib(ecc);
    for (let i = 0; i < 3; i++) keys.push(new Key());
  });
  function pk (i) { return keys[i].pubkey; }
  function signDecision (keyIndex, session, proposalPayload, decision, at) {
    const merkle = proposalPayload.chain && proposalPayload.chain.merkleRoot
      ? String(proposalPayload.chain.merkleRoot).toLowerCase()
      : '';
    const msg = decisionSigningMessage({
      sessionId: session.circuitId,
      proposalMerkleRoot: merkle,
      decision,
      at
    });
    return Buffer.from(keys[keyIndex].signSchnorr(msg)).toString('hex');
  }

  it('composeGarblerPublish requires an evaluator party and is digest-stable', function () {
    assert.throws(() => composeGarblerPublish({
      network: 'regtest',
      parties: [],
      state: { v: 1 }
    }), /at least one evaluator/);

    const a = composeGarblerPublish({
      name: 'hashlock-demo',
      network: 'regtest',
      garbler: pk(0),
      parties: [pk(1)],
      state: { balance: 1 },
      program: { language: 'fabric-opcodes', steps: ['OP_TRUE'] }
    });
    const b = composeGarblerPublish({
      name: 'hashlock-demo',
      network: 'regtest',
      garbler: pk(0),
      parties: [pk(1)],
      state: { balance: 1 },
      program: { language: 'fabric-opcodes', steps: ['OP_TRUE'] }
    });

    assert.strictEqual(a.version, 1);
    assert.ok(a.circuitId && /^[0-9a-f]{64}$/.test(a.circuitId));
    assert.strictEqual(a.programHash, b.programHash);
    assert.strictEqual(a.stateDigest, b.stateDigest);
    assert.strictEqual(a.circuitCommitment, b.circuitCommitment);
    assert.strictEqual(a.roles.garbler, pk(0).toLowerCase());
    assert.deepStrictEqual(a.roles.evaluators, [pk(1).toLowerCase()]);
    assert.strictEqual(a.definition['@type'], 'FabricContract');
    assert.ok(a.definition.interfaces.includes('fabric.blinded-execution'));
    assert.strictEqual(a.definition.blindedExecution.circuitCommitment, a.circuitCommitment);
    assert.strictEqual(a.finalized, false);
    assert.strictEqual(a.coordinationRoot, null);
  });

  it('composeGarblerPublish excludes garbler from evaluator set', function () {
    assert.throws(() => composeGarblerPublish({
      network: 'regtest',
      garbler: pk(0),
      parties: [pk(0)],
      state: { v: 1 }
    }), /distinct from garbler/);

    const session = composeGarblerPublish({
      network: 'regtest',
      garbler: pk(0),
      parties: [pk(0), pk(1)],
      state: { v: 1 },
      program: { language: 'fabric-opcodes', steps: ['OP_TRUE'] }
    });
    assert.deepStrictEqual(session.roles.evaluators, [pk(1).toLowerCase()]);
    assert.deepStrictEqual(session.parties, [pk(1).toLowerCase()]);
    assert.ok(!session.parties.includes(pk(0).toLowerCase()));
  });

  it('binds at into decisionSigningMessage v2 (relay cannot swap timestamp)', function () {
    assert.strictEqual(DECISION_SIGNING_VERSION, 2);
    const msg = decisionSigningMessage({
      sessionId: 'aa'.repeat(32),
      proposalMerkleRoot: 'bb'.repeat(32),
      decision: 'accept',
      at: 42
    });
    assert.strictEqual(
      msg,
      `fabric:blinded-execution-decision:2:${'aa'.repeat(32)}:${'bb'.repeat(32)}:accept:42`
    );
    assert.throws(() => decisionSigningMessage({
      sessionId: 'aa'.repeat(32),
      proposalMerkleRoot: 'bb'.repeat(32),
      decision: 'accept'
    }), /at must be a non-negative safe integer/);

    const session = composeGarblerPublish({
      network: 'regtest',
      garbler: pk(0),
      parties: [pk(1)],
      state: { v: 1 },
      program: { language: 'fabric-opcodes', steps: ['OP_TRUE'] }
    });
    const proposal = buildContractProposalPayload({
      contractId: session.circuitId,
      messages: [Message.fromVector([
        'P2P_BASE_MESSAGE',
        JSON.stringify({ type: 'StateHint', object: { go: true } })
      ])],
      statePatch: [{ op: 'add', path: '/ok', value: true }]
    });
    assert.throws(() => recordProposalDecision({
      session,
      proposalPayload: proposal,
      decision: 'accept',
      actorPubkey: pk(1),
      signature: signDecision(1, session, proposal, 'accept', 7)
    }), /at required/);
  });

  it('recordProposalDecision reject then accept; finalize needs an evaluator accept', function () {
    let session = composeGarblerPublish({
      name: 'coord-demo',
      network: 'regtest',
      garbler: pk(0),
      parties: [pk(1), pk(2)],
      state: { open: true },
      program: { language: 'fabric-opcodes', steps: ['OP_TRUE'] }
    });

    const outsider = new Key();
    const rejectInner = Message.fromVector([
      'P2P_BASE_MESSAGE',
      JSON.stringify({ type: 'StateHint', object: { reject: true } })
    ]);
    const rejectProposal = buildContractProposalPayload({
      contractId: session.circuitId,
      messages: [rejectInner],
      statePatch: [{ op: 'replace', path: '/open', value: false }]
    });

    assert.throws(() => recordProposalDecision({
      session,
      proposalPayload: rejectProposal,
      decision: 'accept',
      actorPubkey: outsider.pubkey,
      signature: 'aa'.repeat(64),
      at: 999
    }), /not a session party/);

    assert.throws(() => recordProposalDecision({
      session,
      proposalPayload: rejectProposal,
      decision: 'reject',
      actorPubkey: pk(1),
      at: 1000
    }), /signature required/);

    session = recordProposalDecision({
      session,
      proposalPayload: rejectProposal,
      decision: 'reject',
      actorPubkey: pk(1),
      signature: signDecision(1, session, rejectProposal, 'reject', 1000),
      at: 1000
    });
    assert.strictEqual(session.decisions.length, 1);
    assert.ok(session.coordinationRoot);
    const afterReject = session.coordinationRoot;

    // Same actor/proposal/decision/`at` is idempotent.
    const replayed = recordProposalDecision({
      session,
      proposalPayload: rejectProposal,
      decision: 'reject',
      actorPubkey: pk(1),
      signature: signDecision(1, session, rejectProposal, 'reject', 1000),
      at: 1000
    });
    assert.strictEqual(replayed.decisions.length, 1);
    assert.strictEqual(replayed.coordinationRoot, afterReject);
    assert.strictEqual(replayed.decisions[0].at, 1000);

    // A relay cannot swap `at` under a valid signature (v2 binds timestamp).
    assert.throws(() => recordProposalDecision({
      session,
      proposalPayload: rejectProposal,
      decision: 'reject',
      actorPubkey: pk(1),
      signature: signDecision(1, session, rejectProposal, 'reject', 1000),
      at: 9999
    }), /invalid decision signature/);

    // A later different `at` with a fresh signature is a conflict, not a second row.
    assert.throws(() => recordProposalDecision({
      session,
      proposalPayload: rejectProposal,
      decision: 'reject',
      actorPubkey: pk(1),
      signature: signDecision(1, session, rejectProposal, 'reject', 9999),
      at: 9999
    }), /conflicting at/);

    assert.throws(() => finalizeBlindedExecution({ session }), /evaluator accept/);

    // Garbler-only accept is not enough — need an evaluator.
    const garblerAcceptProposal = buildContractProposalPayload({
      contractId: session.circuitId,
      messages: [Message.fromVector([
        'P2P_BASE_MESSAGE',
        JSON.stringify({ type: 'StateHint', object: { accept: true } })
      ])],
      statePatch: [{ op: 'add', path: '/garblerOk', value: true }]
    });
    session = recordProposalDecision({
      session,
      proposalPayload: garblerAcceptProposal,
      decision: 'accept',
      actorPubkey: pk(0),
      signature: signDecision(0, session, garblerAcceptProposal, 'accept', 1500),
      at: 1500
    });
    assert.throws(() => finalizeBlindedExecution({ session }), /evaluator accept/);

    const acceptInner = Message.fromVector([
      'P2P_BASE_MESSAGE',
      JSON.stringify({ type: 'StateHint', object: { accept: true } })
    ]);
    const acceptProposal = buildContractProposalPayload({
      contractId: session.circuitId,
      messages: [acceptInner],
      statePatch: [{ op: 'add', path: '/settled', value: true }]
    });

    assert.throws(() => recordProposalDecision({
      session,
      proposalPayload: acceptProposal,
      decision: 'accept',
      actorPubkey: pk(2),
      signature: signDecision(1, session, acceptProposal, 'accept', 2000),
      at: 2000
    }), /invalid decision signature/);

    session = recordProposalDecision({
      session,
      proposalPayload: acceptProposal,
      decision: 'accept',
      actorPubkey: pk(2),
      signature: signDecision(2, session, acceptProposal, 'accept', 2000),
      at: 2000
    });
    assert.strictEqual(session.decisions.length, 3);
    assert.notStrictEqual(session.coordinationRoot, afterReject);

    const baseCommitment = session.circuitCommitment;
    const finalized = finalizeBlindedExecution({ session });
    assert.strictEqual(finalized.finalized, true);
    assert.notStrictEqual(finalized.circuitCommitment, baseCommitment);
    assert.ok(/^[0-9a-f]{64}$/.test(finalized.hashlockCommitmentHex));
    assert.ok(/^[0-9a-f]{64}$/.test(finalized.hashlockPreimageHex));
  });

  it('binds finalized session to hashlock+pubkey Taproot (public preimage alone insufficient)', async function () {
    const { Psbt } = bitcoin;

    let session = composeGarblerPublish({
      name: 'hashlock-bind',
      network: 'regtest',
      garbler: pk(0),
      parties: [pk(1)],
      state: { phase: 'init' },
      program: { language: 'fabric-opcodes', steps: ['OP_TRUE'] }
    });

    const acceptInner = Message.fromVector([
      'P2P_BASE_MESSAGE',
      JSON.stringify({ type: 'StateHint', object: { go: true } })
    ]);
    const acceptProposal = buildContractProposalPayload({
      contractId: session.circuitId,
      messages: [acceptInner],
      statePatch: [{ op: 'replace', path: '/phase', value: 'accepted' }]
    });
    session = recordProposalDecision({
      session,
      proposalPayload: acceptProposal,
      decision: 'accept',
      actorPubkey: pk(1),
      signature: signDecision(1, session, acceptProposal, 'accept', 3000),
      at: 3000
    });

    const prog = Program.from({ language: 'fabric-opcodes', steps: ['OP_TRUE'] });
    prog.compile();
    const machine = new Machine();
    machine.define('OP_TRUE', () => true);
    const run = await machine.runProgram(prog);
    assert.strictEqual(run.ok, true);
    assert.ok(run.runCommitmentHex);

    session = finalizeBlindedExecution({
      session,
      runCommitmentHex: run.runCommitmentHex
    });

    const bound = bindBlindedExecutionToHashlock({
      session,
      validators: [pk(0), pk(1)],
      publisher: pk(0),
      network: 'regtest',
      threshold: 1
    });

    assert.notStrictEqual(bound.address, bound.ladderOnlyAddress);
    const hl = bound.tree.leaves.find((l) => l.kind === 'hashlock' && l.id === HASHLOCK_LEAF_ID);
    assert.ok(hl);
    assert.strictEqual(hl.commitmentHex, session.hashlockCommitmentHex);
    assert.strictEqual(String(hl.pubkeyHex).toLowerCase(), pk(0).toLowerCase());
    assert.strictEqual(hl.witnessShape, 'preimage+sig');

    const ladderOnly = synthesizeDefaultLadder({
      validators: [pk(0), pk(1)],
      threshold: 1,
      publisher: pk(0),
      network: 'regtest'
    });
    assert.strictEqual(bound.ladderOnlyAddress, toAddress(ladderOnly));

    const value = 100000n;
    const fund = new bitcoin.Transaction();
    fund.version = 2;
    fund.addInput(Buffer.alloc(32), 0);
    fund.addOutput(bound.tree.output, value);

    const destination = bitcoin.payments.p2wpkh({
      pubkey: Buffer.from(pk(2), 'hex'),
      network: bitcoin.networks.regtest
    }).address;

    const prepared = bound.prepareWithdrawal({
      fundedTxHex: fund.toHex(),
      destinationAddress: destination,
      feeSats: 1000
    });
    assert.ok(prepared.psbtBase64);
    assert.strictEqual(prepared.action, 'hashlock');
    assert.strictEqual(prepared.witnessShape, 'preimage+sig');

    const priv = Buffer.isBuffer(keys[0].private)
      ? keys[0].private
      : Buffer.from(String(keys[0].private), 'hex');
    const publicKey = Buffer.from(ecc.pointFromScalar(priv, true));
    const signer = {
      publicKey,
      sign (hash) { return Buffer.from(ecc.sign(hash, priv)); },
      signSchnorr (hash) { return Buffer.from(ecc.signSchnorr(hash, priv)); }
    };
    const psbt = Psbt.fromBase64(prepared.psbtBase64);
    psbt.signInput(0, signer);

    const fin = bound.finalizeWithdrawal({
      psbtBase64: psbt.toBase64(),
      witnessShape: 'preimage+sig'
    });
    assert.ok(fin.txHex);
    assert.ok(fin.txid);
    const spent = bitcoin.Transaction.fromHex(fin.txHex);
    assert.strictEqual(spent.ins[0].witness.length, 4);
  });
});
