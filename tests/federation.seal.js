'use strict';

const assert = require('assert');
const crypto = require('crypto');
const bitcoin = require('bitcoinjs-lib');
const { schnorr } = require('@noble/curves/secp256k1.js');
const ecc = require('../types/ecc');
const Federation = require('../types/federation');
const Policy = require('../types/policy');
const MuSig2 = require('../functions/musig2');

bitcoin.initEccLib(ecc);

function secret () {
  for (;;) {
    const sk = crypto.randomBytes(32);
    const x = BigInt('0x' + sk.toString('hex'));
    if (x > 0n && x < 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n) return sk;
  }
}

function member (sk) {
  return {
    sk,
    pub: Buffer.from(ecc.pointFromScalar(sk, true)).toString('hex')
  };
}

function p2wpkh (pub) {
  return bitcoin.payments.p2wpkh({
    pubkey: Buffer.from(pub, 'hex'),
    network: bitcoin.networks.regtest
  }).address;
}

describe('federation cooperative seal', function () {
  const a = member(secret());
  const b = member(secret());
  const c = member(secret());

  it('an n-of-n vault key matches an independent MuSig2 aggregate', function () {
    const descriptor = Federation.buildDescriptor({
      validators: [b.pub, a.pub],
      threshold: 2,
      network: 'regtest',
      publisher: a.pub
    });
    assert.strictEqual(descriptor.internalKeyMode, 'musig2');
    const vault = Federation.vaultForDescriptor(descriptor);
    const aggregate = MuSig2.aggregateXonly(descriptor.validators).toString('hex');
    assert.strictEqual(vault.internalPubkeyHex, aggregate);
    assert.notStrictEqual(vault.internalPubkeyHex, Policy.TAPROOT_INTERNAL_NUMS.toString('hex'));

    const kept = Federation.buildDescriptor({
      validators: [a.pub, b.pub],
      threshold: 2,
      network: 'regtest',
      publisher: a.pub,
      internalKeyMode: 'nums'
    });
    const numsVault = Federation.vaultForDescriptor(kept);
    assert.strictEqual(numsVault.internalPubkeyHex, Policy.TAPROOT_INTERNAL_NUMS.toString('hex'));
    assert.notStrictEqual(numsVault.address, vault.address);
    assert.strictEqual(Federation.canonicalDescriptor(kept).internalKeyMode, 'nums');
  });

  it('a 2-of-3 descriptor stays on the script path', function () {
    const descriptor = Federation.buildDescriptor({
      validators: [a.pub, b.pub, c.pub],
      threshold: 2,
      network: 'regtest',
      publisher: a.pub
    });
    assert.strictEqual(descriptor.internalKeyMode, 'nums');
    const vault = Federation.vaultForDescriptor(descriptor);
    assert.strictEqual(vault.spendPolicy.internalKeyMode, 'nums');
    const tx = new bitcoin.Transaction();
    tx.version = 2;
    tx.addInput(crypto.randomBytes(32), 0);
    tx.addOutput(bitcoin.address.toOutputScript(vault.address, bitcoin.networks.regtest), 100000n);
    const prepared = Federation.prepareWithdrawal({
      descriptor,
      fundedTxHex: tx.toHex(),
      destinationAddress: p2wpkh(a.pub),
      amountSats: 50000,
      feeSats: 500
    });
    const psbt = bitcoin.Psbt.fromBase64(prepared.psbtBase64);
    assert.ok(psbt.data.inputs[0].tapLeafScript && psbt.data.inputs[0].tapLeafScript.length > 0);
  });

  it('a key-path signature under the Taproot tweak verifies against the vault output key', function () {
    const sks = [a.sk, b.sk];
    const descriptor = Federation.buildDescriptor({
      validators: [a.pub, b.pub],
      threshold: 2,
      network: 'regtest',
      publisher: a.pub
    });
    const vault = Federation.vaultForDescriptor(descriptor);
    const tree = Policy.composeTaprootTree({
      network: 'regtest',
      policy: vault.policy,
      internalKeyMode: 'musig2'
    });
    assert.strictEqual(tree.address, vault.address);
    const internal = Buffer.from(vault.internalPubkeyHex, 'hex');
    const merkle = Buffer.from(tree.merkleRootHex, 'hex');
    const tweakHash = require('bitcoinjs-lib/src/payments/bip341').tapTweakHash(internal, merkle);
    const pubkeys = descriptor.validators.map((pk) => Buffer.from(pk, 'hex'));
    const ordered = sks
      .map((sk) => ({ sk, pk: MuSig2.individualPk(sk) }))
      .sort((p, q) => Buffer.compare(p.pk, q.pk));
    const keys = ordered.map((p) => p.pk);
    const msg = crypto.randomBytes(32);
    const tweaks = [tweakHash];
    const isXonly = [true];
    const tweaked = MuSig2.getXonlyPk(MuSig2.keyAggAndTweak(keys, tweaks, isXonly));
    const outputKey = bitcoin.address.toOutputScript(vault.address, bitcoin.networks.regtest).subarray(2);
    assert.ok(tweaked.equals(outputKey));
    const first = MuSig2.nonceGen(ordered[0].sk, ordered[0].pk, tweaked, msg, null);
    const second = MuSig2.deterministicSign(ordered[1].sk, first.pubnonce, keys, tweaks, isXonly, msg, null);
    const pubnonces = [first.pubnonce, second.pubnonce];
    const ctx = MuSig2.sessionContext(MuSig2.nonceAgg(pubnonces), keys, tweaks, isXonly, msg);
    const sig = MuSig2.partialSigAgg([
      MuSig2.sign(first.secnonce, ordered[0].sk, ctx),
      second.psig
    ], ctx);
    assert.strictEqual(schnorr.verify(sig, msg, outputKey), true);
  });

  it('funding is a signer PayJoin with no OP_RETURN', function () {
    const descriptor = Federation.buildDescriptor({
      validators: [a.pub, b.pub],
      threshold: 2,
      network: 'regtest',
      publisher: a.pub
    });
    const funded = Federation.buildFundingPsbt({
      descriptor,
      inputs: [a, b].map((m) => ({
        txid: crypto.randomBytes(32).toString('hex'),
        vout: 0,
        valueSats: 80000,
        address: p2wpkh(m.pub),
        pubkey: m.pub
      })),
      vaultSats: 100000,
      feeSats: 1000
    });
    const psbt = bitcoin.Psbt.fromBase64(funded.psbtBase64, { network: bitcoin.networks.regtest });
    const vaultScript = bitcoin.address.toOutputScript(funded.vaultAddress, bitcoin.networks.regtest);
    assert.ok(Buffer.from(psbt.txOutputs[0].script).equals(vaultScript));
    assert.strictEqual(psbt.txOutputs.length, 3);
    for (const out of psbt.txOutputs) {
      assert.notStrictEqual(out.script[0], 0x6a);
    }
    assert.strictEqual(funded.changeSats, 59000);
    const threshold = Federation.buildDescriptor({
      validators: [a.pub, b.pub, c.pub],
      threshold: 2,
      network: 'regtest',
      publisher: a.pub
    });
    assert.throws(() => Federation.buildFundingPsbt({
      descriptor: threshold,
      inputs: [],
      vaultSats: 100000,
      feeSats: 1000
    }), /at least one signer/);
  });
});
