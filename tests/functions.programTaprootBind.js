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
  });
});
