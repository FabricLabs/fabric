'use strict';

const assert = require('assert');
const {
  emptyReserve,
  readReserve,
  assertConservation,
  applyPegInCredit,
  applyPegOutBurn,
  settlePegOutPayout,
  patchesForReserve,
  validateLedgerPatch,
  defaultFederationSidechainPolicy,
  RESERVE_KEY
} = require('../functions/federationReserveLedger');
const {
  parseStatechainPathPolicy,
  validatePatchesAgainstPolicy
} = require('../functions/sidechainState');

describe('federationReserveLedger', function () {
  it('starts empty and conserves', function () {
    const r = emptyReserve();
    assert.strictEqual(assertConservation(r).ok, true);
    assert.strictEqual(readReserve({}).outstandingSats, 0);
  });

  it('credits matured peg-in and rejects immature / duplicate / forged vault', function () {
    const forged = applyPegInCredit({}, {
      txid: 'ab'.repeat(32),
      vout: 0,
      amountSats: 100000,
      confirmations: 144
    });
    assert.strictEqual(forged.ok, false);
    assert.match(String(forged.error), /vaultConfirmedSats required/);

    const a = applyPegInCredit({}, {
      txid: 'ab'.repeat(32),
      vout: 0,
      amountSats: 100000,
      confirmations: 144
    }, { vaultConfirmedSats: 100000 });
    assert.strictEqual(a.ok, true);
    assert.strictEqual(a.reserve.outstandingSats, 100000);
    assert.strictEqual(a.reserve.creditedSats, 100000);
    assert.strictEqual(a.reserve.vaultConfirmedSats, 100000);

    const immature = applyPegInCredit({}, {
      txid: 'cd'.repeat(32),
      vout: 0,
      amountSats: 50000,
      confirmations: 10
    }, { vaultConfirmedSats: 50000 });
    assert.strictEqual(immature.ok, false);

    const dup = applyPegInCredit(a.content, {
      txid: 'ab'.repeat(32),
      vout: 0,
      amountSats: 100000,
      confirmations: 200
    }, { vaultConfirmedSats: 100000 });
    assert.strictEqual(dup.ok, false);
  });

  it('burns peg-out into pendingBurns then settles after L1 payout', function () {
    const credited = applyPegInCredit({}, {
      txid: '11'.repeat(32),
      vout: 1,
      amountSats: 50000,
      confirmations: 200
    }, { vaultConfirmedSats: 50000 });
    assert.ok(credited.ok);

    const burn = applyPegOutBurn(credited.content, {
      requestId: '22'.repeat(32),
      amountSats: 20000,
      destinationAddress: 'bcrt1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh'
    });
    assert.strictEqual(burn.ok, true);
    assert.strictEqual(burn.reserve.outstandingSats, 30000);
    assert.strictEqual(burn.reserve.pendingBurnsSats, 20000);
    assert.strictEqual(burn.reserve.burnedSats, 20000);
    assert.strictEqual(burn.reserve.withdrawals[0].status, 'pending');

    const over = applyPegOutBurn(burn.content, {
      requestId: '33'.repeat(32),
      amountSats: 40000,
      destinationAddress: 'bcrt1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh'
    });
    assert.strictEqual(over.ok, false);

    const again = applyPegOutBurn(burn.content, {
      requestId: '22'.repeat(32),
      amountSats: 20000,
      destinationAddress: 'bcrt1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh'
    });
    assert.strictEqual(again.ok, false);

    const settled = settlePegOutPayout(burn.content, '22'.repeat(32), {
      payout: {
        txid: '77'.repeat(32),
        vout: 0,
        amountSats: 20000,
        destinationAddress: 'bcrt1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
        confirmations: 1
      }
    });
    assert.strictEqual(settled.ok, true, settled.error);
    assert.strictEqual(settled.reserve.pendingBurnsSats, 0);
    assert.strictEqual(settled.reserve.vaultConfirmedSats, 30000);
    assert.strictEqual(settled.reserve.withdrawals[0].status, 'settled');
    assert.deepStrictEqual(settled.reserve.withdrawals[0].payout, {
      txid: '77'.repeat(32),
      vout: 0,
      confirmations: 1
    });
  });

  it('settlePegOutPayout requires a payout output matching the withdrawal', function () {
    const dest = 'bcrt1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';
    const credited = applyPegInCredit({}, {
      txid: '88'.repeat(32),
      vout: 0,
      amountSats: 60000,
      confirmations: 200
    }, { vaultConfirmedSats: 60000 });
    assert.ok(credited.ok);
    const first = applyPegOutBurn(credited.content, {
      requestId: '99'.repeat(32),
      amountSats: 20000,
      destinationAddress: dest
    });
    assert.ok(first.ok);
    const burns = applyPegOutBurn(first.content, {
      requestId: 'aa'.repeat(32),
      amountSats: 20000,
      destinationAddress: dest
    });
    assert.ok(burns.ok);

    const payout = {
      txid: 'bb'.repeat(32),
      vout: 1,
      amountSats: 20000,
      destinationAddress: dest,
      confirmations: 3
    };
    const settle = (requestId, overrides, extra = {}) => settlePegOutPayout(
      burns.content,
      requestId,
      Object.assign({ payout: overrides === null ? undefined : Object.assign({}, payout, overrides) }, extra)
    );

    assert.match(settle('99'.repeat(32), null).error, /payout required/);
    assert.match(settle('99'.repeat(32), { txid: 'xyz' }).error, /payout\.txid/);
    assert.match(settle('99'.repeat(32), { vout: -1 }).error, /payout\.vout/);
    assert.match(settle('99'.repeat(32), { amountSats: 19999 }).error, /must equal withdrawal amountSats/);
    assert.match(settle('99'.repeat(32), { destinationAddress: 'bcrt1qother' }).error, /destinationAddress/);
    assert.match(settle('99'.repeat(32), { confirmations: 0 }).error, /not confirmed/);
    assert.match(
      settle('99'.repeat(32), {}, { payoutMinConfirmations: 6 }).error,
      /need >= 6 confirmations/
    );

    const settled = settle('99'.repeat(32), {});
    assert.strictEqual(settled.ok, true, settled.error);
    const reused = settlePegOutPayout(settled.content, 'aa'.repeat(32), { payout });
    assert.strictEqual(reused.ok, false);
    assert.match(reused.error, /already settled another withdrawal/);
    const own = settlePegOutPayout(settled.content, 'aa'.repeat(32), {
      payout: Object.assign({}, payout, { vout: 2 })
    });
    assert.strictEqual(own.ok, true, own.error);
  });

  it('validateLedgerPatch rejects a settled withdrawal without a payout', function () {
    const credited = applyPegInCredit({}, {
      txid: 'cc'.repeat(32),
      vout: 0,
      amountSats: 50000,
      confirmations: 200
    }, { vaultConfirmedSats: 50000 });
    const burn = applyPegOutBurn(credited.content, {
      requestId: 'dd'.repeat(32),
      amountSats: 20000,
      destinationAddress: 'bcrt1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh'
    });
    const settled = settlePegOutPayout(burn.content, 'dd'.repeat(32), {
      payout: {
        txid: 'ee'.repeat(32),
        vout: 0,
        amountSats: 20000,
        destinationAddress: 'bcrt1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
        confirmations: 1
      }
    });
    assert.ok(settled.ok, settled.error);
    assert.strictEqual(validateLedgerPatch(patchesForReserve(settled.reserve)).ok, true);

    const stripped = JSON.parse(JSON.stringify(settled.reserve));
    delete stripped.withdrawals[0].payout;
    const bad = validateLedgerPatch(patchesForReserve(stripped));
    assert.strictEqual(bad.ok, false);
    assert.match(bad.error, /payout\.txid/);
  });

  it('settlePegOutPayout does not mutate caller withdrawal when conservation fails', function () {
    const credited = applyPegInCredit({}, {
      txid: '55'.repeat(32),
      vout: 0,
      amountSats: 50000,
      confirmations: 200
    }, { vaultConfirmedSats: 50000 });
    assert.ok(credited.ok);
    const burn = applyPegOutBurn(credited.content, {
      requestId: '66'.repeat(32),
      amountSats: 20000,
      destinationAddress: 'bcrt1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh'
    });
    assert.ok(burn.ok);
    const originalRow = burn.content[RESERVE_KEY].withdrawals[0];
    assert.strictEqual(originalRow.status, 'pending');

    const failed = settlePegOutPayout(burn.content, '66'.repeat(32), {
      vaultConfirmedSats: 0,
      payout: {
        txid: '67'.repeat(32),
        vout: 0,
        amountSats: 20000,
        destinationAddress: 'bcrt1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
        confirmations: 1
      }
    });
    assert.match(failed.error, /conservation violated/);
    assert.strictEqual(failed.ok, false);
    assert.strictEqual(originalRow.status, 'pending');
    assert.ok(!originalRow.settledAt);
  });

  it('validateLedgerPatch allows full reserve object and rejects nested invent / bad schema', function () {
    const credited = applyPegInCredit({}, {
      txid: '44'.repeat(32),
      vout: 0,
      amountSats: 1000,
      confirmations: 144
    }, { vaultConfirmedSats: 1000 });
    const okPatches = patchesForReserve(credited.reserve);
    assert.strictEqual(validateLedgerPatch(okPatches).ok, true);

    const nested = validateLedgerPatch([{
      op: 'replace',
      path: `/${RESERVE_KEY}/outstandingSats`,
      value: 999999999
    }]);
    assert.strictEqual(nested.ok, false);

    const invent = validateLedgerPatch([{
      op: 'add',
      path: `/${RESERVE_KEY}`,
      value: {
        outstandingSats: 1000000,
        creditedSats: 1000000,
        burnedSats: 0,
        pendingBurnsSats: 0,
        vaultConfirmedSats: 1,
        deposits: [],
        withdrawals: []
      }
    }]);
    assert.strictEqual(invent.ok, false);

    const badSchema = validateLedgerPatch([{
      op: 'add',
      path: `/${RESERVE_KEY}`,
      value: {
        outstandingSats: 0,
        creditedSats: 0,
        burnedSats: 0,
        pendingBurnsSats: 0,
        vaultConfirmedSats: 0,
        deposits: [{ txid: 'nope', vout: 0, amountSats: 1000 }],
        withdrawals: []
      }
    }]);
    assert.strictEqual(badSchema.ok, false);
  });

  it('defaultFederationSidechainPolicy denies free-form mint paths', function () {
    const p = defaultFederationSidechainPolicy();
    assert.ok(p.deniedPathPrefixes.includes('/balances'));
    assert.ok(p.allowedPathPrefixes.includes('/federationReserve'));
    assert.strictEqual(p.allowEmptyPolicy, false);
  });

  it('defaultFederationSidechainPolicy enforces those prefixes through the patch gate', function () {
    const policy = parseStatechainPathPolicy(defaultFederationSidechainPolicy());
    const check = (path) => validatePatchesAgainstPolicy(
      [{ op: 'add', path, value: 1 }],
      policy
    ).ok;

    assert.strictEqual(check(`/${RESERVE_KEY}/withdrawals/0`), true);
    assert.strictEqual(check('/mint'), false);
    assert.strictEqual(check('/balances/attacker'), false);
    // Sibling keys must not inherit an allowed prefix.
    assert.strictEqual(check(`/${RESERVE_KEY}Shadow`), false);
  });
});
