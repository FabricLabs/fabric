'use strict';

const assert = require('assert');
const Message = require('../types/message');
const contractProposal = require('../functions/contractProposal');

describe('functions/contractProposal', function () {
  it('merkleRootFromLeafHashes is deterministic', function () {
    const a = Buffer.alloc(32, 1);
    const b = Buffer.alloc(32, 2);
    const r1 = contractProposal.merkleRootFromLeafHashes([a, b]);
    const r2 = contractProposal.merkleRootFromLeafHashes([a, b]);
    assert.ok(r1.equals(r2));
  });

  it('buildContractProposalPayload + verifyContractProposalPayload', function () {
    const m1 = Message.fromVector(['ChatMessage', JSON.stringify({ text: 'a' })]);
    const m2 = Message.fromVector(['ChatMessage', JSON.stringify({ text: 'b' })]);
    const payload = contractProposal.buildContractProposalPayload({
      contractId: 'test-contract',
      parentChainRoot: null,
      messages: [m1, m2],
      statePatch: [{ op: 'add', path: '/x', value: 1 }]
    });
    assert.strictEqual(payload.version, 1);
    assert.ok(payload.chain.merkleRoot && payload.chain.merkleRoot.length === 64);
    const v = contractProposal.verifyContractProposalPayload(payload);
    assert.strictEqual(v.ok, true, v.error);
  });

  it('createContractProposalMessage sets ContractProposal type', function () {
    const m = Message.fromVector(['ChatMessage', JSON.stringify({ ping: true })]);
    const msg = contractProposal.createContractProposalMessage(null, { messages: [m] });
    assert.strictEqual(msg.wireType, 'CONTRACT_PROPOSAL');
    assert.strictEqual(msg.friendlyType, 'ContractProposal');
  });

  it('applyStatePatch applies RFC6902', function () {
    const doc = { a: 1 };
    const next = contractProposal.applyStatePatch(doc, [{ op: 'add', path: '/b', value: 2 }]);
    assert.strictEqual(next.a, 1);
    assert.strictEqual(next.b, 2);
  });
});
