'use strict';

const assert = require('assert');
const crypto = require('crypto');
const bitcoin = require('bitcoinjs-lib');
const Key = require('../types/key');
const {
  synthesizeDefaultLadder,
  buildContractTaproot,
  composeTaprootTree,
  buildHashlockLeaf,
  buildSpendLeaf,
  buildScriptLeaf,
  compileLeaves,
  prepareHashlockWithdrawalPsbt,
  finalizeHashlockPsbt,
  toAddress
} = require('../functions/contractTaproot');

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
