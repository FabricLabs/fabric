'use strict';

const assert = require('assert');
const Key = require('../types/key');
const era = require('../functions/executionRunAttestation');

describe('executionRunAttestation', function () {
  it('signingStringForExecutionRun is stable', function () {
    const run = { programHash: 'abc', runCommitmentHex: 'd'.repeat(64) };
    const s1 = era.signingStringForExecutionRun(run);
    const s2 = era.signingStringForExecutionRun(run);
    assert.strictEqual(s1, s2);
  });

  it('verifyExecutionRunFederationWitness accepts valid witness', function () {
    const key = new Key({ private: '1111111111111111111111111111111111111111111111111111111111111111' });
    const run = { programHash: 'prog', runCommitmentHex: 'e'.repeat(64), contractId: 'c1' };
    const witness = era.buildFederationWitnessForExecutionRun({
      ...run,
      signKey: key,
      validators: [key.pubkey],
      threshold: 1
    });
    assert.ok(era.verifyExecutionRunFederationWitness(run, witness, [key.pubkey], 1));
  });

  it('verifyExecutionRunFederationWitness rejects attacker witness', function () {
    const owner = new Key({ private: '1111111111111111111111111111111111111111111111111111111111111111' });
    const attacker = new Key({ private: '2222222222222222222222222222222222222222222222222222222222222222' });
    const run = { programHash: 'prog', runCommitmentHex: 'f'.repeat(64), contractId: 'c2' };
    const witness = era.buildFederationWitnessForExecutionRun({
      ...run,
      signKey: attacker,
      validators: [attacker.pubkey],
      threshold: 1
    });
    assert.strictEqual(
      era.verifyExecutionRunFederationWitness(run, witness, [owner.pubkey], 1),
      false
    );
    assert.strictEqual(
      era.verifyExecutionRunFederationWitness(run, null, [owner.pubkey], 1),
      false
    );
  });
});
