'use strict';

const assert = require('assert');
const bitcoin = require('bitcoinjs-lib');
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
  HASHLOCK_LEAF_ID
} = require('../functions/blindedExecutionCircuit');
const { toAddress, synthesizeDefaultLadder } = require('../functions/contractTaproot');

describe('functions/blindedExecutionCircuit', function () {
  const keys = [];
  before(function () {
    for (let i = 0; i < 3; i++) keys.push(new Key());
  });
  function pk (i) { return keys[i].pubkey; }

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

  it('recordProposalDecision reject then accept; finalize needs an accept', function () {
    let session = composeGarblerPublish({
      name: 'coord-demo',
      network: 'regtest',
      garbler: pk(0),
      parties: [pk(1), pk(2)],
      state: { open: true },
      program: { language: 'fabric-opcodes', steps: ['OP_TRUE'] }
    });

    const rejectInner = Message.fromVector([
      'P2P_BASE_MESSAGE',
      JSON.stringify({ type: 'StateHint', object: { reject: true } })
    ]);
    const rejectProposal = buildContractProposalPayload({
      contractId: session.circuitId,
      messages: [rejectInner],
      statePatch: [{ op: 'replace', path: '/open', value: false }]
    });

    session = recordProposalDecision({
      session,
      proposalPayload: rejectProposal,
      decision: 'reject',
      actorPubkey: pk(1),
      at: 1000
    });
    assert.strictEqual(session.decisions.length, 1);
    assert.ok(session.coordinationRoot);
    const afterReject = session.coordinationRoot;

    assert.throws(() => finalizeBlindedExecution({ session }), /at least one accept/);

    const acceptInner = Message.fromVector([
      'P2P_BASE_MESSAGE',
      JSON.stringify({ type: 'StateHint', object: { accept: true } })
    ]);
    const acceptProposal = buildContractProposalPayload({
      contractId: session.circuitId,
      messages: [acceptInner],
      statePatch: [{ op: 'add', path: '/settled', value: true }]
    });

    session = recordProposalDecision({
      session,
      proposalPayload: acceptProposal,
      decision: 'accept',
      actorPubkey: pk(2),
      at: 2000
    });
    assert.strictEqual(session.decisions.length, 2);
    assert.notStrictEqual(session.coordinationRoot, afterReject);

    const baseCommitment = session.circuitCommitment;
    const finalized = finalizeBlindedExecution({ session });
    assert.strictEqual(finalized.finalized, true);
    assert.notStrictEqual(finalized.circuitCommitment, baseCommitment);
    assert.ok(/^[0-9a-f]{64}$/.test(finalized.hashlockCommitmentHex));
    assert.ok(/^[0-9a-f]{64}$/.test(finalized.hashlockPreimageHex));
  });

  it('binds finalized session to hashlock Taproot and spends with circuit preimage', async function () {
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
    assert.ok(bound.tree.leaves.some((l) => l.kind === 'hashlock' && l.id === HASHLOCK_LEAF_ID));
    assert.strictEqual(
      bound.tree.leaves.find((l) => l.kind === 'hashlock').commitmentHex,
      session.hashlockCommitmentHex
    );

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
    assert.strictEqual(prepared.witnessShape, 'preimage');

    const fin = bound.finalizeWithdrawal({ psbtBase64: prepared.psbtBase64 });
    assert.ok(fin.txHex);
    assert.ok(fin.txid);
    const spent = bitcoin.Transaction.fromHex(fin.txHex);
    assert.strictEqual(spent.ins[0].witness.length, 3);
  });
});
