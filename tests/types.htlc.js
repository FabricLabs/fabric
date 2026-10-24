'use strict';

const assert = require('assert');
const crypto = require('crypto');
const bitcoin = require('bitcoinjs-lib');
const ecc = require('../types/ecc');
const Htlc = require('../types/htlc');
const publishedDocumentEnvelope = require('../functions/publishedDocumentEnvelope');
const { networkForFabricName } = require('../types/policy');
const { BIP125_SEQUENCE_LOCKTIME_ONLY, sequenceSignalsOptInRbf } = require('../functions/bip125');
const vectors = require('./fixtures/htlc-vectors.json');

bitcoin.initEccLib(ecc);

const hex = (s) => Buffer.from(s, 'hex');

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

function fund (htlc, sats, seed) {
  const tx = new bitcoin.Transaction();
  tx.version = 2;
  tx.addInput(Buffer.alloc(32, seed), 0, 0xffffffff);
  tx.addOutput(htlc.output, BigInt(sats));
  return tx.toHex();
}

// Pinned from the original inventory HTLC builder: any change
// here moves funds to a different address.
describe('types/htlc golden vectors', function () {
  for (const [name, v] of Object.entries(vectors.networks)) {
    describe(name, function () {
      it('composes the pinned address, scripts, and control blocks', function () {
        const htlc = new Htlc({
          network: name,
          claimPubkey: vectors.seller,
          refundPubkey: vectors.buyer,
          paymentHash: vectors.paymentHash,
          refundLocktime: vectors.lock
        });
        assert.strictEqual(htlc.address, v.address);
        assert.strictEqual(htlc.output.toString('hex'), v.output);
        assert.strictEqual(htlc.claimScript.toString('hex'), v.claimScript);
        assert.strictEqual(htlc.refundScript.toString('hex'), v.refundScript);
        assert.strictEqual(htlc.paymentHashHex, vectors.paymentHash);
        assert.strictEqual(htlc.controlBlock('claim').toString('hex'), v.claimControlBlock);
        assert.strictEqual(htlc.controlBlock('refund').toString('hex'), v.refundControlBlock);
        assert.strictEqual(htlc.findVout(bitcoin.Transaction.fromHex(v.fundedTxHex)), 0);
        const json = htlc.toJSON();
        assert.strictEqual(json.type, 'Htlc');
        assert.strictEqual(json.address, v.address);
        assert.strictEqual(json.refundLocktime, vectors.lock);
      });

      it('prepares the pinned claim and refund PSBTs', function () {
        const htlc = new Htlc({
          network: name,
          claimPubkey: hex(vectors.seller),
          refundPubkey: hex(vectors.buyer),
          paymentHash: hex(vectors.paymentHash),
          refundLocktime: vectors.lock
        });
        const spend = { fundedTxHex: v.fundedTxHex, destinationAddress: v.destination, feeSats: 500 };
        assert.strictEqual(htlc.prepareClaim(Object.assign({ preimage: vectors.preimage }, spend)).psbt.toBase64(), v.claimPsbt);
        assert.strictEqual(htlc.prepareRefund(spend).psbt.toBase64(), v.refundPsbt);
      });

      it('prepares the same PSBTs from scripts alone', function () {
        const common = {
          networkName: name,
          fundedTxHex: v.fundedTxHex,
          paymentAddress: v.address,
          claimScript: hex(v.claimScript),
          refundScript: hex(v.refundScript),
          destinationAddress: v.destination,
          feeSats: 500
        };
        const claim = Htlc.prepareClaimPsbt(Object.assign({ preimage32: hex(vectors.preimage) }, common));
        const refund = Htlc.prepareRefundPsbt(Object.assign({ refundLocktimeHeight: vectors.lock }, common));
        assert.strictEqual(claim.psbt.toBase64(), v.claimPsbt);
        assert.strictEqual(refund.psbt.toBase64(), v.refundPsbt);
      });
    });
  }
});

describe('types/htlc', function () {
  const settings = {
    network: 'regtest',
    claimPubkey: vectors.seller,
    refundPubkey: vectors.buyer,
    paymentHash: vectors.paymentHash,
    refundLocktime: vectors.lock
  };

  it('claims with the preimage and reveals it on chain', function () {
    const htlc = new Htlc(settings);
    const v = vectors.networks.regtest;
    const bundle = htlc.prepareClaim({ fundedTxHex: v.fundedTxHex, preimage: hex(vectors.preimage), destinationAddress: v.destination, feeSats: 500 });
    const claim = Htlc.signClaim(bundle, Buffer.alloc(32, 1));
    const found = Htlc.extractPreimage(claim.txHex, htlc.paymentHashHex);
    assert.strictEqual(found.ok, true);
    assert.strictEqual(found.preimageHex, vectors.preimage);
    assert.strictEqual(found.vin, 0);
  });

  it('signs a claim with fresh keys and only reveals the matching preimage', function () {
    const seller = randomKeyPair();
    const buyer = randomKeyPair();
    const preimage = Htlc.randomPreimage();
    const htlc = new Htlc({
      network: 'regtest',
      claimPubkey: seller.publicKey,
      refundPubkey: buyer.publicKey,
      paymentHash: Htlc.sha256(preimage),
      refundLocktime: 1_000_000
    });
    assert.ok(htlc.address.startsWith('bcrt1p'));
    const destinationAddress = bitcoin.payments.p2wpkh({ pubkey: buyer.publicKey, network: bitcoin.networks.regtest }).address;
    const bundle = htlc.prepareClaim({ fundedTxHex: fund(htlc, 50_000, 1), preimage, destinationAddress, feeSats: 1500 });
    const { txHex, txid } = Htlc.signClaim(bundle, seller.privateKey);
    assert.ok(/^[0-9a-f]{64}$/i.test(txid));
    const extracted = Htlc.extractPreimage(txHex, htlc.paymentHashHex);
    assert.strictEqual(extracted.ok, true);
    assert.ok(extracted.preimage32.equals(preimage));
    assert.strictEqual(Htlc.extractPreimage(txHex, crypto.randomBytes(32).toString('hex')).ok, false);
  });

  it('refunds at the lock height without signalling RBF', function () {
    const seller = randomKeyPair();
    const buyer = randomKeyPair();
    const lock = 100;
    const htlc = new Htlc({
      network: 'regtest',
      claimPubkey: seller.publicKey,
      refundPubkey: buyer.publicKey,
      paymentHash: Htlc.sha256(Htlc.randomPreimage()),
      refundLocktime: lock
    });
    const destinationAddress = bitcoin.payments.p2wpkh({ pubkey: buyer.publicKey, network: bitcoin.networks.regtest }).address;
    const bundle = htlc.prepareRefund({ fundedTxHex: fund(htlc, 40_000, 2), destinationAddress, feeSats: 1000 });
    const tx = bitcoin.Transaction.fromHex(Htlc.signRefund(bundle, buyer.privateKey).txHex);
    assert.strictEqual(tx.locktime, lock);
    assert.strictEqual(tx.ins[0].sequence, BIP125_SEQUENCE_LOCKTIME_ONLY);
    assert.strictEqual(sequenceSignalsOptInRbf(tx.ins[0].sequence), false);
    assert.strictEqual(tx.ins[0].witness.length, 3);
  });

  it('refuses bad keys, hashes, and lock heights', function () {
    assert.throws(() => new Htlc(Object.assign({}, settings, { claimPubkey: 'zz' })), /compressed public keys/);
    assert.throws(() => new Htlc(Object.assign({}, settings, { refundPubkey: null })), /compressed public keys/);
    assert.throws(() => new Htlc(Object.assign({}, settings, { paymentHash: 'abcd' })), /32 bytes/);
    assert.throws(() => new Htlc(Object.assign({}, settings, { refundLocktime: 500000000 })), /block height/);
    assert.throws(() => new Htlc(settings).controlBlock('other'), /claim/);
  });

  it('validates an advertised address against the rebuilt one', function () {
    const v = vectors.networks.regtest;
    const good = Htlc.validateOffer(Object.assign({ paymentAddress: v.address }, settings));
    assert.strictEqual(good.ok, true);
    assert.strictEqual(good.htlc.address, v.address);
    const wrong = Htlc.validateOffer(Object.assign({}, settings, { paymentAddress: vectors.networks.mainnet.address }));
    assert.strictEqual(wrong.ok, false);
    assert.strictEqual(wrong.expectedAddress, v.address);
    const broken = Htlc.validateOffer(Object.assign({}, settings, { paymentHash: 'abcd' }));
    assert.strictEqual(broken.ok, false);
    assert.match(broken.error, /32 bytes/);
  });

  it('binds the payment hash to the published document', function () {
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
    assert.strictEqual(Htlc.sha256(preimage).toString('hex'), publishedDocumentEnvelope.purchaseContentHashHex(docId, parsed));
  });

  it('writes BIP21 funding hints for its address', function () {
    const htlc = new Htlc(settings);
    const hints = htlc.fundingHints({ amountSats: 50_000, label: 'htlc-edge' });
    assert.strictEqual(hints.amountBtc, '0.00050000');
    assert.ok(hints.bitcoinUri.startsWith(`bitcoin:${htlc.address}`));
    assert.ok(hints.bitcoinUri.includes('amount=0.00050000'));
    assert.strictEqual(hints.label, 'htlc-edge');
    assert.strictEqual(Htlc.fundingHints({ paymentAddress: htlc.address, amountSats: 0 }).bitcoinUri, '');
  });

  it('maps bare "test" to mainnet, never regtest', function () {
    assert.strictEqual(networkForFabricName('test'), bitcoin.networks.bitcoin);
    assert.strictEqual(new Htlc(Object.assign({}, settings, { network: 'test' })).address, vectors.networks.mainnet.address);
  });

  it('matches x-only keys across encodings', function () {
    assert.strictEqual(Htlc.toXOnly(vectors.seller), vectors.seller.slice(2));
    assert.strictEqual(Htlc.pubkeysMatchXOnly(vectors.seller, `0x${vectors.seller.slice(2)}`), true);
  });

  it('matures the refund at the lock height and not before', function () {
    assert.strictEqual(Htlc.refundMature(199, vectors.lock), false);
    assert.strictEqual(Htlc.refundMature(200, vectors.lock), true);
    assert.strictEqual(Htlc.refundMature(201, vectors.lock), true);
    assert.strictEqual(Htlc.refundMature(NaN, vectors.lock), false);
    assert.strictEqual(Htlc.refundMature(200, NaN), false);
  });

  it('draws distinct 32-byte preimages', function () {
    const a = Htlc.randomPreimage();
    const b = Htlc.randomPreimage();
    assert.strictEqual(a.length, 32);
    assert.strictEqual(Htlc.sha256(a).length, 32);
    assert.ok(!a.equals(b));
  });
});
