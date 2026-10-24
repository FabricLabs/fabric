'use strict';

const assert = require('assert');
const Key = require('../types/key');
const Federation = require('../types/federation');
const {
  parseStatechainPathPolicy,
  validatePatchesAgainstPolicy
} = require('../functions/sidechainState');

const {
  validatorId,
  uniqueValidatorPubkeys,
  normalizeValidators,
  findValidatorEntry,
  witnessSignatureFor,
  resolveThreshold,
  thresholdExceedsValidators,
  verifyLocalEpochDigests,
  verifyReserveConservation,
  evaluateValidatorSignGate,
  emptyReserve,
  readReserve,
  assertConservation,
  applyPegInCredit,
  applyPegOutBurn,
  settlePegOutPayout,
  unsettlePegOutPayout,
  patchesForReserve,
  validateLedgerPatch,
  defaultSidechainPolicy,
  RESERVE_KEY
} = Federation;

describe('Federation validator sets', function () {
  const k1 = new Key({ private: '11'.repeat(32) });
  const k2 = new Key({ private: '22'.repeat(32) });
  const k3 = new Key({ private: '33'.repeat(32) });

  it('keeps one entry per signing key however it is spelled', function () {
    const x = k1.pubkey.slice(2);
    const flipped = (k1.pubkey.startsWith('02') ? '03' : '02') + x;
    const out = uniqueValidatorPubkeys([
      k1.pubkey,
      k1.pubkey.toUpperCase(),
      x,
      flipped,
      '0x' + k1.pubkey,
      k2.pubkey,
      '',
      null
    ]);
    assert.deepStrictEqual(out, [k1.pubkey, k2.pubkey]);
  });

  it('defaults to a strict majority of distinct validators', function () {
    assert.strictEqual(resolveThreshold(null, []), 1);
    assert.strictEqual(resolveThreshold(undefined, [k1.pubkey]), 1);
    assert.strictEqual(resolveThreshold(null, [k1.pubkey, k2.pubkey]), 2);
    assert.strictEqual(resolveThreshold('', [k1.pubkey, k2.pubkey, k3.pubkey]), 2);
    assert.strictEqual(resolveThreshold(0, [k1.pubkey, k2.pubkey, k3.pubkey]), 2);
    assert.strictEqual(resolveThreshold(null, [k1.pubkey, k1.pubkey.toUpperCase(), k2.pubkey]), 2);
  });

  it('honors an explicit threshold, rounded up', function () {
    const three = [k1.pubkey, k2.pubkey, k3.pubkey];
    assert.strictEqual(resolveThreshold(1, three), 1);
    assert.strictEqual(resolveThreshold('3', three), 3);
    assert.strictEqual(resolveThreshold(1.5, three), 2);
  });

  it('clamps an explicit threshold to the distinct validators', function () {
    const two = [k1.pubkey, k1.pubkey.slice(2), k2.pubkey];
    assert.strictEqual(resolveThreshold(3, two), 2);
    assert.strictEqual(thresholdExceedsValidators(3, two), true);
    assert.strictEqual(thresholdExceedsValidators(2, two), false);
    assert.strictEqual(thresholdExceedsValidators(null, two), false);
    assert.strictEqual(resolveThreshold(4, []), 4);
    assert.strictEqual(thresholdExceedsValidators(4, []), false);
  });

  it('ignores malformed and off-curve entries when counting validators', function () {
    const offCurve = '00'.repeat(32);
    const list = [k1.pubkey, offCurve, '02' + offCurve, 'zz'.repeat(33), 42, {}, k2.pubkey];
    assert.deepStrictEqual(uniqueValidatorPubkeys(list), [k1.pubkey, k2.pubkey]);
    assert.strictEqual(resolveThreshold(null, list), 2);
  });

  it('normalizes validators to lowercase compressed keys', function () {
    const x2 = k2.pubkey.slice(2);
    const out = normalizeValidators([
      k1.pubkey.toUpperCase(),
      x2,
      Buffer.from(k3.pubkey, 'hex'),
      k1.pubkey,
      '00'.repeat(32)
    ]);
    assert.deepStrictEqual(out, [k1.pubkey, '02' + x2, k3.pubkey]);
    assert.strictEqual(validatorId(k2.pubkey), x2);
    assert.strictEqual(findValidatorEntry(out, k2.pubkey), '02' + x2);
    assert.strictEqual(findValidatorEntry(out, k1.pubkey.slice(2)), k1.pubkey);
    assert.strictEqual(findValidatorEntry(out, 'nope'), null);
    const sigs = { [k2.pubkey.toUpperCase()]: 'sig2' };
    assert.strictEqual(witnessSignatureFor(sigs, '02' + x2), 'sig2');
    assert.strictEqual(witnessSignatureFor(sigs, k1.pubkey), undefined);
  });
});

describe('Federation pre-sign gates', function () {
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

describe('Federation reserve ledger', function () {
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
        confirmations: 6
      }
    });
    assert.strictEqual(settled.ok, true, settled.error);
    assert.strictEqual(settled.reserve.pendingBurnsSats, 0);
    assert.strictEqual(settled.reserve.vaultConfirmedSats, 30000);
    assert.strictEqual(settled.reserve.withdrawals[0].status, 'settled');
    assert.deepStrictEqual(settled.reserve.withdrawals[0].payout, {
      txid: '77'.repeat(32),
      vout: 0,
      confirmations: 6
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
      confirmations: 6
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
    assert.match(settle('99'.repeat(32), { confirmations: 5 }).error, /need >= 6 confirmations/);
    assert.match(
      settle('99'.repeat(32), {}, { payoutMinConfirmations: 10 }).error,
      /need >= 10 confirmations/
    );
    assert.strictEqual(settle('99'.repeat(32), { confirmations: 1 }, { payoutMinConfirmations: 1 }).ok, true);

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

  it('settlePegOutPayout matches the destination by scriptPubKey, not address spelling', function () {
    const bitcoin = require('bitcoinjs-lib');
    const hash = Buffer.alloc(20, 7);
    const segwit = bitcoin.payments.p2wpkh({ hash, network: bitcoin.networks.regtest });
    const legacy = bitcoin.payments.p2pkh({ hash, network: bitcoin.networks.regtest }).address;
    const credited = applyPegInCredit({}, {
      txid: '12'.repeat(32), vout: 0, amountSats: 60000, confirmations: 200
    }, { vaultConfirmedSats: 60000 });
    const burn = (content, requestId, destinationAddress) => applyPegOutBurn(content, {
      requestId, amountSats: 20000, destinationAddress
    });
    const a = burn(credited.content, '13'.repeat(32), segwit.address.toUpperCase());
    const b = burn(a.content, '14'.repeat(32), legacy);
    assert.ok(a.ok && b.ok);
    const payout = (vout, extra) => Object.assign({
      txid: '15'.repeat(32), vout, amountSats: 20000, confirmations: 6
    }, extra);

    const lower = settlePegOutPayout(b.content, '13'.repeat(32), {
      payout: payout(0, { destinationAddress: segwit.address })
    });
    assert.strictEqual(lower.ok, true, lower.error);
    const byScript = settlePegOutPayout(b.content, '13'.repeat(32), {
      payout: payout(0, { scriptPubKey: Buffer.from(segwit.output).toString('hex').toUpperCase() })
    });
    assert.strictEqual(byScript.ok, true, byScript.error);
    const wrongType = settlePegOutPayout(b.content, '14'.repeat(32), {
      payout: payout(1, { destinationAddress: segwit.address })
    });
    assert.match(wrongType.error, /destinationAddress/);
    const base58 = settlePegOutPayout(b.content, '14'.repeat(32), {
      payout: payout(1, { destinationAddress: legacy })
    });
    assert.strictEqual(base58.ok, true, base58.error);
    const changedCase = settlePegOutPayout(b.content, '14'.repeat(32), {
      payout: payout(1, { destinationAddress: legacy.toLowerCase() })
    });
    assert.strictEqual(changedCase.ok, false);
  });

  it('unsettlePegOutPayout reopens a withdrawal whose payout was reorged out', function () {
    const dest = 'bcrt1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';
    const credited = applyPegInCredit({}, {
      txid: '21'.repeat(32), vout: 0, amountSats: 50000, confirmations: 200
    }, { vaultConfirmedSats: 50000 });
    const burn = applyPegOutBurn(credited.content, {
      requestId: '23'.repeat(32), amountSats: 20000, destinationAddress: dest
    });
    const payout = { txid: '24'.repeat(32), vout: 0, amountSats: 20000, destinationAddress: dest, confirmations: 6 };
    const settled = settlePegOutPayout(burn.content, '23'.repeat(32), { payout });
    assert.ok(settled.ok, settled.error);

    assert.match(unsettlePegOutPayout(burn.content, '23'.repeat(32), { payout }).error, /not settled/);
    assert.match(unsettlePegOutPayout(settled.content, '23'.repeat(32), {}).error, /payout required/);
    assert.match(
      unsettlePegOutPayout(settled.content, '23'.repeat(32), { payout: { txid: '24'.repeat(32), vout: 1 } }).error,
      /does not match/
    );

    const reopened = unsettlePegOutPayout(settled.content, '23'.repeat(32), { payout });
    assert.strictEqual(reopened.ok, true, reopened.error);
    assert.strictEqual(reopened.reserve.pendingBurnsSats, 20000);
    assert.strictEqual(reopened.reserve.vaultConfirmedSats, 50000);
    assert.strictEqual(reopened.reserve.withdrawals[0].status, 'pending');
    assert.strictEqual(reopened.reserve.withdrawals[0].payout, undefined);
    assert.strictEqual(settled.reserve.withdrawals[0].status, 'settled');
    assert.strictEqual(validateLedgerPatch(patchesForReserve(reopened.reserve)).ok, true);

    const resettled = settlePegOutPayout(reopened.content, '23'.repeat(32), {
      payout: Object.assign({}, payout, { txid: '25'.repeat(32) })
    });
    assert.strictEqual(resettled.ok, true, resettled.error);
    assert.strictEqual(resettled.reserve.vaultConfirmedSats, 30000);
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
        confirmations: 6
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
        confirmations: 6
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

  it('defaultSidechainPolicy denies free-form mint paths', function () {
    const p = defaultSidechainPolicy();
    assert.ok(p.deniedPathPrefixes.includes('/balances'));
    assert.ok(p.allowedPathPrefixes.includes('/federationReserve'));
    assert.strictEqual(p.allowEmptyPolicy, false);
  });

  it('defaultSidechainPolicy enforces those prefixes through the patch gate', function () {
    const policy = parseStatechainPathPolicy(defaultSidechainPolicy());
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

describe('Federation named federations', function () {
  const crypto = require('crypto');
  const { Transaction, address, networks } = require('bitcoinjs-lib');
  const ecc = require('../types/ecc');

  function members (n) {
    const privs = [];
    while (privs.length < n) {
      const k = crypto.randomBytes(32);
      if (ecc.isPrivate(k)) privs.push(k);
    }
    return { privs, pubs: privs.map((p) => Buffer.from(ecc.pointFromScalar(p, true)).toString('hex')) };
  }

  function fundingTx (vaultAddress, sats, extraFirst = false) {
    const tx = new Transaction();
    tx.version = 2;
    tx.addInput(crypto.randomBytes(32), 0);
    if (extraFirst) tx.addOutput(address.toOutputScript(address.toBech32(crypto.randomBytes(20), 0, 'bcrt'), networks.regtest), 1000n);
    tx.addOutput(address.toOutputScript(vaultAddress, networks.regtest), BigInt(sats));
    return tx;
  }

  describe('descriptor', function () {
    it('gives the same id and vault for any validator order', function () {
      const { pubs } = members(3);
      const a = Federation.buildDescriptor({ validators: pubs, threshold: 2, network: 'regtest', publisher: pubs[0] });
      const b = Federation.buildDescriptor({ validators: [pubs[2], pubs[0], pubs[1]], threshold: 2, network: 'regtest', publisher: pubs[0] });
      assert.strictEqual(Federation.descriptorId(a), Federation.descriptorId(b));
      assert.strictEqual(Federation.vaultForDescriptor(a).address, Federation.vaultForDescriptor(b).address);
    });

    it('keeps a fixed id for a fixed descriptor', function () {
      const pubs = ['11', '22', '33'].map((b) => new Key({ private: b.repeat(32) }).pubkey);
      const d = Federation.buildDescriptor({ validators: pubs, threshold: 2, network: 'regtest', publisher: pubs[0] });
      assert.strictEqual(Federation.descriptorId(d), crypto.createHash('sha256').update(JSON.stringify({
        internalKeyMode: d.internalKeyMode,
        ladder: { csvBlocks: 144, softMode: 'reduced', softThreshold: 2 },
        network: 'regtest',
        publisher: d.publisher,
        signatureScheme: 'schnorr',
        threshold: 2,
        type: 'FabricFederationDescriptor',
        validators: d.validators,
        version: 1
      })).digest('hex'));
    });

    it('never has a one-key soft tier', function () {
      const { pubs } = members(3);
      const d = Federation.buildDescriptor({ validators: pubs, threshold: 2, network: 'regtest', publisher: pubs[1] });
      const vault = Federation.vaultForDescriptor(d);
      assert.strictEqual(d.ladder.softThreshold, 2);
      assert.strictEqual(vault.softTier.threshold, 2);
    });

    it('rejects descriptors that are not canonical', function () {
      const { pubs } = members(3);
      const d = Federation.buildDescriptor({ validators: pubs, threshold: 2, network: 'regtest', publisher: pubs[0] });
      assert.throws(() => Federation.canonicalDescriptor({ ...d, threshold: 1 }), /canonical/);
      assert.throws(() => Federation.canonicalDescriptor({ ...d, validators: [...d.validators].reverse() }), /canonical/);
      assert.throws(() => Federation.buildDescriptor({ validators: pubs, threshold: 2, network: 'regtest', publisher: members(1).pubs[0] }), /publisher/);
    });
  });

  describe('withdrawal', function () {
    const { privs, pubs } = members(3);
    const descriptor = Federation.buildDescriptor({ validators: pubs, threshold: 2, network: 'regtest', publisher: pubs[0] });
    const vault = Federation.vaultForDescriptor(descriptor);
    const dest = address.toBech32(crypto.randomBytes(20), 0, 'bcrt');

    it('builds the same request on every member', function () {
      const tx = fundingTx(vault.address, 100000);
      const a = Federation.prepareWithdrawal({ descriptor, fundedTxHex: tx.toHex(), vout: 0, destinationAddress: dest, amountSats: 50000, feeSats: 500 });
      const b = Federation.prepareWithdrawal({ descriptor, fundedTxHex: tx.toHex(), destinationAddress: dest, amountSats: 50000, feeSats: 500 });
      assert.strictEqual(a.requestId, b.requestId);
      assert.strictEqual(a.changeSats, 49500);
      assert.strictEqual(a.txid, tx.getId());
    });

    it('refuses a vout that is not the vault output', function () {
      const tx = fundingTx(vault.address, 100000, true);
      assert.throws(() => Federation.prepareWithdrawal({ descriptor, fundedTxHex: tx.toHex(), vout: 0, destinationAddress: dest, amountSats: 50000, feeSats: 500 }), /vault output/);
      assert.throws(() => Federation.prepareWithdrawal({ descriptor, fundedTxHex: tx.toHex(), destinationAddress: vault.address, amountSats: 50000, feeSats: 500 }), /vault itself/);
    });

    it('finalizes with exactly threshold signatures', function () {
      const tx = fundingTx(vault.address, 100000);
      const req = Federation.prepareWithdrawal({ descriptor, fundedTxHex: tx.toHex(), destinationAddress: dest, amountSats: 50000, feeSats: 500 });
      const sigs = privs.map((k) => Federation.signWithdrawal({ psbtBase64: req.psbtBase64, privateKey: k }).signatures);
      let acc = Federation.addWithdrawalSignatures({ descriptor, psbtBase64: req.psbtBase64, signatures: sigs[0] });
      assert.throws(() => Federation.finalizeWithdrawal({ descriptor, psbtBase64: acc.psbtBase64 }), /1 of 2/);
      acc = Federation.addWithdrawalSignatures({ descriptor, psbtBase64: acc.psbtBase64, signatures: sigs[2] });
      acc = Federation.addWithdrawalSignatures({ descriptor, psbtBase64: acc.psbtBase64, signatures: sigs[1] });
      assert.strictEqual(acc.signers.length, 3);
      const done = Federation.finalizeWithdrawal({ descriptor, psbtBase64: acc.psbtBase64 });
      const witness = Transaction.fromHex(done.txHex).ins[0].witness;
      // three stack slots (one empty), leaf script, control block
      assert.strictEqual(witness.length, 5);
      assert.strictEqual(witness.slice(0, 3).filter((w) => w.length === 0).length, 1);
    });

    it('rejects forged and outside signatures', function () {
      const tx = fundingTx(vault.address, 100000);
      const req = Federation.prepareWithdrawal({ descriptor, fundedTxHex: tx.toHex(), destinationAddress: dest, amountSats: 50000, feeSats: 500 });
      const good = Federation.signWithdrawal({ psbtBase64: req.psbtBase64, privateKey: privs[1] }).signatures;
      const forged = good.map((s) => ({ ...s, signature: (s.signature[0] === '0' ? '1' : '0') + s.signature.slice(1) }));
      assert.throws(() => Federation.addWithdrawalSignatures({ descriptor, psbtBase64: req.psbtBase64, signatures: forged }), /does not verify/);
      const other = members(1);
      assert.throws(() => Federation.signWithdrawal({ psbtBase64: req.psbtBase64, privateKey: other.privs[0] }));
      const outside = good.map((s) => ({ ...s, pubkey: other.pubs[0].slice(2) }));
      assert.throws(() => Federation.addWithdrawalSignatures({ descriptor, psbtBase64: req.psbtBase64, signatures: outside }), /outside/);
    });
  });

  describe('messages', function () {
    const { pubs } = members(3);
    const descriptor = Federation.buildDescriptor({ validators: pubs, threshold: 2, network: 'regtest', publisher: pubs[1] });
    const id = Federation.descriptorId(descriptor);
    const vault = Federation.vaultForDescriptor(descriptor);

    it('builds an invite only its publisher can have sent', function () {
      const body = Federation.inviteMessage({ descriptor, name: 'Ops', members: [{ pubkey: pubs[2].slice(2), url: 'https://hub.example' }] });
      assert.strictEqual(body.contract, id);
      assert.strictEqual(body.type, Federation.MESSAGE_TYPES.invite);
      assert.strictEqual(body.members.length, 3);
      assert.strictEqual(body.members.find((m) => m.pubkey === pubs[2]).url, 'https://hub.example');
      assert.ok(Federation.isMessage(body));
      assert.deepStrictEqual(Federation.verifyInvite(body, pubs[1]), descriptor);
      assert.throws(() => Federation.verifyInvite(body, pubs[0]), /publisher/);
      assert.throws(() => Federation.verifyInvite({ ...body, federationId: 'aa'.repeat(32), contract: 'aa'.repeat(32) }, pubs[1]), /does not match/);
    });

    it('accepts messages only from members, under the federation id', function () {
      const body = Federation.responseMessage(id, true);
      assert.strictEqual(Federation.verifySender(descriptor, body, pubs[0]), pubs[0].slice(2));
      assert.throws(() => Federation.verifySender(descriptor, body, members(1).pubs[0]), /not a member/);
      assert.throws(() => Federation.verifySender(descriptor, { ...body, contract: 'other' }, pubs[0]), /federation id/);
      assert.strictEqual(Federation.isMessage({ type: 'ChatMessage' }), false);
    });

    it('rebuilds a withdrawal request before anyone signs it', function () {
      const tx = fundingTx(vault.address, 100000);
      const dest = address.toBech32(crypto.randomBytes(20), 0, 'bcrt');
      const prepared = Federation.prepareWithdrawal({ descriptor, fundedTxHex: tx.toHex(), destinationAddress: dest, amountSats: 40000, feeSats: 400 });
      const body = Federation.withdrawalMessage(id, { ...prepared, fundedTxHex: tx.toHex(), destinationAddress: dest });
      assert.strictEqual(Federation.verifyWithdrawalRequest(descriptor, body).psbtBase64, prepared.psbtBase64);
      assert.throws(() => Federation.verifyWithdrawalRequest(descriptor, { ...body, amountSats: 41000 }), /does not match/);
    });
  });
});
