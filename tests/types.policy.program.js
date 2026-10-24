'use strict';

const assert = require('assert');
const Key = require('../types/key');
const Policy = require('../types/policy');
const {
  hashlockFromProgramRun
} = Policy;

describe('Policy program-run hashlock', function () {
  it('hashlockFromProgramRun requires 64-hex commitment', function () {
    assert.throws(() => hashlockFromProgramRun({}), /runCommitmentHex/);
    const h = hashlockFromProgramRun({
      programHash: 'aa'.repeat(32),
      runCommitmentHex: 'bb'.repeat(32)
    });
    assert.strictEqual(h.commitmentHex, 'bb'.repeat(32));
    assert.strictEqual(h.id, 'hashlock-run');
  });

  it('withRunHashlock changes address vs ladder-only', function () {
    const a = new Key();
    const b = new Key();
    const ladder = {
      validators: [a.pubkey, b.pubkey],
      threshold: 2,
      publisher: a.pubkey,
      network: 'regtest',
      csvBlocks: 144
    };
    const withRun = Policy.withRunHashlock({
      ladder,
      network: 'regtest',
      run: {
        programHash: '11'.repeat(32),
        runCommitmentHex: '22'.repeat(32),
        pubkeyHex: a.pubkey
      }
    });
    assert.ok(withRun.address && withRun.address.startsWith('bcrt1'));
    assert.ok(withRun.leaves.some((l) => l.kind === 'hashlock'));
    assert.ok(withRun.programRunId);
    assert.strictEqual(withRun.hashlock.commitmentHex, '22'.repeat(32));
    assert.strictEqual(withRun.hashlock.runCommitmentHex, '22'.repeat(32));

    const policy = new Policy(ladder);
    const fromInstance = policy.withRunHashlock({
      programHash: '11'.repeat(32),
      runCommitmentHex: '22'.repeat(32),
      pubkeyHex: a.pubkey
    });
    assert.strictEqual(fromInstance.address, withRun.address);
    assert.notStrictEqual(fromInstance.address, policy.address);
    assert.throws(() => policy.withRunHashlock({ runCommitmentHex: '22'.repeat(32) }), /Policy\.withRunHashlock: run\.pubkeyHex required/);
  });

  it('programRunId uses runCommitmentHex not leaf commitment override', function () {
    const a = new Key();
    const withRun = Policy.withRunHashlock({
      ladder: {
        validators: [a.pubkey],
        threshold: 1,
        publisher: a.pubkey,
        network: 'regtest',
        csvBlocks: 144
      },
      run: {
        programHash: '11'.repeat(32),
        runCommitmentHex: '22'.repeat(32),
        commitmentHex: '33'.repeat(32),
        pubkeyHex: a.pubkey
      }
    });
    const { programRunId } = require('../functions/contractProgramBind');
    assert.strictEqual(
      withRun.programRunId,
      programRunId('11'.repeat(32), '22'.repeat(32))
    );
    assert.notStrictEqual(
      withRun.programRunId,
      programRunId('11'.repeat(32), '33'.repeat(32))
    );
  });

  it('rejects policy.hashlock and conflicting network', function () {
    const a = new Key();
    const policy = {
      network: 'regtest',
      internalKeyMode: 'nums',
      leaves: [],
      hashlock: { commitmentHex: 'aa'.repeat(32), id: 'pre' }
    };
    assert.throws(() => Policy.withRunHashlock({
      policy,
      run: { runCommitmentHex: 'bb'.repeat(32), pubkeyHex: a.pubkey }
    }), /policy\.hashlock/);

    const clean = {
      network: 'regtest',
      validators: [a.pubkey],
      threshold: 1,
      publisher: a.pubkey,
      csvBlocks: 144
    };
    const ladderPolicy = require('../types/policy').synthesizeDefaultLadder(clean);
    assert.throws(() => Policy.withRunHashlock({
      policy: ladderPolicy,
      network: 'testnet',
      run: { runCommitmentHex: 'bb'.repeat(32), pubkeyHex: a.pubkey }
    }), /conflicts with policy\.network/);
  });

  it('requires a signer key unless allowPreimageOnly is set', function () {
    const a = new Key();
    const ladder = {
      validators: [a.pubkey],
      threshold: 1,
      publisher: a.pubkey,
      network: 'regtest',
      csvBlocks: 144
    };
    assert.throws(() => Policy.withRunHashlock({
      ladder,
      run: { runCommitmentHex: 'bb'.repeat(32) }
    }), /run\.pubkeyHex required/);

    const signed = Policy.withRunHashlock({
      ladder,
      run: { runCommitmentHex: 'bb'.repeat(32), pubkeyHex: a.pubkey }
    });
    const signedLeaf = signed.leaves.find((l) => l.kind === 'hashlock');
    assert.strictEqual(signedLeaf.witnessShape, 'preimage+sig');

    const open = Policy.withRunHashlock({
      ladder,
      allowPreimageOnly: true,
      run: { runCommitmentHex: 'bb'.repeat(32) }
    });
    const openLeaf = open.leaves.find((l) => l.kind === 'hashlock');
    assert.strictEqual(openLeaf.witnessShape, 'preimage');
    assert.notStrictEqual(open.address, signed.address);
  });

  it('honors policy.networkName when policy.network is omitted', function () {
    const a = new Key();
    const policy = {
      validators: [a.pubkey],
      threshold: 1,
      publisher: a.pubkey,
      networkName: 'testnet',
      csvBlocks: 144
    };
    const withRun = Policy.withRunHashlock({
      policy,
      run: { runCommitmentHex: 'bb'.repeat(32), pubkeyHex: a.pubkey }
    });
    assert.ok(withRun.address.startsWith('tb1'));
    assert.strictEqual(withRun.network, 'testnet');

    assert.throws(() => Policy.withRunHashlock({
      policy,
      network: 'regtest',
      run: { runCommitmentHex: 'bb'.repeat(32), pubkeyHex: a.pubkey }
    }), /conflicts with policy\.network/);
  });
});
