'use strict';

const assert = require('assert');
const Key = require('../types/key');
const {
  authorityPubkeys,
  hasAuthority,
  publishSignerAuthorized
} = require('../types/contract');
const { normalizePeerPubkeyHex } = require('../functions/pubkey');

describe('Contract publish authority', function () {
  it('authorityPubkeys walks nested members and spendPolicy', function () {
    const owner = new Key();
    const co = new Key();
    const set = authorityPubkeys({
      members: { signers: [owner.pubkey] },
      spendPolicy: { validators: [co.pubkey] }
    });
    assert.ok(hasAuthority(set, owner.pubkey));
    assert.ok(hasAuthority(set, co.pubkey));
  });

  it('authorityPubkeys includes proposedPolicy.validators', function () {
    const v = new Key();
    const set = authorityPubkeys({
      proposedPolicy: { validators: [v.pubkey] }
    });
    assert.ok(hasAuthority(set, v.pubkey));
  });

  it('publishSignerAuthorized allows empty authority set (open genesis)', function () {
    assert.strictEqual(publishSignerAuthorized({ name: 'X' }, 'aa'.repeat(32)), true);
    assert.strictEqual(publishSignerAuthorized({ name: 'X' }, null), true);
  });

  it('publishSignerAuthorized rejects non-party signer', function () {
    const owner = new Key();
    const attacker = new Key();
    const def = { validators: [owner.pubkey] };
    assert.strictEqual(publishSignerAuthorized(def, owner.pubkey), true);
    assert.strictEqual(publishSignerAuthorized(def, attacker.pubkey), false);
  });

  it('publishSignerAuthorized fail-closes when authorities exist but signer is missing', function () {
    const owner = new Key();
    const def = { validators: [owner.pubkey] };
    assert.strictEqual(publishSignerAuthorized(def, null), false);
    assert.strictEqual(publishSignerAuthorized(def, ''), false);
  });

  it('normalizePeerPubkeyHex strips compressed prefix', function () {
    const k = new Key();
    const compressed = k.pubkey;
    assert.strictEqual(normalizePeerPubkeyHex(compressed).length, 64);
  });
});
