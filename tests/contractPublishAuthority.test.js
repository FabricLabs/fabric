'use strict';

const assert = require('assert');
const Key = require('../types/key');
const {
  collectContractAuthorityPubkeys,
  authoritySetHasPubkey,
  contractPublishSignerAuthorized,
  normalizePeerPubkeyHex
} = require('../functions/contractPublishAuthority');

describe('contractPublishAuthority', function () {
  it('collectContractAuthorityPubkeys walks nested members and spendPolicy', function () {
    const owner = new Key();
    const co = new Key();
    const set = collectContractAuthorityPubkeys({
      members: { signers: [owner.pubkey] },
      spendPolicy: { validators: [co.pubkey] }
    });
    assert.ok(authoritySetHasPubkey(set, owner.pubkey));
    assert.ok(authoritySetHasPubkey(set, co.pubkey));
  });

  it('collectContractAuthorityPubkeys includes proposedPolicy.validators', function () {
    const v = new Key();
    const set = collectContractAuthorityPubkeys({
      proposedPolicy: { validators: [v.pubkey] }
    });
    assert.ok(authoritySetHasPubkey(set, v.pubkey));
  });

  it('contractPublishSignerAuthorized allows empty authority set', function () {
    assert.strictEqual(contractPublishSignerAuthorized({ name: 'X' }, 'aa'.repeat(32)), true);
  });

  it('contractPublishSignerAuthorized rejects non-party signer', function () {
    const owner = new Key();
    const attacker = new Key();
    const def = { validators: [owner.pubkey] };
    assert.strictEqual(contractPublishSignerAuthorized(def, owner.pubkey), true);
    assert.strictEqual(contractPublishSignerAuthorized(def, attacker.pubkey), false);
  });

  it('normalizePeerPubkeyHex strips compressed prefix', function () {
    const k = new Key();
    const compressed = k.pubkey;
    assert.strictEqual(normalizePeerPubkeyHex(compressed).length, 64);
  });
});
