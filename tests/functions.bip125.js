'use strict';

const assert = require('assert');
const {
  BIP125_SEQUENCE_FINAL,
  BIP125_SEQUENCE_LOCKTIME_ONLY,
  BIP125_SEQUENCE_RBF,
  sequenceSignalsOptInRbf,
  transactionSignalsOptInRbf
} = require('../functions/bip125');

describe('@fabric/core/functions/bip125', function () {
  it('treats MAX-2 as opt-in RBF and MAX-1 as locktime-only', function () {
    assert.strictEqual(BIP125_SEQUENCE_FINAL, (2 ** 32) - 1);
    assert.strictEqual(BIP125_SEQUENCE_LOCKTIME_ONLY, (2 ** 32) - 2);
    assert.strictEqual(BIP125_SEQUENCE_RBF, (2 ** 32) - 3);
    assert.strictEqual(sequenceSignalsOptInRbf(BIP125_SEQUENCE_FINAL), false);
    assert.strictEqual(sequenceSignalsOptInRbf(BIP125_SEQUENCE_LOCKTIME_ONLY), false);
    assert.strictEqual(sequenceSignalsOptInRbf(BIP125_SEQUENCE_RBF), true);
    assert.strictEqual(sequenceSignalsOptInRbf(0), true);
  });

  it('opts the transaction in when any input signals RBF', function () {
    assert.strictEqual(transactionSignalsOptInRbf([
      { sequence: BIP125_SEQUENCE_LOCKTIME_ONLY },
      { nSequence: BIP125_SEQUENCE_RBF }
    ]), true);
    assert.strictEqual(transactionSignalsOptInRbf([
      { sequence: BIP125_SEQUENCE_LOCKTIME_ONLY }
    ]), false);
    assert.strictEqual(transactionSignalsOptInRbf([]), false);
    assert.strictEqual(transactionSignalsOptInRbf(null), false);
    assert.strictEqual(sequenceSignalsOptInRbf(undefined), false);
    assert.strictEqual(sequenceSignalsOptInRbf(Number.NaN), false);
    assert.strictEqual(sequenceSignalsOptInRbf(0.5), false);
    assert.strictEqual(sequenceSignalsOptInRbf(4294967296), false);
  });
});
