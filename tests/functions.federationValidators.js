'use strict';

const assert = require('assert');
const Key = require('../types/key');
const {
  federationValidatorId,
  uniqueValidatorPubkeys,
  normalizeFederationValidators,
  findValidatorEntry,
  witnessSignatureFor,
  resolveFederationThreshold,
  federationThresholdExceedsValidators
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

  it('clamps an explicit threshold to the distinct validators', function () {
    const two = [k1.pubkey, k1.pubkey.slice(2), k2.pubkey];
    assert.strictEqual(resolveFederationThreshold(3, two), 2);
    assert.strictEqual(federationThresholdExceedsValidators(3, two), true);
    assert.strictEqual(federationThresholdExceedsValidators(2, two), false);
    assert.strictEqual(federationThresholdExceedsValidators(null, two), false);
    assert.strictEqual(resolveFederationThreshold(4, []), 4);
    assert.strictEqual(federationThresholdExceedsValidators(4, []), false);
  });

  it('ignores malformed and off-curve entries when counting validators', function () {
    const offCurve = '00'.repeat(32);
    const list = [k1.pubkey, offCurve, '02' + offCurve, 'zz'.repeat(33), 42, {}, k2.pubkey];
    assert.deepStrictEqual(uniqueValidatorPubkeys(list), [k1.pubkey, k2.pubkey]);
    assert.strictEqual(resolveFederationThreshold(null, list), 2);
  });

  it('normalizes validators to lowercase compressed keys', function () {
    const x2 = k2.pubkey.slice(2);
    const out = normalizeFederationValidators([
      k1.pubkey.toUpperCase(),
      x2,
      Buffer.from(k3.pubkey, 'hex'),
      k1.pubkey,
      '00'.repeat(32)
    ]);
    assert.deepStrictEqual(out, [k1.pubkey, '02' + x2, k3.pubkey]);
    assert.strictEqual(federationValidatorId(k2.pubkey), x2);
    assert.strictEqual(findValidatorEntry(out, k2.pubkey), '02' + x2);
    assert.strictEqual(findValidatorEntry(out, k1.pubkey.slice(2)), k1.pubkey);
    assert.strictEqual(findValidatorEntry(out, 'nope'), null);
    const sigs = { [k2.pubkey.toUpperCase()]: 'sig2' };
    assert.strictEqual(witnessSignatureFor(sigs, '02' + x2), 'sig2');
    assert.strictEqual(witnessSignatureFor(sigs, k1.pubkey), undefined);
  });
});
