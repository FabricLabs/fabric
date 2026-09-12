'use strict';

const assert = require('assert');
const {
  musig2EpochAggregateStatus,
  tryAggregateEpochWitness
} = require('../functions/musig2EpochAggregate');

describe('@fabric/core/functions/musig2EpochAggregate (explicit stub)', function () {
  it('advertises incomplete / unsupported so agents do not treat MuSig2 as shipped', function () {
    const status = musig2EpochAggregateStatus();
    assert.strictEqual(status.supported, false);
    assert.strictEqual(status.incomplete, true);
    assert.strictEqual(status.mode, 'threshold-schnorr-accumulate');
    assert.match(String(status.message), /beaconFederationSigning/i);
  });

  it('tryAggregateEpochWitness never seals a round (always null)', function () {
    assert.strictEqual(tryAggregateEpochWitness(null), null);
    assert.strictEqual(tryAggregateEpochWitness({
      status: 'ready',
      witness: { signatures: { aa: '00' } }
    }), null);
  });
});
