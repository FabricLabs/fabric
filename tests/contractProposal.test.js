'use strict';

const assert = require('assert');
const Key = require('../types/key');
const Message = require('../types/message');
const {
  createContractProposalMessage,
  buildContractProposalPayload,
  verifyContractProposalPayload
} = require('../functions/contractProposal');

describe('functions/contractProposal', function () {
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
});
