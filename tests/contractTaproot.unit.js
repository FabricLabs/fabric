'use strict';

const assert = require('assert');
const bitcoin = require('bitcoinjs-lib');
const Key = require('../types/key');
const Contract = require('../types/contract');
const Federation = require('../types/federation');
const {
  synthesizeDefaultLadder,
  normalizeContractSpendPolicy,
  normalizeLock,
  buildContractTaproot,
  buildKOfNTapscript,
  toAddress,
  selectActiveTiers,
  policyAfterDecay,
  timelockMature,
  networkForFabricName,
  buildFederationVaultFromPolicy,
  prepareTierWithdrawalPsbt,
  parseCompressedPubkeysSorted
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
    assert.strictEqual(a.policy, null);
  });

  it('publisher + csvBlocks selects failover ladder without useLadder', function () {
    const vals = [pk(0), pk(1), pk(2)];
    const legacy = buildFederationVaultFromPolicy({
      validatorPubkeysHex: vals,
      threshold: 2,
      networkName: 'regtest'
    });
    const ladder = buildFederationVaultFromPolicy({
      validatorPubkeysHex: vals,
      threshold: 2,
      networkName: 'regtest',
      publisher: pk(0),
      csvBlocks: 144
    });
    assert.ok(ladder.policy);
    assert.notStrictEqual(ladder.address, legacy.address);
    assert.ok(ladder.leaves.length >= 2);
  });

  it('Contract.toAddress prefers overrides.spendLadder', function () {
    const ladderA = synthesizeDefaultLadder({
      validators: [pk(0), pk(1)],
      threshold: 1,
      publisher: pk(0),
      network: 'regtest',
      csvBlocks: 50
    });
    const ladderB = synthesizeDefaultLadder({
      validators: [pk(2), pk(3)],
      threshold: 1,
      publisher: pk(2),
      network: 'regtest',
      csvBlocks: 50
    });
    const c = new Contract({ spendLadder: ladderA });
    assert.strictEqual(c.toAddress(), toAddress(ladderA));
    assert.strictEqual(
      c.toTaprootContract({ spendLadder: ladderB }).address,
      toAddress(ladderB)
    );
  });

  it('Federation.address uses toTaprootContract / consistent network', function () {
    const federation = new Federation({
      network: 'regtest',
      threshold: 2,
      publisher: pk(0),
      csvBlocks: 144,
      consensus: { validators: [pk(0), pk(1), pk(2)] }
    });
    const addr = federation.address;
    assert.ok(addr.startsWith('bcrt1'));
    assert.strictEqual(addr, federation.toAddress());
    assert.strictEqual(
      addr,
      toAddress(synthesizeDefaultLadder({
        validators: [pk(0), pk(1), pk(2)],
        threshold: 2,
        publisher: pk(0),
        network: 'regtest',
        csvBlocks: 144
      }))
    );
  });

  it('timelockMature for csv and cltv', function () {
    assert.strictEqual(timelockMature(null, { utxoAgeBlocks: 0 }), true);
    assert.strictEqual(timelockMature({ type: 'csv', blocks: 10 }, { utxoAgeBlocks: 9 }), false);
    assert.strictEqual(timelockMature({ type: 'csv', blocks: 10 }, { utxoAgeBlocks: 10 }), true);
    assert.strictEqual(timelockMature({ type: 'cltv', height: 100 }, { tipHeight: 99 }), false);
    assert.strictEqual(timelockMature({ type: 'cltv', height: 100 }, { tipHeight: 100 }), true);
  });

  it('normalizeLock rejects CSV above 65535', function () {
    assert.ok(normalizeLock({ type: 'csv', blocks: 65535 }));
    assert.strictEqual(normalizeLock({ type: 'csv', blocks: 65536 }), null);
    assert.strictEqual(normalizeLock({ type: 'csv', blocks: 0 }), null);
  });

  it('throws when threshold exceeds unique key count', function () {
    const pks = parseCompressedPubkeysSorted([pk(0), pk(1), pk(0)]);
    assert.strictEqual(pks.length, 2);
    assert.throws(
      () => buildKOfNTapscript(pks, 3),
      /exceeds unique key count/
    );
    assert.throws(() => normalizeContractSpendPolicy({
      network: 'regtest',
      publisher: pk(0),
      keySets: { full: [pk(0), pk(1)] },
      tiers: [{ id: 't0', threshold: 3, keys: 'full' }]
    }), /exceeds unique key count/);
  });

  it('rejects mixed csv/cltv lock ladders', function () {
    assert.throws(() => normalizeContractSpendPolicy({
      network: 'regtest',
      publisher: pk(0),
      keySets: { full: [pk(0), pk(1)] },
      tiers: [
        { id: 't0', threshold: 1, keys: 'full', after: { type: 'csv', blocks: 10 } },
        { id: 't1', threshold: 1, keys: 'full', after: { type: 'cltv', height: 100 } }
      ]
    }), /lock type must match/);
  });

  it('networkForFabricName does not alias bare test to regtest', function () {
    assert.strictEqual(networkForFabricName('regtest'), bitcoin.networks.regtest);
    assert.strictEqual(networkForFabricName('testnet'), bitcoin.networks.testnet);
    // Ambiguous "test" falls through to mainnet (same as unknown names).
    assert.strictEqual(networkForFabricName('test'), bitcoin.networks.bitcoin);
  });

  it('selectActiveTiers honors when predicates', function () {
    const policy = normalizeContractSpendPolicy({
      network: 'regtest',
      publisher: pk(0),
      decay: { mode: 'policy' },
      keySets: { full: [pk(0), pk(1)] },
      tiers: [{
        id: 'gated',
        threshold: 1,
        keys: 'full',
        after: null,
        when: { allOf: [{ op: 'tipClockGte', value: 5 }] }
      }]
    });
    assert.strictEqual(selectActiveTiers(policy, { tipClock: 4 }).length, 0);
    assert.strictEqual(selectActiveTiers(policy, { tipClock: 5 })[0].id, 'gated');
  });

  it('prepareTierWithdrawalPsbt sets locktime for CLTV leaves', function () {
    const policy = normalizeContractSpendPolicy({
      network: 'regtest',
      publisher: pk(0),
      decay: { mode: 'policy' },
      keySets: { full: [pk(0), pk(1)] },
      tiers: [{
        id: 'cltv',
        threshold: 1,
        keys: 'full',
        after: { type: 'cltv', height: 250 }
      }]
    });
    const built = buildContractTaproot(policy);
    const network = bitcoin.networks.regtest;
    const funding = new bitcoin.Transaction();
    funding.version = 2;
    funding.addInput(Buffer.alloc(32), 0);
    funding.addOutput(bitcoin.address.toOutputScript(built.address, network), 50_000n);
    const dest = bitcoin.payments.p2wpkh({
      pubkey: Buffer.from(pk(5), 'hex'),
      network
    }).address;

    const prep = prepareTierWithdrawalPsbt({
      policy,
      fundedTxHex: funding.toHex(),
      destinationAddress: dest,
      feeSats: 1000,
      ctx: { tipHeight: 250 },
      tierId: 'cltv'
    });
    assert.strictEqual(prep.locktime, 250);
    assert.ok(prep.sequence !== 0xffffffff);
    assert.ok(prep.psbtBase64);
  });
});
