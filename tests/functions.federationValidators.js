'use strict';

const assert = require('assert');
const Key = require('../types/key');
const {
  uniqueValidatorPubkeys,
  resolveFederationThreshold
} = require('../functions/federationValidators');

describe('@fabric/core/functions/federationValidators', function () {
  const k1 = new Key({ private: '11'.repeat(32) });
  const k2 = new Key({ private: '22'.repeat(32) });
  const k3 = new Key({ private: '33'.repeat(32) });

  it('keeps one entry per signing key however it is spelled', function () {
    const x = k1.pubkey.slice(2);
    const flipped = (k1.pubkey.startsWith('02') ? '03' : '02') + x;
    const out = uniqueValidatorPubkeys([
      k1.pubkey,
      k1.pubkey.toUpperCase(),
      x,
      flipped,
      '0x' + k1.pubkey,
      k2.pubkey,
      '',
      null
    ]);
    assert.deepStrictEqual(out, [k1.pubkey, k2.pubkey]);
  });

  it('defaults to a strict majority of distinct validators', function () {
    assert.strictEqual(resolveFederationThreshold(null, []), 1);
    assert.strictEqual(resolveFederationThreshold(undefined, [k1.pubkey]), 1);
    assert.strictEqual(resolveFederationThreshold(null, [k1.pubkey, k2.pubkey]), 2);
    assert.strictEqual(resolveFederationThreshold('', [k1.pubkey, k2.pubkey, k3.pubkey]), 2);
    assert.strictEqual(resolveFederationThreshold(0, [k1.pubkey, k2.pubkey, k3.pubkey]), 2);
    assert.strictEqual(resolveFederationThreshold(null, [k1.pubkey, k1.pubkey.toUpperCase(), k2.pubkey]), 2);
  });

  it('honors an explicit threshold, rounded up', function () {
    const three = [k1.pubkey, k2.pubkey, k3.pubkey];
    assert.strictEqual(resolveFederationThreshold(1, three), 1);
    assert.strictEqual(resolveFederationThreshold('3', three), 3);
    assert.strictEqual(resolveFederationThreshold(1.5, three), 2);
  });
});
