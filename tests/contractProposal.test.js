'use strict';

const assert = require('assert');
const Key = require('../types/key');
const Message = require('../types/message');
const contractProposal = require('../functions/contractProposal');
const {
  createContractProposalMessage,
  buildContractProposalPayload,
  verifyContractProposalPayload
} = contractProposal;

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
    const payload = buildContractProposalPayload({
      contractId: 'test-contract',
      parentChainRoot: null,
      messages: [m1, m2],
      statePatch: [{ op: 'add', path: '/x', value: 1 }]
    });
    assert.strictEqual(payload.version, 1);
    assert.ok(payload.chain.merkleRoot && payload.chain.merkleRoot.length === 64);
    const v = verifyContractProposalPayload(payload);
    assert.strictEqual(v.ok, true, v.error);
  });

  it('createContractProposalMessage sets CONTRACT_PROPOSAL wire type', function () {
    const key = new Key({});
    const inner = Message.fromVector(['GenericMessage', JSON.stringify({ type: 'X', object: {} })]);
    inner.signWithKey(key);
    const msg = createContractProposalMessage(key, { messages: [inner], contractId: 'c1' });
    assert.strictEqual(msg.wireType, 'CONTRACT_PROPOSAL');
    assert.strictEqual(msg.type, 'CONTRACT_PROPOSAL');
    assert.strictEqual(msg.friendlyType, 'ContractProposal');
  });

  it('round-trip buffer preserves wire type and verifyContractProposalPayload passes', function () {
    const key = new Key({});
    const inner = Message.fromVector(['GenericMessage', JSON.stringify({ type: 'Y', object: { n: 1 } })]);
    inner.signWithKey(key);
    const msg = createContractProposalMessage(key, { messages: [inner], contractId: 'c2' });
    const again = Message.fromBuffer(msg.toBuffer());
    assert.strictEqual(again.wireType, 'CONTRACT_PROPOSAL');
    assert.strictEqual(again.friendlyType, 'ContractProposal');
    const payload = JSON.parse(again.data);
    const v = verifyContractProposalPayload(payload);
    assert.strictEqual(v.ok, true);
  });

  it('buildContractProposalPayload rejects empty messages', function () {
    assert.throws(() => buildContractProposalPayload({ messages: [] }), /At least one Fabric Message/);
  });

  it('applyStatePatch applies RFC6902', function () {
    const doc = { a: 1 };
    const next = contractProposal.applyStatePatch(doc, [{ op: 'add', path: '/b', value: 2 }]);
    assert.strictEqual(next.a, 1);
    assert.strictEqual(next.b, 2);
  });
});
