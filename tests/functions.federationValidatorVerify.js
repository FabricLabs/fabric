'use strict';

const assert = require('assert');
const {
  verifyLocalEpochDigests,
  verifyReserveConservation,
  evaluateValidatorSignGate
} = require('../functions/federationValidatorVerify');
const {
  applyPegInCredit,
  RESERVE_KEY
} = require('../functions/federationReserveLedger');

describe('federationValidatorVerify', function () {
  it('fail-closed when digests missing with validators', function () {
    const soft = verifyLocalEpochDigests(
      { sidechain: { stateDigest: 'aa'.repeat(32) } },
      { stateDigest: null },
      null,
      { failClosed: false }
    );
    assert.strictEqual(soft.ok, true);

    const hard = verifyLocalEpochDigests(
      { sidechain: { stateDigest: 'aa'.repeat(32) } },
      { stateDigest: null },
      null,
      { failClosed: true }
    );
    assert.strictEqual(hard.ok, false);
    assert.match(hard.error, /missing/);
  });

  it('detects digest mismatch', function () {
    const r = verifyLocalEpochDigests(
      { sidechain: { stateDigest: 'aa'.repeat(32) } },
      { stateDigest: 'bb'.repeat(32) },
      null,
      { failClosed: true }
    );
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /mismatch/);
  });

  it('passes matching digests and reserve conservation', function () {
    const dig = 'cc'.repeat(32);
    const credited = applyPegInCredit({}, {
      txid: '11'.repeat(32),
      vout: 0,
      amountSats: 50000,
      confirmations: 200
    }, { vaultConfirmedSats: 50000 });
    assert.ok(credited.ok);

    const gate = evaluateValidatorSignGate({
      epoch: {
        sidechain: { stateDigest: dig },
        contracts: { stateDigest: dig }
      },
      localSidechain: { stateDigest: dig },
      localContracts: { stateDigest: dig },
      sidechainContent: credited.content,
      failClosed: true
    });
    assert.strictEqual(gate.ok, true);
    assert.ok(gate.checks.includes('epoch-digests'));
    assert.ok(gate.checks.includes('reserve-conservation'));
  });

  it('refuses broken reserve before sign', function () {
    const broken = {
      [RESERVE_KEY]: {
        outstandingSats: 100000,
        pendingBurnsSats: 0,
        vaultConfirmedSats: 1,
        creditedSats: 100000,
        burnedSats: 0,
        deposits: [],
        withdrawals: []
      }
    };
    const r = verifyReserveConservation(broken);
    assert.strictEqual(r.ok, false);

    const gate = evaluateValidatorSignGate({
      sidechainContent: broken,
      failClosed: true
    });
    assert.strictEqual(gate.ok, false);
  });

  it('fail-closed rejects empty epoch / no completed checks', function () {
    const empty = verifyLocalEpochDigests({}, null, null, { failClosed: true });
    assert.strictEqual(empty.ok, false);
    assert.match(empty.error, /no validator checks completed/);

    const gate = evaluateValidatorSignGate({ failClosed: true });
    assert.strictEqual(gate.ok, false);
    assert.match(gate.error, /no validator checks completed/);
  });

  it('fail-closed accepts contracts-only when digests match', function () {
    const dig = 'dd'.repeat(32);
    const r = verifyLocalEpochDigests(
      { contracts: { stateDigest: dig } },
      null,
      { stateDigest: dig },
      { failClosed: true }
    );
    assert.strictEqual(r.ok, true);
  });

  it('rejects negative outstandingSats before readReserve normalization', function () {
    const forged = {
      [RESERVE_KEY]: {
        outstandingSats: -1,
        pendingBurnsSats: 0,
        vaultConfirmedSats: 0,
        creditedSats: 0,
        burnedSats: 0,
        deposits: [],
        withdrawals: []
      }
    };
    const r = verifyReserveConservation(forged);
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /outstandingSats/);
  });
});
