'use strict';

const assert = require('assert');
const crypto = require('crypto');
const bitcoin = require('bitcoinjs-lib');
const Key = require('../types/key');
const Contract = require('../types/contract');
const {
  observePaymentToAddress,
  applyPaymentObservationToTip
} = require('../functions/contractPaymentObserve');
const {
  buildExecutionRunOutput,
  computeExecutionRunCommitmentHex,
  computeFabricProgramRunFromExecution
} = require('../functions/executionRunBridge');

describe('executionRunBridge / FabricProgramRun forward digest', function () {
  it('keeps legacy ExecutionRun digest stable', function () {
    const result = {
      ok: true,
      stepsExecuted: 2,
      trace: [{ pc: 0, op: 'Push' }],
      stack: [1]
    };
    const a = computeExecutionRunCommitmentHex('cid-1', result);
    const b = computeExecutionRunCommitmentHex('cid-1', result);
    assert.strictEqual(a, b);
    assert.strictEqual(a.length, 64);
  });

  it('prefers Program.runCommitmentHex over derived FabricProgramRun', function () {
    const programHash = crypto.createHash('sha256').update('prog').digest('hex');
    const owned = crypto.createHash('sha256').update('owned-run').digest('hex');
    const result = { ok: true, stepsExecuted: 1, trace: [], stack: ['x'] };
    const out = buildExecutionRunOutput({
      contractId: 'cid-owned',
      programHash,
      result,
      program: {
        programHash,
        runCommitmentHex () { return owned; }
      }
    });
    assert.strictEqual(out.runCommitmentHex, owned);
    assert.strictEqual(out.fabricProgramRunCommitmentHex, owned);
    assert.notStrictEqual(
      out.runCommitmentHex,
      computeFabricProgramRunFromExecution({ programHash, contractId: 'cid-owned', result })
    );
  });

  it('buildExecutionRunOutput prefers FabricProgramRun when programHash set', function () {
    const programHash = crypto.createHash('sha256').update('prog').digest('hex');
    const result = { ok: true, stepsExecuted: 1, trace: [], stack: ['x'] };
    const out = buildExecutionRunOutput({
      contractId: 'cid-forward',
      programHash,
      result
    });
    assert.strictEqual(out.programHash, programHash);
    assert.ok(out.executionRunCommitmentHex);
    assert.ok(out.fabricProgramRunCommitmentHex);
    assert.notStrictEqual(out.executionRunCommitmentHex, out.fabricProgramRunCommitmentHex);
    assert.strictEqual(out.runCommitmentHex, out.fabricProgramRunCommitmentHex);
    assert.strictEqual(out.fabricProgramRun.kind, 'FabricProgramRun');
    assert.strictEqual(out.fabricProgramRun.runCommitmentHex, out.fabricProgramRunCommitmentHex);
    assert.strictEqual(
      computeFabricProgramRunFromExecution({ programHash, contractId: 'cid-forward', result }),
      out.fabricProgramRunCommitmentHex
    );
  });

  it('falls back to ExecutionRun digest without programHash', function () {
    const result = { ok: false, error: 'boom', trace: [], stack: [] };
    const out = buildExecutionRunOutput({ contractId: 'cid-legacy', result });
    assert.strictEqual(out.programHash, null);
    assert.strictEqual(out.runCommitmentHex, out.executionRunCommitmentHex);
    assert.strictEqual(out.fabricProgramRun, null);
  });
});

describe('contractPaymentObserve / Contract L1 payment', function () {
  const keys = [];
  before(function () {
    for (let i = 0; i < 3; i++) keys.push(new Key());
  });

  function fundTx (outputScript, valueSats) {
    const fund = new bitcoin.Transaction();
    fund.version = 2;
    fund.addInput(Buffer.alloc(32), 0);
    fund.addOutput(outputScript, BigInt(valueSats));
    return fund;
  }

  it('observes successful payment to contract address', function () {
    const contract = new Contract({
      network: 'regtest',
      validators: [keys[0].pubkey, keys[1].pubkey],
      threshold: 1,
      publisher: keys[0].pubkey
    });
    const address = contract.toAddress('regtest');
    const built = contract.toTaprootContract({ network: 'regtest' });
    const tx = fundTx(built.output, 50000);
    const obs = observePaymentToAddress({
      tx: tx.toHex(),
      address,
      network: 'regtest',
      amountSats: 40000
    });
    assert.strictEqual(obs.ok, true);
    assert.strictEqual(obs.code, 'PAID');
    assert.strictEqual(obs.matchedSats, 50000);
    assert.ok(obs.txid);
  });

  it('fails when tx does not pay contract address', function () {
    const other = bitcoin.payments.p2wpkh({
      pubkey: Buffer.from(keys[2].pubkey, 'hex'),
      network: bitcoin.networks.regtest
    });
    const tx = fundTx(other.output, 10000);
    const contract = new Contract({
      network: 'regtest',
      validators: [keys[0].pubkey],
      threshold: 1,
      publisher: keys[0].pubkey
    });
    const obs = observePaymentToAddress({
      tx: tx.toHex(),
      address: contract.toAddress('regtest'),
      network: 'regtest'
    });
    assert.strictEqual(obs.ok, false);
    assert.strictEqual(obs.code, 'NO_MATCH');
  });

  it('fails UNDERPAID when matched sats below amountSats', function () {
    const contract = new Contract({
      network: 'regtest',
      validators: [keys[0].pubkey],
      threshold: 1,
      publisher: keys[0].pubkey
    });
    const built = contract.toTaprootContract({ network: 'regtest' });
    const tx = fundTx(built.output, 1000);
    const obs = observePaymentToAddress({
      tx,
      address: contract.toAddress('regtest'),
      network: 'regtest',
      amountSats: 5000
    });
    assert.strictEqual(obs.ok, false);
    assert.strictEqual(obs.code, 'UNDERPAID');
    assert.strictEqual(obs.matchedSats, 1000);
  });

  it('fails on missing / invalid tx', function () {
    assert.strictEqual(observePaymentToAddress({ address: 'bcrt1qxx' }).code, 'MISSING_TX');
    assert.strictEqual(
      observePaymentToAddress({ tx: 'zz', address: 'bcrt1qxx' }).code,
      'INVALID_TX'
    );
  });

  it('Contract#_handleBitcoinTransaction applies balances on success', function () {
    const contract = new Contract({
      network: 'regtest',
      validators: [keys[0].pubkey],
      threshold: 1,
      publisher: keys[0].pubkey,
      state: { balances: {}, payments: [] }
    });
    const built = contract.toTaprootContract({ network: 'regtest' });
    const tx = fundTx(built.output, 25000);
    const obs = contract._handleBitcoinTransaction(tx.toHex(), {
      network: 'regtest',
      amountSats: 10000
    });
    assert.strictEqual(obs.ok, true);
    assert.strictEqual(obs.applied, true);
    const addr = contract.toAddress('regtest');
    assert.strictEqual(contract._state.content.balances[addr].sats, 25000);
    assert.strictEqual(contract._state.content.payments.length, 1);
    const again = contract._handleBitcoinTransaction(tx.toHex(), {
      network: 'regtest',
      amountSats: 10000
    });
    assert.strictEqual(again.ok, true);
    assert.strictEqual(contract._state.content.balances[addr].sats, 25000);
    assert.strictEqual(contract._state.content.payments.length, 1);
  });

  it('Contract#_handleBitcoinTransaction does not apply on failure', function () {
    const contract = new Contract({
      network: 'regtest',
      validators: [keys[0].pubkey],
      threshold: 1,
      publisher: keys[0].pubkey,
      state: { balances: {}, payments: [] }
    });
    const other = bitcoin.payments.p2wpkh({
      pubkey: Buffer.from(keys[1].pubkey, 'hex'),
      network: bitcoin.networks.regtest
    });
    const tx = fundTx(other.output, 9000);
    const obs = contract._handleBitcoinTransaction(tx.toHex(), { network: 'regtest' });
    assert.strictEqual(obs.ok, false);
    assert.strictEqual(obs.code, 'NO_MATCH');
    assert.deepStrictEqual(contract._state.content.payments || [], []);
  });

  it('applyPaymentObservationToTip rejects failed observations', function () {
    assert.throws(
      () => applyPaymentObservationToTip({}, { ok: false, code: 'NO_MATCH' }),
      /successful/
    );
  });
});
