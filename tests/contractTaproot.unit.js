'use strict';

const assert = require('assert');
const Key = require('../types/key');
const Contract = require('../types/contract');
const {
  synthesizeDefaultLadder,
  normalizeContractSpendPolicy,
  buildContractTaproot,
  toAddress,
  selectActiveTiers,
  policyAfterDecay,
  timelockMature,
  buildFederationVaultFromPolicy
} = require('../functions/contractTaproot');

describe('contractTaproot', function () {
  const keys = [];
  before(function () {
    for (let i = 0; i < 12; i++) keys.push(new Key());
  });

  function pk (i) { return keys[i].pubkey; }

  it('synthesizes a stable default 2-tier ladder', function () {
    const vals = [pk(0), pk(1), pk(2)];
    const shuffled = [pk(2), pk(0), pk(1)];
    const a = toAddress(synthesizeDefaultLadder({
      validators: vals,
      threshold: 2,
      publisher: pk(0),
      network: 'regtest',
      csvBlocks: 144
    }));
    const b = toAddress(synthesizeDefaultLadder({
      validators: shuffled,
      threshold: 2,
      publisher: pk(0),
      network: 'regtest',
      csvBlocks: 144
    }));
    assert.strictEqual(a, b);
    assert.ok(a.startsWith('bcrt1'));
  });

  it('builds multi-tier failover with until; expired tiers leave active set', function () {
    const policy = normalizeContractSpendPolicy({
      network: 'regtest',
      publisher: pk(0),
      decay: { mode: 'both', migrateKeys: [pk(0), pk(1), pk(2)], migrateThreshold: 2 },
      keySets: {
        full: keys.slice(0, 12).map((k) => k.pubkey),
        mid: keys.slice(0, 7).map((k) => k.pubkey),
        emergency: keys.slice(0, 3).map((k) => k.pubkey)
      },
      tiers: [
        { id: 't0', threshold: 7, keys: 'full', after: null, until: { type: 'csv', blocks: 100 } },
        { id: 't1', threshold: 4, keys: 'mid', after: { type: 'csv', blocks: 100 }, until: { type: 'csv', blocks: 200 } },
        { id: 't2', threshold: 2, keys: 'emergency', after: { type: 'csv', blocks: 200 }, until: null }
      ]
    });
    const built = buildContractTaproot(policy);
    assert.ok(built.address);
    assert.ok(built.leaves.some((l) => l.kind === 'migrate'));

    const early = selectActiveTiers(policy, { utxoAgeBlocks: 0 });
    assert.strictEqual(early[0].id, 't0');

    const mid = selectActiveTiers(policy, { utxoAgeBlocks: 150 });
    assert.ok(!mid.find((t) => t.id === 't0'));
    assert.strictEqual(mid[0].id, 't1');

    const child = policyAfterDecay(policy, { type: 'csv', blocks: 100 });
    assert.ok(!child.tiers.find((t) => t.id === 't0'));
    assert.notStrictEqual(toAddress(child), built.address);
  });

  it('legacy Hub single-leaf vault address is stable', function () {
    const vals = [pk(0), pk(1), pk(2)];
    const a = buildFederationVaultFromPolicy({
      validatorPubkeysHex: vals,
      threshold: 2,
      networkName: 'regtest'
    });
    const b = buildFederationVaultFromPolicy({
      validatorPubkeysHex: [pk(2), pk(0), pk(1)],
      threshold: 2,
      networkName: 'regtest'
    });
    assert.strictEqual(a.address, b.address);
    assert.ok(a.multisigScript.length);
  });

  it('Contract.toAddress uses spendLadder', function () {
    const c = new Contract({
      spendLadder: synthesizeDefaultLadder({
        validators: [pk(0), pk(1)],
        threshold: 1,
        publisher: pk(0),
        network: 'regtest',
        csvBlocks: 50
      })
    });
    assert.strictEqual(c.toAddress(), toAddress(c.settings.spendLadder));
  });

  it('timelockMature for csv', function () {
    assert.strictEqual(timelockMature(null, { utxoAgeBlocks: 0 }), true);
    assert.strictEqual(timelockMature({ type: 'csv', blocks: 10 }, { utxoAgeBlocks: 9 }), false);
    assert.strictEqual(timelockMature({ type: 'csv', blocks: 10 }, { utxoAgeBlocks: 10 }), true);
  });
});
