'use strict';

const assert = require('assert');
const Key = require('../types/key');
const {
  CONTRACT_STATE_TIP_KIND,
  signingStringForContractStateTip,
  signContractStateTip,
  verifyContractStateTip,
  mergeTipSignatures,
  tipDigestHex
} = require('../functions/contractStateSigning');

describe('contractStateSigning', function () {
  const contractId = 'abcd'.repeat(16);
  const clock = 3;
  const stateDigest = 'ef'.repeat(32);

  it('builds a canonical ContractStateTip string', function () {
    const s = signingStringForContractStateTip({ contractId, clock, stateDigest });
    assert.ok(s.includes(CONTRACT_STATE_TIP_KIND));
    assert.ok(s.includes(contractId));
    assert.strictEqual(typeof tipDigestHex(contractId, clock, stateDigest), 'string');
    assert.strictEqual(tipDigestHex(contractId, clock, stateDigest).length, 64);
  });

  it('signs and verifies 2-of-3 tips', function () {
    const k1 = new Key();
    const k2 = new Key();
    const k3 = new Key();
    const validators = [k1.pubkey, k2.pubkey, k3.pubkey];
    const a = signContractStateTip(k1, contractId, clock, stateDigest);
    const b = signContractStateTip(k2, contractId, clock, stateDigest);
    const sigs = mergeTipSignatures(
      { [a.pubkey]: a.signature },
      { [b.pubkey]: b.signature }
    );
    assert.strictEqual(
      verifyContractStateTip(validators, 2, contractId, clock, stateDigest, sigs),
      true
    );
    assert.strictEqual(
      verifyContractStateTip(validators, 3, contractId, clock, stateDigest, sigs),
      false
    );
    assert.strictEqual(
      verifyContractStateTip(validators, 2, contractId, clock + 1, stateDigest, sigs),
      false
    );
  });

  it('rejects invalid thresholds instead of defaulting to 1-of-n', function () {
    const k1 = new Key();
    const validators = [k1.pubkey];
    const a = signContractStateTip(k1, contractId, clock, stateDigest);
    const sigs = { [a.pubkey]: a.signature };
    assert.throws(
      () => verifyContractStateTip(validators, undefined, contractId, clock, stateDigest, sigs),
      /threshold must be a positive integer/
    );
    assert.throws(
      () => verifyContractStateTip(validators, 0, contractId, clock, stateDigest, sigs),
      /threshold must be a positive integer/
    );
    assert.throws(
      () => verifyContractStateTip(validators, 1.5, contractId, clock, stateDigest, sigs),
      /threshold must be a positive integer/
    );
  });
});
