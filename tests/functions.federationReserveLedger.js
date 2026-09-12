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

    const settled = settlePegOutPayout(burn.content, '22'.repeat(32));
    assert.strictEqual(settled.ok, true);
    assert.strictEqual(settled.reserve.pendingBurnsSats, 0);
    assert.strictEqual(settled.reserve.vaultConfirmedSats, 30000);
    assert.strictEqual(settled.reserve.withdrawals[0].status, 'settled');
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
});
