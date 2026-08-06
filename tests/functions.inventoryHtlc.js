'use strict';

const assert = require('assert');
const crypto = require('crypto');
const bitcoin = require('bitcoinjs-lib');
const ecc = require('../types/ecc');
const inventoryHtlc = require('../functions/inventoryHtlc');
const publishedDocumentEnvelope = require('../functions/publishedDocumentEnvelope');

bitcoin.initEccLib(ecc);

function randomKeyPair () {
  let priv;
  do {
    priv = crypto.randomBytes(32);
  } while (!ecc.isPrivate(priv));
  return {
    privateKey: priv,
    publicKey: Buffer.from(ecc.pointFromScalar(priv, true))
  };
}

describe('functions/inventoryHtlc', function () {
  it('buildHtlcFundingHints produces BIP21 bitcoin: URI', function () {
    const h = inventoryHtlc.buildHtlcFundingHints({
      paymentAddress: 'bcrt1pv25g0waah5e7rhkdcrmnanexxsng93uew5xe8tzzpuq5ckkwzltsalzjxr',
      amountSats: 100_000,
      label: 'Test doc'
    });
    assert.strictEqual(h.amountBtc, '0.00100000');
    assert.ok(h.bitcoinUri.startsWith('bitcoin:bcrt1'));
    assert.ok(h.bitcoinUri.includes('amount=0.00100000'));
  });

  it('buildDocumentOfferEscrow matches inventory HTLC address (deliverer=seller)', function () {
    const deliverer = randomKeyPair();
    const initiator = randomKeyPair();
    const preimage = crypto.randomBytes(32);
    const paymentHashHex = inventoryHtlc.hash256(preimage).toString('hex');
    const refundLockHeight = 900_000;
    const a = inventoryHtlc.buildDocumentOfferEscrow({
      networkName: 'regtest',
      delivererPubkeyHex: deliverer.publicKey.toString('hex'),
      initiatorRefundPubkeyHex: initiator.publicKey.toString('hex'),
      paymentHashHex,
      refundLockHeight,
      amountSats: 50_000,
      label: 'test-offer'
    });
    const b = inventoryHtlc.buildInventoryHtlcP2tr({
      networkName: 'regtest',
      sellerPubkeyCompressed: deliverer.publicKey,
      buyerRefundPubkeyCompressed: initiator.publicKey,
      paymentHash32: Buffer.from(paymentHashHex, 'hex'),
      refundLocktimeHeight: refundLockHeight
    });
    assert.strictEqual(a.paymentAddress, b.address);
    assert.strictEqual(a.claimScriptHex, b.claimScript.toString('hex'));
    assert.strictEqual(a.refundScriptHex, b.refundScript.toString('hex'));
    assert.ok(a.bitcoinUri && a.bitcoinUri.includes('amount='), 'BIP21 amount');
  });

  it('payment hash matches purchaseContentHashHex', function () {
    const docId = 'docfixture1';
    const parsed = {
      contentBase64: Buffer.from('hello fabric htlc', 'utf8').toString('base64'),
      name: 'fixture',
      mime: 'text/plain',
      size: 17,
      sha256: docId,
      id: docId
    };
    const preimage = publishedDocumentEnvelope.inventoryHtlcPreimage32(docId, parsed);
    const paymentHashHex = crypto.createHash('sha256').update(preimage).digest('hex');
    assert.strictEqual(paymentHashHex, publishedDocumentEnvelope.purchaseContentHashHex(docId, parsed));
    assert.strictEqual(inventoryHtlc.hash256(preimage).toString('hex'), paymentHashHex);
  });

  it('builds a regtest P2TR address', function () {
    const seller = randomKeyPair();
    const buyer = randomKeyPair();
    const h = crypto.randomBytes(32);
    const built = inventoryHtlc.buildInventoryHtlcP2tr({
      networkName: 'regtest',
      sellerPubkeyCompressed: seller.publicKey,
      buyerRefundPubkeyCompressed: buyer.publicKey,
      paymentHash32: h,
      refundLocktimeHeight: 1000
    });
    assert.ok(built.address && built.address.startsWith('bcrt1'));
    assert.strictEqual(built.paymentHashHex, h.toString('hex'));
  });

  it('seller claim PSBT signs', function () {
    const seller = randomKeyPair();
    const buyer = randomKeyPair();
    const preimage = crypto.randomBytes(32);
    const paymentHash32 = inventoryHtlc.hash256(preimage);
    const built = inventoryHtlc.buildInventoryHtlcP2tr({
      networkName: 'regtest',
      sellerPubkeyCompressed: seller.publicKey,
      buyerRefundPubkeyCompressed: buyer.publicKey,
      paymentHash32,
      refundLocktimeHeight: 1_000_000
    });
    const fundingTx = new bitcoin.Transaction();
    fundingTx.version = 2;
    fundingTx.addInput(Buffer.alloc(32, 1), 0, 0xffffffff);
    fundingTx.addOutput(built.output, 50_000n);
    const destAddr = bitcoin.payments.p2wpkh({
      pubkey: buyer.publicKey,
      network: bitcoin.networks.regtest
    }).address;
    const bundle = inventoryHtlc.prepareInventoryHtlcSellerClaimPsbt({
      networkName: 'regtest',
      fundedTxHex: fundingTx.toHex(),
      paymentAddress: built.address,
      claimScript: built.claimScript,
      refundScript: built.refundScript,
      preimage32: preimage,
      destinationAddress: destAddr,
      feeSats: 1500
    });
    const { txHex, txid } = inventoryHtlc.signAndExtractInventoryHtlcSellerClaim(bundle, seller.privateKey);
    assert.ok(/^[0-9a-f]{64}$/i.test(txid));
    assert.ok(txHex.length > 100);

    const extracted = inventoryHtlc.extractPreimageFromClaimTx(txHex, paymentHash32.toString('hex'));
    assert.strictEqual(extracted.ok, true);
    assert.ok(extracted.preimage32.equals(preimage));
    assert.strictEqual(extracted.preimageHex, preimage.toString('hex'));
    assert.strictEqual(extracted.vin, 0);

    const wrong = inventoryHtlc.extractPreimageFromClaimTx(txHex, crypto.randomBytes(32).toString('hex'));
    assert.strictEqual(wrong.ok, false);
  });

  it('buyer refund PSBT signs after locktime tip check', function () {
    const seller = randomKeyPair();
    const buyer = randomKeyPair();
    const preimage = crypto.randomBytes(32);
    const paymentHash32 = inventoryHtlc.hash256(preimage);
    const lock = 100;
    const built = inventoryHtlc.buildInventoryHtlcP2tr({
      networkName: 'regtest',
      sellerPubkeyCompressed: seller.publicKey,
      buyerRefundPubkeyCompressed: buyer.publicKey,
      paymentHash32,
      refundLocktimeHeight: lock
    });
    const fundingTx = new bitcoin.Transaction();
    fundingTx.version = 2;
    fundingTx.addInput(Buffer.alloc(32, 2), 0, 0xffffffff);
    fundingTx.addOutput(built.output, 40_000n);
    const destAddr = bitcoin.payments.p2wpkh({
      pubkey: buyer.publicKey,
      network: bitcoin.networks.regtest
    }).address;
    assert.strictEqual(inventoryHtlc.refundLocktimeMature(99, lock), false);
    assert.strictEqual(inventoryHtlc.refundLocktimeMature(100, lock), true);
    const bundle = inventoryHtlc.prepareInventoryHtlcBuyerRefundPsbt({
      networkName: 'regtest',
      fundedTxHex: fundingTx.toHex(),
      paymentAddress: built.address,
      claimScript: built.claimScript,
      refundScript: built.refundScript,
      refundLocktimeHeight: lock,
      destinationAddress: destAddr,
      feeSats: 1000
    });
    const { txHex, txid } = inventoryHtlc.signAndExtractInventoryHtlcBuyerRefund(bundle, buyer.privateKey);
    assert.ok(/^[0-9a-f]{64}$/i.test(txid));
    assert.ok(txHex.length > 100);
    const tx = bitcoin.Transaction.fromHex(txHex);
    assert.strictEqual(tx.locktime, lock);
  });
});
