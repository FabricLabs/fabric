'use strict';

const assert = require('assert');
const Key = require('../types/key');
const {
  OP_CONTRACT_READ,
  OP_CONTRACT_SIGN,
  issueContractCapability,
  verifyContractCapability,
  roleToCapability,
  capabilityToRole
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
    assert.strictEqual(payload.verified, true);
  });

  it('rejects wrong contractId and wrong subject', function () {
    const issuer = new Key();
    const subject = new Key().pubkey;
    const tok = issueContractCapability({
      issuerKey: issuer,
      subject,
      contractId: 'aa'.repeat(32)
    });
    assert.strictEqual(verifyContractCapability(tok, {
      contractId: 'bb'.repeat(32),
      issuerKey: issuer
    }), null);
    assert.strictEqual(verifyContractCapability(tok, {
      contractId: 'aa'.repeat(32),
      subject: new Key().pubkey,
      issuerKey: issuer
    }), null);
  });

  it('requires issuerKey or allowUnverified; marks parse-only unverified', function () {
    const issuer = new Key();
    const contractId = 'cc'.repeat(32);
    const tok = issueContractCapability({
      issuerKey: issuer,
      subject: new Key().pubkey,
      contractId,
      capability: OP_CONTRACT_SIGN
    });
    assert.strictEqual(verifyContractCapability(tok, { contractId }), null);

    const forged = Buffer.from(JSON.stringify({
      cap: OP_CONTRACT_SIGN,
      sub: 'evil',
      iss: 'x',
      iat: 1,
      exp: Math.floor(Date.now() / 1000) + 3600,
      ctx: { contractId }
    })).toString('base64url') + '.00';

    assert.strictEqual(verifyContractCapability(forged, { contractId }), null);
    const parsed = verifyContractCapability(forged, {
      contractId,
      allowUnverified: true
    });
    assert.ok(parsed);
    assert.strictEqual(parsed.verified, false);
    assert.strictEqual(parsed.cap, OP_CONTRACT_SIGN);
  });

  it('maps roles and capabilities', function () {
    assert.strictEqual(roleToCapability('signer'), OP_CONTRACT_SIGN);
    assert.strictEqual(roleToCapability('reader'), OP_CONTRACT_READ);
    assert.strictEqual(capabilityToRole(OP_CONTRACT_SIGN), 'signer');
    assert.strictEqual(capabilityToRole(OP_CONTRACT_READ), 'reader');
  });

  it('rejects unsupported capability on issue', function () {
    assert.throws(() => issueContractCapability({
      issuerKey: new Key(),
      subject: new Key().pubkey,
      contractId: 'dd'.repeat(32),
      capability: 'OP_OTHER'
    }), /unsupported/);
  });
});
