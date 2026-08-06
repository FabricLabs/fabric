'use strict';

const assert = require('assert');
const Key = require('../types/key');
const {
  OP_CONTRACT_READ,
  OP_CONTRACT_SIGN,
  issueContractCapability,
  verifyContractCapability,
  roleToCapability
} = require('../functions/contractCapability');

describe('contractCapability', function () {
  it('issues and verifies a read token bound to contractId', function () {
    const issuer = new Key();
    const subject = new Key().pubkey;
    const contractId = 'ab'.repeat(32);
    const tok = issueContractCapability({
      issuerKey: issuer,
      subject,
      contractId,
      capability: OP_CONTRACT_READ
    });
    const payload = verifyContractCapability(tok, {
      contractId,
      expectedCap: OP_CONTRACT_READ,
      subject,
      issuerKey: issuer
    });
    assert.ok(payload);
    assert.strictEqual(payload.cap, OP_CONTRACT_READ);
    assert.strictEqual(payload.ctx.contractId, contractId);
  });

  it('rejects wrong contractId', function () {
    const issuer = new Key();
    const tok = issueContractCapability({
      issuerKey: issuer,
      subject: new Key().pubkey,
      contractId: 'aa'.repeat(32)
    });
    assert.strictEqual(verifyContractCapability(tok, {
      contractId: 'bb'.repeat(32),
      issuerKey: issuer
    }), null);
  });

  it('maps roles', function () {
    assert.strictEqual(roleToCapability('signer'), OP_CONTRACT_SIGN);
    assert.strictEqual(roleToCapability('reader'), OP_CONTRACT_READ);
  });
});
