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
  parseCompressedPubkeysSorted,
  TAPROOT_INTERNAL_NUMS,
  composeTaprootTree,
  buildHashlockLeaf,
  buildSpendLeaf,
  buildScriptLeaf,
  compileLeaves,
  prepareHashlockWithdrawalPsbt,
  finalizeHashlockPsbt
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

  it('uses MuSig2 of the full validator set as the Taproot internal key when n>=2', function () {
    const { aggregateXonly } = require('../functions/musig2');
    const vals = [pk(0), pk(1), pk(2)];
    const policy = synthesizeDefaultLadder({
      validators: vals,
      threshold: 2,
      publisher: pk(0),
      network: 'regtest',
      csvBlocks: 144
    });
    assert.strictEqual(policy.internalKeyMode, 'musig2');
    const built = buildContractTaproot(policy);
    const expected = aggregateXonly(vals).toString('hex');
    assert.strictEqual(built.internalPubkeyHex, expected);
    const spend = built.leafScripts.find((l) => l.kind === 'spend');
    const cb = require('../functions/contractTaproot').buildControlBlockForLeaf(
      built.leafScripts,
      spend.script,
      Buffer.from(built.internalPubkeyHex, 'hex')
    );
    assert.strictEqual(cb.subarray(1, 33).toString('hex'), expected);
    const nums = synthesizeDefaultLadder({
      validators: vals,
      threshold: 2,
      publisher: pk(0),
      network: 'regtest',
      csvBlocks: 144,
      internalKeyMode: 'nums'
    });
    assert.notStrictEqual(toAddress(nums), built.address);
    assert.strictEqual(buildContractTaproot(nums).internalPubkeyHex, TAPROOT_INTERNAL_NUMS.toString('hex'));
  });

  it('buildFederationVaultFromPolicy forwards internalKeyMode nums', function () {
    const vals = [pk(0), pk(1), pk(2)];
    const musig = buildFederationVaultFromPolicy({
      validatorPubkeysHex: vals,
      threshold: 2,
      networkName: 'regtest',
      publisher: pk(0),
      csvBlocks: 144
    });
    const nums = buildFederationVaultFromPolicy({
      validatorPubkeysHex: vals,
      threshold: 2,
      networkName: 'regtest',
      publisher: pk(0),
      csvBlocks: 144,
      internalKeyMode: 'nums'
    });
    assert.notStrictEqual(musig.address, nums.address);
    assert.strictEqual(musig.spendPolicy.internalKeyMode, 'musig2');
    assert.strictEqual(nums.spendPolicy.internalKeyMode, 'nums');
    assert.strictEqual(nums.internalPubkeyHex, TAPROOT_INTERNAL_NUMS.toString('hex'));
    const viaLadder = toAddress(synthesizeDefaultLadder({
      validators: vals,
      threshold: 2,
      publisher: pk(0),
      network: 'regtest',
      csvBlocks: 144,
      internalKeyMode: 'nums'
    }));
    assert.strictEqual(nums.address, viaLadder);
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

  it('legacy Hub single-leaf vault address is stable (opt-in)', function () {
    const vals = [pk(0), pk(1), pk(2)];
    const a = buildFederationVaultFromPolicy({
      validatorPubkeysHex: vals,
      threshold: 2,
      networkName: 'regtest',
      legacySingleLeaf: true
    });
    const b = buildFederationVaultFromPolicy({
      validatorPubkeysHex: [pk(2), pk(0), pk(1)],
      threshold: 2,
      networkName: 'regtest',
      legacySingleLeaf: true
    });
    assert.strictEqual(a.address, b.address);
    assert.ok(a.multisigScript.length);
    assert.strictEqual(a.policy, null);
    assert.match(a.scheme, /legacy/);
  });

  it('default vault uses authority ladder (k-of-n + soft after 144 CSV)', function () {
    const vals = [pk(0), pk(1), pk(2)];
    const legacy = buildFederationVaultFromPolicy({
      validatorPubkeysHex: vals,
      threshold: 2,
      networkName: 'regtest',
      legacySingleLeaf: true
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
    assert.strictEqual(ladder.scheme, 'taproot-authority-ladder-v1');
    assert.ok(ladder.softTier);
    assert.strictEqual(ladder.csvBlocks, 144);
    const softActive = selectActiveTiers(ladder.policy, { utxoAgeBlocks: 144 });
    assert.ok(softActive.some((t) => t.id === 't1-soft' || t.id === 't1-publisher'));
  });

  it('default vault address matches synthesizeDefaultLadder', function () {
    const vals = [pk(0), pk(1), pk(2)];
    const vault = buildFederationVaultFromPolicy({
      validatorPubkeysHex: vals,
      threshold: 2,
      networkName: 'regtest',
      publisher: pk(0),
      csvBlocks: 144
    });
    const addr = toAddress(synthesizeDefaultLadder({
      validators: vals,
      threshold: 2,
      publisher: pk(0),
      network: 'regtest',
      csvBlocks: 144
    }));
    assert.strictEqual(vault.address, addr);
  });

  it('reduced softMode lowers threshold after CSV window', function () {
    const vals = [pk(0), pk(1), pk(2), pk(3)];
    const policy = synthesizeDefaultLadder({
      validators: vals,
      threshold: 3,
      publisher: pk(0),
      network: 'regtest',
      csvBlocks: 144,
      softMode: 'reduced',
      softThreshold: 2
    });
    const soft = policy.tiers.find((t) => t.id === 't1-soft');
    assert.ok(soft);
    assert.strictEqual(soft.threshold, 2);
    assert.strictEqual(soft.keys.length, 4);
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

  it('Contract synthesizes ladder from settings / proposedPolicy / overrides', function () {
    const expected = toAddress(synthesizeDefaultLadder({
      validators: [pk(0), pk(1), pk(2)],
      threshold: 2,
      publisher: pk(0),
      network: 'regtest',
      csvBlocks: 80
    }));

    // settings.validators + publisher + csvBlocks (hits _taprootPolicyInputs)
    const fromSettings = new Contract({
      validators: [pk(0), pk(1), pk(2)],
      threshold: 2,
      publisher: pk(0),
      network: 'regtest',
      csvBlocks: 80
    });
    assert.strictEqual(fromSettings.toAddress(), expected);
    assert.strictEqual(fromSettings.toAddress('regtest'), expected);

    // proposedPolicy takes precedence over bare settings.validators
    const fromProposed = new Contract({
      validators: [pk(4)],
      proposedPolicy: {
        validators: [pk(0), pk(1), pk(2)],
        threshold: 2
      },
      publisher: pk(0),
      network: 'regtest',
      csvBlocks: 80
    });
    assert.strictEqual(fromProposed.toAddress(), expected);

    // consensus.validators when proposedPolicy absent
    const fromConsensus = new Contract({
      consensus: { validators: [pk(0), pk(1), pk(2)] },
      threshold: 2,
      creator: pk(0),
      network: 'regtest',
      csvBlocks: 80
    });
    assert.strictEqual(fromConsensus.toAddress(), expected);

    // overrides win for validators / threshold / publisher / csvBlocks / network
    const bare = new Contract({ validators: [pk(5)], network: 'bitcoin' });
    const overridden = bare.toTaprootContract({
      validators: [pk(0), pk(1), pk(2)],
      threshold: 2,
      publisher: pk(0),
      network: 'regtest',
      csvBlocks: 80
    });
    assert.strictEqual(overridden.address, expected);

    // defaults: threshold 1, publisher = validators[0], DEFAULT_CSV_BLOCKS
    const defaults = new Contract({
      validators: [pk(0), pk(1)],
      network: 'regtest'
    });
    const inputs = defaults._taprootPolicyInputs();
    assert.strictEqual(inputs.threshold, 1);
    assert.strictEqual(inputs.publisher, pk(0));
    assert.ok(inputs.csvBlocks >= 1);
    assert.ok(defaults.toAddress().startsWith('bcrt1'));

    // spendLadder on settings, network from ladder when unset
    const ladderOnly = synthesizeDefaultLadder({
      validators: [pk(0), pk(1)],
      threshold: 1,
      publisher: pk(0),
      network: 'regtest',
      csvBlocks: 40
    });
    const withLadder = new Contract({ spendLadder: ladderOnly });
    assert.strictEqual(
      withLadder.toTaprootContract({}).address,
      toAddress(ladderOnly)
    );

    // Defensive: empty validators ok; Bitcoin network must be explicit (no silent regtest).
    const empty = new Contract({});
    assert.throws(
      () => empty._taprootPolicyInputs(),
      /network required/i
    );
    const emptyWithNet = empty._taprootPolicyInputs({ network: 'regtest' });
    assert.deepStrictEqual(emptyWithNet.validators, []);
    assert.strictEqual(emptyWithNet.publisher, null);
    assert.strictEqual(emptyWithNet.network, 'regtest');
    assert.strictEqual(emptyWithNet.threshold, 1);
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

  it('Federation._taprootPolicyInputs defaults, overrides, and empty reject', function () {
    const fed = new Federation({
      network: 'regtest',
      consensus: { validators: [pk(0), pk(1), pk(2)] }
    });
    const defaults = fed._taprootPolicyInputs();
    assert.strictEqual(defaults.threshold, 2); // ceil(3/2)
    assert.strictEqual(defaults.publisher, pk(0));
    assert.strictEqual(defaults.network, 'regtest');

    assert.throws(
      () => new Federation({
        consensus: { validators: [pk(0), pk(1), pk(2)] }
      })._taprootPolicyInputs(),
      /network required/i
    );

    const overridden = fed._taprootPolicyInputs({
      validators: [pk(0), pk(1)],
      threshold: 1,
      publisher: pk(1),
      csvBlocks: 10,
      network: 'regtest'
    });
    assert.strictEqual(overridden.threshold, 1);
    assert.strictEqual(overridden.publisher, pk(1));
    assert.strictEqual(overridden.csvBlocks, 10);

    const empty = new Federation({ consensus: { validators: [] } });
    assert.throws(
      () => empty._taprootPolicyInputs(),
      /at least one validator/
    );

    // content.validators null → [] fallback then reject
    const nulled = new Federation({
      consensus: { validators: [pk(0)] }
    });
    nulled._state.content.validators = null;
    assert.throws(
      () => nulled._taprootPolicyInputs(),
      /at least one validator/
    );

    // settings.csvBlocks when overrides omit it; settings.threshold path
    const withCsv = new Federation({
      network: 'regtest',
      threshold: 1,
      csvBlocks: 33,
      consensus: { validators: [pk(0), pk(1)] }
    });
    const fromSettings = withCsv._taprootPolicyInputs();
    assert.strictEqual(fromSettings.threshold, 1);
    assert.strictEqual(fromSettings.csvBlocks, 33);
  });

  it('timelockMature for csv and cltv', function () {
    assert.strictEqual(timelockMature(null, { utxoAgeBlocks: 0 }), true);
    assert.strictEqual(timelockMature({ type: 'csv', blocks: 10 }, { utxoAgeBlocks: 9 }), false);
    assert.strictEqual(timelockMature({ type: 'csv', blocks: 10 }, { utxoAgeBlocks: 10 }), true);
    assert.strictEqual(timelockMature({ type: 'cltv', height: 100 }, { tipHeight: 99 }), false);
    assert.strictEqual(timelockMature({ type: 'cltv', height: 100 }, { tipHeight: 100 }), true);
    assert.strictEqual(
      timelockMature({ type: 'cltv', unix: 500000000 }, { medianTime: 500000000 }),
      true
    );
    assert.strictEqual(
      timelockMature({ type: 'cltv', unix: 500000000 }, { medianTime: 499999999 }),
      false
    );
  });

  it('normalizeLock rejects CSV above 65535', function () {
    assert.ok(normalizeLock({ type: 'csv', blocks: 65535 }));
    assert.strictEqual(normalizeLock({ type: 'csv', blocks: 65536 }), null);
    assert.strictEqual(normalizeLock({ type: 'csv', blocks: 0 }), null);
  });

  it('normalizeLock enforces BIP65 CLTV height/unix threshold', function () {
    assert.ok(normalizeLock({ type: 'cltv', height: 499999999 }));
    assert.strictEqual(normalizeLock({ type: 'cltv', height: 500000000 }), null);
    assert.strictEqual(normalizeLock({ type: 'cltv', unix: 499999999 }), null);
    const unixOk = normalizeLock({ type: 'cltv', unix: 500000000 });
    assert.ok(unixOk);
    assert.strictEqual(unixOk.value, 500000000);
    assert.strictEqual(unixOk.unix, 500000000);
    const { CLTV_TIMESTAMP_THRESHOLD, MAX_LOCKTIME } = require('../functions/contractTaproot');
    assert.strictEqual(CLTV_TIMESTAMP_THRESHOLD, 500000000);
    assert.strictEqual(MAX_LOCKTIME, (2 ** 32) - 1);
    assert.strictEqual(unixOk.height, undefined);
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
    // synthesizeDefaultLadder must not silently clamp after pubkey dedupe.
    assert.throws(() => synthesizeDefaultLadder({
      network: 'regtest',
      publisher: pk(0),
      validators: [pk(0), pk(1), pk(0)],
      threshold: 3,
      csvBlocks: 144
    }), /exceeds unique key count/);
    assert.throws(() => synthesizeDefaultLadder({
      network: 'regtest',
      publisher: pk(0),
      validators: [pk(0), pk(1)],
      threshold: 2,
      softMode: 'reduced',
      softThreshold: 3,
      csvBlocks: 144
    }), /softThreshold.*exceeds unique key count/);
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

  it('prepareLeafPsbt encodes BIP68 block-based CSV in low 16 bits (no TYPE_FLAG)', function () {
    // BIP68: bit 22 (0x00400000) selects *seconds*; block-based CSV uses the raw
    // block count in bits 0–15 with bit 31 clear. Do not OR TYPE_FLAG for blocks.
    const policy = normalizeContractSpendPolicy({
      version: 1,
      network: 'regtest',
      keySets: {
        full: [pk(1)]
      },
      decay: { mode: 'none' },
      tiers: [{
        id: 'csv',
        threshold: 1,
        keys: 'full',
        after: { type: 'csv', blocks: 144 }
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
      ctx: { utxoAgeBlocks: 144 },
      tierId: 'csv'
    });
    assert.strictEqual(prep.sequence, 144);
    assert.strictEqual(prep.sequence & 0x00400000, 0);
    assert.strictEqual(prep.sequence >>> 31, 0);
  });
});

const crypto = require('crypto');

describe('contractTaproot composable trees + hashlock', function () {
  const keys = [];
  before(function () {
    for (let i = 0; i < 4; i++) keys.push(new Key());
  });
  function pk (i) { return keys[i].pubkey; }

  it('optional hashlock leaf changes address vs ladder-only', function () {
    const commitmentHex = crypto.createHash('sha256').update('run').digest('hex');
    const ladder = synthesizeDefaultLadder({
      validators: [pk(0), pk(1)],
      threshold: 1,
      publisher: pk(0),
      network: 'regtest',
      csvBlocks: 144
    });
    const withLock = synthesizeDefaultLadder({
      validators: [pk(0), pk(1)],
      threshold: 1,
      publisher: pk(0),
      network: 'regtest',
      csvBlocks: 144,
      hashlock: { commitmentHex, id: 'hashlock-run' }
    });
    const a = toAddress(ladder);
    const b = toAddress(withLock);
    assert.notStrictEqual(a, b);
    const built = buildContractTaproot(withLock);
    assert.ok(built.leaves.some((l) => l.kind === 'hashlock' && l.id === 'hashlock-run'));
    assert.strictEqual(built.leaves.find((l) => l.kind === 'hashlock').commitmentHex, commitmentHex);
  });

  it('composeTaprootTree builds arbitrary spend + script + hashlock trees', function () {
    const preimage = crypto.randomBytes(32);
    const commitmentHex = crypto.createHash('sha256').update(preimage).digest('hex');
    const spend = buildSpendLeaf({
      id: 'alice',
      keys: [pk(0)],
      threshold: 1
    });
    const hashlock = buildHashlockLeaf({ commitmentHex, id: 'hl' });
    const custom = buildScriptLeaf({
      id: 'true',
      asm: 'OP_TRUE'
    });
    const tree = composeTaprootTree({
      network: 'regtest',
      leaves: [spend, hashlock, custom]
    });
    assert.ok(tree.address.startsWith('bcrt1'));
    assert.strictEqual(tree.leaves.length, 3);
    assert.ok(tree.merkleRootHex);
    assert.strictEqual(tree.scheme, 'taproot-composed-v1');
  });

  it('pure hashlock path: prepare + finalize with preimage only', function () {
    const preimage = crypto.randomBytes(32);
    const commitmentHex = crypto.createHash('sha256').update(preimage).digest('hex');
    const policy = synthesizeDefaultLadder({
      validators: [pk(0)],
      threshold: 1,
      publisher: pk(0),
      network: 'regtest',
      hashlock: { commitmentHex }
    });
    const built = buildContractTaproot(policy);
    const value = 100000n;
    const fund = new bitcoin.Transaction();
    fund.version = 2;
    fund.addInput(Buffer.alloc(32), 0);
    fund.addOutput(built.output, value);

    const prepared = prepareHashlockWithdrawalPsbt({
      policy,
      fundedTxHex: fund.toHex(),
      vaultAddress: built.address,
      destinationAddress: bitcoin.payments.p2wpkh({
        pubkey: Buffer.from(pk(1), 'hex'),
        network: bitcoin.networks.regtest
      }).address,
      feeSats: 1000,
      preimage32: preimage
    });
    assert.ok(prepared.psbtBase64);
    assert.strictEqual(prepared.action, 'hashlock');
    assert.strictEqual(prepared.witnessShape, 'preimage');

    const fin = finalizeHashlockPsbt({
      psbtBase64: prepared.psbtBase64,
      preimage32: preimage,
      witnessShape: 'preimage'
    });
    assert.ok(fin.txHex);
    assert.ok(fin.txid);
    const spent = bitcoin.Transaction.fromHex(fin.txHex);
    assert.strictEqual(spent.ins[0].witness.length, 3);
  });

  it('compileLeaves appends extraLeaves after authority tiers', function () {
    const policy = synthesizeDefaultLadder({
      validators: [pk(0), pk(1)],
      threshold: 2,
      publisher: pk(0),
      network: 'regtest',
      extraLeaves: [
        { kind: 'script', id: 'op-true', asm: 'OP_TRUE' }
      ]
    });
    const leaves = compileLeaves(policy);
    assert.ok(leaves.some((l) => l.kind === 'spend' && l.id === 't0-authority'));
    assert.ok(leaves.some((l) => l.kind === 'script' && l.id === 'op-true'));
  });
});

const Message = require('../types/message');
const {
  normalizeArcGenesis,
  resolveSpend,
  buildWithdrawalRequest,
  buildWithdrawalWitness,
  validateWithdrawalRequest,
  prepareWithdrawalFromRequest,
  verifyWithdrawalWitnessSignature
} = require('../functions/contractSpend');
const { pubkeyXOnly } = require('../functions/groupChatSeal');
const {
  createMemoryStore,
  ingestMessageBuffer,
  tipFromDoc,
  loadDoc
} = require('../functions/contractMessageAccumulate');

describe('contractSpend / ARC resolveSpend', function () {
  it('normalizeArcGenesis maps proposedPolicy + messageTypes', function () {
    const a = new Key();
    const arc = normalizeArcGenesis({
      name: 'DemoGroup',
      messageTypes: ['GroupChat', 'GroupChange'],
      proposedPolicy: { validators: [a.pubkey], threshold: 1 },
      creator: a.pubkey,
      parentContractId: 'parent'.padEnd(64, '0'),
      softMode: 'reduced',
      depositMaturityBlocks: 144
    });
    assert.strictEqual(arc.name, 'DemoGroup');
    assert.deepStrictEqual(arc.primitives.messageTypes, ['GroupChat', 'GroupChange']);
    assert.strictEqual(arc.members.signers.length, 1);
    assert.strictEqual(arc.spendPolicy.validators.length, 1);
    assert.strictEqual(arc.spendPolicy.threshold, 1);
    assert.strictEqual(arc.spendPolicy.softMode, 'reduced');
    assert.strictEqual(arc.spendPolicy.csvBlocks, 144);
    assert.ok(!Object.prototype.hasOwnProperty.call(arc.spendPolicy, 'depositMaturityBlocks'));
    assert.strictEqual(arc.extension.parentContract, 'parent'.padEnd(64, '0'));
    assert.strictEqual(arc.extension.parentContractId, arc.extension.parentContract);
  });

  it('resolveSpend prefers tip.content.signers over members roster', function () {
    const a = new Key();
    const b = new Key();
    const {
      tipSpendKeys
    } = require('../functions/contractSpend');
    const tip = {
      content: {
        signers: [a.pubkey],
        members: [a.pubkey.slice(2), b.pubkey.slice(2)],
        threshold: 1
      }
    };
    assert.deepStrictEqual(tipSpendKeys(tip), [a.pubkey]);
    const spend = resolveSpend({
      genesis: {
        members: { signers: [a.pubkey], threshold: 1 },
        spendPolicy: {
          validators: [a.pubkey],
          threshold: 1,
          publisher: a.pubkey,
          csvBlocks: 144,
          softMode: 'publisher'
        }
      },
      tip,
      overrides: { network: 'regtest' }
    });
    assert.strictEqual(spend.validators.length, 1);
    assert.ok(spend.bitcoinAnchor === null || spend.bitcoinAnchor);
    assert.strictEqual(spend.softMode, 'publisher');
    assert.strictEqual(spend.spendAddress, spend.address);
    assert.strictEqual(spend.depositMaturityBlocks, spend.csvBlocks);
    assert.ok(spend.spendPolicy);
    assert.strictEqual(spend.spendPolicy.softMode, 'publisher');
  });

  it('explicit empty tip.content.signers does not widen spend keys to members', function () {
    const a = new Key();
    const reader = new Key();
    const {
      tipSpendKeys
    } = require('../functions/contractSpend');
    const tip = {
      content: {
        signers: [],
        members: [a.pubkey.slice(2), reader.pubkey.slice(2)],
        threshold: 1
      }
    };
    assert.deepStrictEqual(tipSpendKeys(tip), []);
    const spend = resolveSpend({
      genesis: {
        members: { signers: [a.pubkey], threshold: 1 },
        spendPolicy: {
          validators: [a.pubkey],
          threshold: 1,
          publisher: a.pubkey,
          csvBlocks: 144,
          softMode: 'publisher'
        }
      },
      tip,
      overrides: { network: 'regtest' }
    });
    assert.strictEqual(spend.validators.length, 1);
    assert.strictEqual(spend.validators[0], require('../functions/groupChatSeal').pubkeyCompressed(a.pubkey) || a.pubkey);
  });

  it('resolveSpend is stable for tip members', function () {
    const a = new Key();
    const b = new Key();
    const genesis = {
      spendPolicy: { network: 'regtest', validators: [a.pubkey], threshold: 1, csvBlocks: 144 },
      members: { signers: [a.pubkey], threshold: 1 },
      bitcoinAnchor: { blockHash: 'ab'.repeat(32), height: 10 }
    };
    const tip = {
      contractId: 'c'.repeat(64),
      clock: 2,
      stateDigest: 'cd'.repeat(32),
      bitcoinBlockHash: 'ab'.repeat(32),
      bitcoinHeight: 10,
      content: { members: [a.pubkey.slice(2), b.pubkey.slice(2)], threshold: 2 }
    };
    const spend = resolveSpend({ genesis, tip });
    assert.ok(spend.address);
    assert.match(spend.address, /^bcrt1p/);
    assert.strictEqual(spend.threshold, 2);
    assert.strictEqual(spend.validators.length, 2);
    assert.strictEqual(spend.bitcoinBlockHash, 'ab'.repeat(32));

    const again = resolveSpend({ genesis, tip });
    assert.strictEqual(again.address, spend.address);
  });

  it('resolveSpend address matches federation vault ladder', function () {
    const a = new Key();
    const b = new Key();
    const vals = [a.pubkey, b.pubkey];
    const vault = buildFederationVaultFromPolicy({
      validatorPubkeysHex: vals,
      threshold: 2,
      networkName: 'regtest',
      publisher: a.pubkey,
      csvBlocks: 144
    });
    const spend = resolveSpend({
      genesis: {
        members: { signers: vals, threshold: 2 },
        spendPolicy: {
          validators: vals,
          threshold: 2,
          publisher: a.pubkey,
          csvBlocks: 144,
          network: 'regtest'
        }
      },
      tip: { content: { members: vals.map((p) => p.slice(2)) } },
      overrides: { network: 'regtest' }
    });
    assert.strictEqual(spend.address, vault.address);
    assert.strictEqual(spend.scheme, 'taproot-authority-ladder-v1');
    assert.strictEqual(spend.csvBlocks, 144);
    assert.ok(spend.softTier);
  });

  it('resolveSpend fails closed without explicit network', function () {
    const a = new Key();
    const genesis = {
      members: { signers: [a.pubkey], threshold: 1 },
      spendPolicy: { validators: [a.pubkey], threshold: 1 }
    };
    assert.throws(() => resolveSpend({
      genesis,
      tip: { content: { members: [a.pubkey.slice(2)] } }
    }), /network required/i);
    const spend = resolveSpend({
      genesis,
      tip: { content: { members: [a.pubkey.slice(2)] } },
      overrides: { network: 'signet' }
    });
    assert.match(spend.address, /^tb1p/);
  });

  it('normalizeArcGenesis does not default spendPolicy.network to regtest', function () {
    const a = new Key();
    const arc = normalizeArcGenesis({
      proposedPolicy: { validators: [a.pubkey], threshold: 1 }
    });
    assert.strictEqual(arc.spendPolicy.network, undefined);
  });

  it('Contract#resolveSpend uses settings as genesis', function () {
    const k = new Key();
    const c = new Contract({
      validators: [k.pubkey],
      threshold: 1,
      network: 'regtest',
      csvBlocks: 144,
      bitcoinAnchor: { blockHash: '11'.repeat(32), height: 1 }
    });
    const spend = c.resolveSpend({
      tip: {
        content: { members: [k.pubkey.slice(2)] },
        stateDigest: '22'.repeat(32),
        bitcoinBlockHash: '11'.repeat(32)
      },
      overrides: { network: 'regtest' }
    });
    assert.ok(spend.address);
    assert.strictEqual(spend.address, c.toAddress('regtest'));
  });

  it('withdrawal request binds tip digest + block hash', function () {
    const k = new Key();
    const tip = {
      contractId: 'c'.repeat(64),
      clock: 1,
      stateDigest: 'aa'.repeat(32),
      bitcoinBlockHash: 'bb'.repeat(32),
      bitcoinHeight: 42,
      content: { members: [] }
    };
    const req = buildWithdrawalRequest({
      tip,
      destinationAddress: 'bcrt1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
      feeSats: 500
    });
    assert.strictEqual(req.type, 'ContractWithdrawalRequest');
    assert.ok(req.requestId);
    assert.strictEqual(req.stateDigest, tip.stateDigest);
    assert.strictEqual(req.bitcoinBlockHash, tip.bitcoinBlockHash);
    assert.strictEqual(validateWithdrawalRequest(req, tip).ok, true);
    assert.strictEqual(validateWithdrawalRequest(req, Object.assign({}, tip, {
      stateDigest: 'cc'.repeat(32)
    })).ok, false);

    const diverted = Object.assign({}, req, {
      destinationAddress: 'bcrt1q00000000000000000000000000000000000000',
      // Keep original requestId — must fail commitment bind.
      requestId: req.requestId
    });
    const divertedCheck = validateWithdrawalRequest(diverted, tip);
    assert.strictEqual(divertedCheck.ok, false);
    assert.match(String(divertedCheck.error || ''), /requestId does not match/);

    const missingId = Object.assign({}, req);
    delete missingId.requestId;
    assert.strictEqual(validateWithdrawalRequest(missingId, tip).ok, false);

    const wit = buildWithdrawalWitness({
      request: req,
      signer: pubkeyXOnly(k.pubkey),
      signerKey: k
    });
    assert.strictEqual(wit.requestId, req.requestId);
    assert.strictEqual(wit.bitcoinBlockHash, tip.bitcoinBlockHash);
    assert.ok(/^[0-9a-f]{128}$/.test(wit.signature));
    assert.strictEqual(verifyWithdrawalWitnessSignature(wit).ok, true);
  });

  it('ingest rejects withdrawal with stale tip binding', function () {
    const owner = new Key();
    const store = createMemoryStore();
    const contractId = 'e'.repeat(64);
    const blockHash = 'ff'.repeat(32);
    const genesis = {
      signers: [owner.pubkey],
      bitcoinAnchor: { blockHash, height: 7 },
      primitives: {
        messageTypes: ['GroupChange', 'ContractWithdrawalRequest', 'GroupChat']
      }
    };
    const setMembers = Message.fromVector(['CONTRACT_MESSAGE', JSON.stringify({
      contract: contractId,
      type: 'GroupChange',
      object: { action: 'members.set', members: [owner.pubkey] }
    })]).signWithKey(owner);
    const okSet = ingestMessageBuffer(store, contractId, setMembers.toBuffer(), {
      origin: 'local',
      genesis,
      bitcoinBlockHash: blockHash,
      bitcoinHeight: 7
    });
    assert.strictEqual(okSet.accepted, true);

    const tip = tipFromDoc(loadDoc(store, contractId));
    const stale = buildWithdrawalRequest({
      tip: Object.assign({}, tip, { stateDigest: '00'.repeat(32) }),
      destinationAddress: 'bcrt1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
      feeSats: 250
    });
    // Force stale digest onto a signed message
    const bad = Message.fromVector(['CONTRACT_MESSAGE', JSON.stringify({
      contract: contractId,
      type: 'ContractWithdrawalRequest',
      object: stale
    })]).signWithKey(owner);
    const rejected = ingestMessageBuffer(store, contractId, bad.toBuffer(), {
      origin: 'mesh',
      genesis,
      bitcoinBlockHash: blockHash
    });
    assert.strictEqual(rejected.accepted, false);
    assert.match(rejected.error, /stateDigest|stale/i);

    const goodReq = buildWithdrawalRequest({
      tip,
      destinationAddress: 'bcrt1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
      feeSats: 250
    });
    const good = Message.fromVector(['CONTRACT_MESSAGE', JSON.stringify({
      contract: contractId,
      type: 'ContractWithdrawalRequest',
      object: goodReq
    })]).signWithKey(owner);
    const accepted = ingestMessageBuffer(store, contractId, good.toBuffer(), {
      origin: 'mesh',
      genesis,
      bitcoinBlockHash: blockHash
    });
    assert.strictEqual(accepted.accepted, true);
    assert.ok(accepted.tip.content.withdrawals.some((w) => w.requestId === goodReq.requestId));
  });

  it('prepareWithdrawalFromRequest refuses tip mismatch', function () {
    const a = new Key();
    const genesis = {
      spendPolicy: { network: 'regtest', validators: [a.pubkey], threshold: 1, csvBlocks: 144 },
      members: { signers: [a.pubkey], threshold: 1 }
    };
    const tip = {
      contractId: 'd'.repeat(64),
      stateDigest: '11'.repeat(32),
      bitcoinBlockHash: '22'.repeat(32),
      content: { members: [a.pubkey.slice(2)] }
    };
    const req = buildWithdrawalRequest({
      tip,
      destinationAddress: 'bcrt1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
      feeSats: 100
    });
    assert.throws(() => prepareWithdrawalFromRequest({
      request: req,
      tip: Object.assign({}, tip, { bitcoinBlockHash: '33'.repeat(32) }),
      genesis,
      fundedTxHex: '02000000000100'
    }), /bitcoinBlockHash|match/i);
  });

  it('ingest rejects forged ContractWithdrawalWitness (unbound signer / bad sig)', function () {
    const owner = new Key();
    const coSigner = new Key();
    const store = createMemoryStore();
    const contractId = 'f'.repeat(64);
    const blockHash = 'aa'.repeat(32);
    const genesis = {
      signers: [owner.pubkey, coSigner.pubkey],
      bitcoinAnchor: { blockHash, height: 3 },
      primitives: {
        messageTypes: [
          'GroupChange',
          'ContractWithdrawalRequest',
          'ContractWithdrawalWitness'
        ]
      }
    };
    assert.strictEqual(ingestMessageBuffer(store, contractId, Message.fromVector(['CONTRACT_MESSAGE', JSON.stringify({
      contract: contractId,
      type: 'GroupChange',
      object: { action: 'members.set', members: [owner.pubkey, coSigner.pubkey] }
    })]).signWithKey(owner).toBuffer(), {
      origin: 'local',
      genesis,
      bitcoinBlockHash: blockHash,
      bitcoinHeight: 3
    }).accepted, true);

    const tip = tipFromDoc(loadDoc(store, contractId));
    const req = buildWithdrawalRequest({
      tip,
      destinationAddress: 'bcrt1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
      feeSats: 100
    });
    assert.strictEqual(ingestMessageBuffer(store, contractId, Message.fromVector(['CONTRACT_MESSAGE', JSON.stringify({
      contract: contractId,
      type: 'ContractWithdrawalRequest',
      object: req
    })]).signWithKey(owner).toBuffer(), {
      origin: 'mesh',
      genesis,
      bitcoinBlockHash: blockHash
    }).accepted, true);

    // Malicious co-signer claims honest owner's key with garbage signature.
    const forged = buildWithdrawalWitness({
      request: req,
      signer: pubkeyXOnly(owner.pubkey),
      signature: 'ab'.repeat(64)
    });
    const bad = ingestMessageBuffer(store, contractId, Message.fromVector(['CONTRACT_MESSAGE', JSON.stringify({
      contract: contractId,
      type: 'ContractWithdrawalWitness',
      object: forged
    })]).signWithKey(coSigner).toBuffer(), {
      origin: 'mesh',
      genesis,
      bitcoinBlockHash: blockHash
    });
    assert.strictEqual(bad.accepted, false);
    assert.match(bad.error, /signer must match|invalid witness/i);

    const honest = buildWithdrawalWitness({
      request: req,
      signer: pubkeyXOnly(coSigner.pubkey),
      signerKey: coSigner
    });
    const ok = ingestMessageBuffer(store, contractId, Message.fromVector(['CONTRACT_MESSAGE', JSON.stringify({
      contract: contractId,
      type: 'ContractWithdrawalWitness',
      object: honest
    })]).signWithKey(coSigner).toBuffer(), {
      origin: 'mesh',
      genesis,
      bitcoinBlockHash: blockHash
    });
    assert.strictEqual(ok.accepted, true, ok.error);
    const row = ok.tip.content.withdrawals.find((w) => w.requestId === req.requestId);
    assert.ok(row);
    assert.strictEqual(row.witnesses.length, 1);
    assert.strictEqual(row.witnesses[0].signer, pubkeyXOnly(coSigner.pubkey));
  });
});
