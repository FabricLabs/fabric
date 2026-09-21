'use strict';

const assert = require('assert');
const Key = require('../types/key');
const {
  hashlockFromProgramRun,
  composePolicyWithRunHashlock
} = require('../functions/programTaprootBind');

describe('programTaprootBind', function () {
  it('hashlockFromProgramRun requires 64-hex commitment', function () {
    assert.throws(() => hashlockFromProgramRun({}), /runCommitmentHex/);
    const h = hashlockFromProgramRun({
      programHash: 'aa'.repeat(32),
      runCommitmentHex: 'bb'.repeat(32)
    });
    assert.strictEqual(h.commitmentHex, 'bb'.repeat(32));
    assert.strictEqual(h.id, 'hashlock-run');
  });

  it('composePolicyWithRunHashlock changes address vs ladder-only', function () {
    const a = new Key();
    const b = new Key();
    const ladder = {
      validators: [a.pubkey, b.pubkey],
      threshold: 2,
      publisher: a.pubkey,
      network: 'regtest',
      csvBlocks: 144
    };
    const withRun = composePolicyWithRunHashlock({
      ladder,
      network: 'regtest',
      run: {
        programHash: '11'.repeat(32),
        runCommitmentHex: '22'.repeat(32)
      }
    });
    assert.ok(withRun.address && withRun.address.startsWith('bcrt1'));
    assert.ok(withRun.leaves.some((l) => l.kind === 'hashlock'));
    assert.ok(withRun.programRunId);
    assert.strictEqual(withRun.hashlock.commitmentHex, '22'.repeat(32));
    assert.strictEqual(withRun.hashlock.runCommitmentHex, '22'.repeat(32));
  });

  it('programRunId uses runCommitmentHex not leaf commitment override', function () {
    const a = new Key();
    const withRun = composePolicyWithRunHashlock({
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
        commitmentHex: '33'.repeat(32)
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
    assert.throws(() => composePolicyWithRunHashlock({
      policy,
      run: { runCommitmentHex: 'bb'.repeat(32) }
    }), /policy\.hashlock/);

    const clean = {
      network: 'regtest',
      validators: [a.pubkey],
      threshold: 1,
      publisher: a.pubkey,
      csvBlocks: 144
    };
    const ladderPolicy = require('../functions/contractTaproot').synthesizeDefaultLadder(clean);
    assert.throws(() => composePolicyWithRunHashlock({
      policy: ladderPolicy,
      network: 'testnet',
      run: { runCommitmentHex: 'bb'.repeat(32) }
    }), /conflicts with policy\.network/);
  });
});
