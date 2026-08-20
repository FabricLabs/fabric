'use strict';

const assert = require('assert');
const crypto = require('crypto');
const bitcoin = require('bitcoinjs-lib');
const ecc = require('../types/ecc');
const inventoryHtlc = require('../functions/inventoryHtlc');
const publishedDocumentEnvelope = require('../functions/publishedDocumentEnvelope');
const {
  BIP125_SEQUENCE_FINAL,
  BIP125_SEQUENCE_LOCKTIME_ONLY,
  BIP125_SEQUENCE_RBF,
  sequenceSignalsOptInRbf,
  transactionSignalsOptInRbf
} = require('../functions/bip125');

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
    assert.strictEqual(tx.ins[0].sequence, BIP125_SEQUENCE_LOCKTIME_ONLY);
    assert.strictEqual(sequenceSignalsOptInRbf(tx.ins[0].sequence), false);
  });
});

const { encodeBitcoinUri, parseBitcoinUri } = require('../functions/bip21');

describe('@fabric/core/functions/bip21', function () {
  it('encodes amount and label like inventory HTLC funding hints', function () {
    const uri = encodeBitcoinUri({
      address: 'bcrt1pv25g0waah5e7rhkdcrmnanexxsng93uew5xe8tzzpuq5ckkwzltsalzjxr',
      amount: '0.00100000',
      label: 'Test doc'
    });
    assert.ok(uri.startsWith('bitcoin:bcrt1'));
    assert.ok(uri.includes('amount=0.00100000'));
    const parsed = parseBitcoinUri(uri);
    assert.strictEqual(parsed.address, 'bcrt1pv25g0waah5e7rhkdcrmnanexxsng93uew5xe8tzzpuq5ckkwzltsalzjxr');
    assert.strictEqual(parsed.amount, '0.00100000');
    assert.strictEqual(parsed.label, 'Test doc');
  });

  it('round-trips opaque BIP-321 extras (lightning, pj)', function () {
    const uri = encodeBitcoinUri({
      address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
      extras: { lightning: 'lnbc1qq', pj: 'https://example.test/pj' }
    });
    const parsed = parseBitcoinUri(uri);
    assert.strictEqual(parsed.extras.lightning, 'lnbc1qq');
    assert.strictEqual(parsed.extras.pj, 'https://example.test/pj');
  });

  it('is used by buildHtlcFundingHints', function () {
    const h = inventoryHtlc.buildHtlcFundingHints({
      paymentAddress: 'bcrt1pv25g0waah5e7rhkdcrmnanexxsng93uew5xe8tzzpuq5ckkwzltsalzjxr',
      amountSats: 100000,
      label: 'Test doc'
    });
    const parsed = parseBitcoinUri(h.bitcoinUri);
    assert.strictEqual(parsed.amount, '0.00100000');
    assert.strictEqual(parsed.label, 'Test doc');
  });

  it('parses official BIP-21 examples (address, amount, label, message)', function () {
    const addr = '175tWpb8K1S7NmH4Zx6rewF9WQrcZv245W';
    const bare = parseBitcoinUri(`bitcoin:${addr}`);
    assert.strictEqual(bare.address, addr);
    assert.strictEqual(bare.amount, null);
    const paid = parseBitcoinUri(`bitcoin:${addr}?amount=20.3&label=Luke-Jr`);
    assert.strictEqual(paid.amount, '20.3');
    assert.strictEqual(paid.label, 'Luke-Jr');
    const msg = parseBitcoinUri(
      `bitcoin:${addr}?amount=50&label=Luke-Jr&message=Donation%20for%20project%20xyz`
    );
    assert.strictEqual(msg.message, 'Donation for project xyz');
    const upper = parseBitcoinUri(`BITCOIN:${addr}`);
    assert.strictEqual(upper.address, addr);
    const slash = parseBitcoinUri(`bitcoin://${addr}?amount=1`);
    assert.strictEqual(slash.address, addr);
    assert.strictEqual(slash.amount, '1');
  });

  it('encodes message and address-only URIs; extras cannot override amount', function () {
    const uri = encodeBitcoinUri({
      address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
      amount: 1,
      extras: { amount: '9', lightning: 'lnbc1qq', unused: '' }
    });
    const parsed = parseBitcoinUri(uri);
    assert.strictEqual(parsed.amount, '1.00000000');
    assert.strictEqual(parsed.extras.lightning, 'lnbc1qq');
    assert.ok(!Object.prototype.hasOwnProperty.call(parsed.extras, 'unused'));
    assert.strictEqual(
      encodeBitcoinUri({ address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4' }),
      'bitcoin:bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'
    );
    const withMsg = encodeBitcoinUri({
      address: '175tWpb8K1S7NmH4Zx6rewF9WQrcZv245W',
      message: 'Donation for project xyz'
    });
    assert.strictEqual(parseBitcoinUri(withMsg).message, 'Donation for project xyz');
  });

  it('rejects missing address and invalid amounts', function () {
    assert.throws(() => encodeBitcoinUri({}), /address/);
    assert.throws(() => encodeBitcoinUri({ address: 'bc1qxx', amount: -1 }), /non-negative/);
    assert.throws(() => encodeBitcoinUri({ address: 'bc1q?bad' }), /\? or #/);
    assert.throws(() => encodeBitcoinUri({ address: 'bc1qxx', amount: '1btc' }), /decimal BTC/);
    assert.throws(
      () => encodeBitcoinUri({ address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', amount: 0.000000009 }),
      /non-negative BTC/
    );
    assert.throws(
      () => encodeBitcoinUri({ address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', amount: 0.000000004 }),
      /non-negative BTC/
    );
    assert.throws(() => parseBitcoinUri('https://example.test'), /bitcoin:/);
    assert.throws(() => parseBitcoinUri('bitcoin:addr?amount=-1'), /amount is invalid/);
    assert.throws(
      () => parseBitcoinUri('bitcoin:addr?req-something=1'),
      /unsupported required BIP21 parameter/
    );
    assert.throws(
      () => parseBitcoinUri('bitcoin:addr?REQ-exp=1'),
      /unsupported required BIP21 parameter/
    );
  });
});

describe('@fabric/core/functions/bip125', function () {
  it('treats MAX-2 as opt-in RBF and MAX-1 as locktime-only', function () {
    assert.strictEqual(BIP125_SEQUENCE_FINAL, (2 ** 32) - 1);
    assert.strictEqual(BIP125_SEQUENCE_LOCKTIME_ONLY, (2 ** 32) - 2);
    assert.strictEqual(BIP125_SEQUENCE_RBF, (2 ** 32) - 3);
    assert.strictEqual(sequenceSignalsOptInRbf(BIP125_SEQUENCE_FINAL), false);
    assert.strictEqual(sequenceSignalsOptInRbf(BIP125_SEQUENCE_LOCKTIME_ONLY), false);
    assert.strictEqual(sequenceSignalsOptInRbf(BIP125_SEQUENCE_RBF), true);
    assert.strictEqual(sequenceSignalsOptInRbf(0), true);
  });

  it('opts the transaction in when any input signals RBF', function () {
    assert.strictEqual(transactionSignalsOptInRbf([
      { sequence: BIP125_SEQUENCE_LOCKTIME_ONLY },
      { nSequence: BIP125_SEQUENCE_RBF }
    ]), true);
    assert.strictEqual(transactionSignalsOptInRbf([
      { sequence: BIP125_SEQUENCE_LOCKTIME_ONLY }
    ]), false);
    assert.strictEqual(transactionSignalsOptInRbf([]), false);
    assert.strictEqual(transactionSignalsOptInRbf(null), false);
    assert.strictEqual(sequenceSignalsOptInRbf(undefined), false);
    assert.strictEqual(sequenceSignalsOptInRbf(Number.NaN), false);
    assert.strictEqual(sequenceSignalsOptInRbf(0.5), false);
    assert.strictEqual(sequenceSignalsOptInRbf(4294967296), false);
  });
});

const { LEAF_VERSION_TAPSCRIPT, tapLeafScriptEntry, taprootPsbtInputFields } = require('../functions/inventoryHtlc');

describe('@fabric/core/functions/bip371', function () {
  const internal = Buffer.from(
    '50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0',
    'hex'
  );
  const script = Buffer.from('51', 'hex');
  const controlBlock = Buffer.concat([Buffer.from([0xc0]), internal]);

  it('builds PSBT_IN_TAP_INTERNAL_KEY and PSBT_IN_TAP_LEAF_SCRIPT bags', function () {
    const fields = taprootPsbtInputFields({
      tapInternalKey: internal,
      script,
      controlBlock,
      leafVersion: LEAF_VERSION_TAPSCRIPT
    });
    assert.strictEqual(fields.tapInternalKey.length, 32);
    assert.ok(fields.tapInternalKey.equals(internal));
    assert.strictEqual(fields.tapLeafScript.length, 1);
    assert.strictEqual(fields.tapLeafScript[0].leafVersion, 0xc0);
    assert.ok(fields.tapLeafScript[0].script.equals(script));
    assert.ok(fields.tapLeafScript[0].controlBlock.equals(controlBlock));
    assert.ok(!Object.prototype.hasOwnProperty.call(fields, 'tapMerkleRoot'));
  });

  it('includes optional tapMerkleRoot and rejects short control blocks', function () {
    const root = Buffer.alloc(32, 7);
    const fields = taprootPsbtInputFields({
      tapInternalKey: internal.toString('hex'),
      script,
      controlBlock,
      tapMerkleRoot: root
    });
    assert.ok(fields.tapMerkleRoot.equals(root));
    assert.throws(
      () => tapLeafScriptEntry({ script, controlBlock: Buffer.alloc(32) }),
      /controlBlock/
    );
    assert.throws(
      () => tapLeafScriptEntry({ script, controlBlock: Buffer.alloc(34) }),
      /33 \+ 32\*m/
    );
    assert.throws(
      () => tapLeafScriptEntry({ script, controlBlock, leafVersion: 0xc1 }),
      /even/
    );
    assert.throws(
      () => tapLeafScriptEntry({
        script,
        controlBlock,
        leafVersion: 0xc2
      }),
      /match the control block/
    );
    assert.throws(
      () => taprootPsbtInputFields({
        tapInternalKey: Buffer.alloc(33, 2),
        script,
        controlBlock
      }),
      /tapInternalKey/
    );
  });

  it('is the bag shape used by inventory HTLC NUMS internal key', function () {
    assert.ok(inventoryHtlc.TAPROOT_INTERNAL_NUMS.equals(internal));
  });
});
