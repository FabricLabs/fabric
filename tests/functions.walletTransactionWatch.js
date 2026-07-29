'use strict';

const assert = require('assert');
const crypto = require('crypto');
const bitcoin = require('bitcoinjs-lib');
const ecc = require('../types/ecc');
const Wallet = require('../types/wallet');
const inventoryHtlc = require('../functions/inventoryHtlc');
const {
  BITCOIN_MESSAGE_TYPES,
  isKnownBitcoinMessageType,
  buildWatchSet,
  classifyWalletTransaction,
  scanBlockForWalletTransactions
} = require('../functions/walletTransactionWatch');

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

describe('functions/walletTransactionWatch', function () {
  it('lists known Bitcoin message types', function () {
    assert.ok(BITCOIN_MESSAGE_TYPES.includes('BitcoinBlock'));
    assert.ok(BITCOIN_MESSAGE_TYPES.includes('BitcoinTransaction'));
    assert.ok(isKnownBitcoinMessageType('BitcoinBlockHash'));
    assert.ok(!isKnownBitcoinMessageType('ChatMessage'));
  });

  it('classifies HTLC claim from seller witness preimage', function () {
    const seller = randomKeyPair();
    const buyer = randomKeyPair();
    const preimage = crypto.randomBytes(32);
    const paymentHash32 = inventoryHtlc.hash256(preimage);
    const built = inventoryHtlc.buildInventoryHtlcP2tr({
      networkName: 'regtest',
      sellerPubkeyCompressed: seller.publicKey,
      buyerRefundPubkeyCompressed: buyer.publicKey,
      paymentHash32,
      refundLocktimeHeight: 500
    });
    const fundingTx = new bitcoin.Transaction();
    fundingTx.version = 2;
    fundingTx.addInput(Buffer.alloc(32, 3), 0, 0xffffffff);
    fundingTx.addOutput(built.output, 25_000n);
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
      feeSats: 1000
    });
    const { txHex, txid } = inventoryHtlc.signAndExtractInventoryHtlcSellerClaim(bundle, seller.privateKey);

    const watchSet = buildWatchSet({}, {
      htlcAddresses: {
        [built.address]: {
          kind: 'htlc',
          paymentHashHex: paymentHash32.toString('hex'),
          settlementId: 'settlement-1'
        }
      },
      paymentHashes: {
        [paymentHash32.toString('hex')]: { settlementId: 'settlement-1' }
      }
    });
    // Funding address may not appear on claim outputs; payment-hash watch still matches.
    const classified = classifyWalletTransaction(txHex, watchSet);
    assert.strictEqual(classified.related, true);
    assert.strictEqual(classified.kind, 'htlc_claim');
    assert.strictEqual(classified.txid, txid);
    assert.strictEqual(classified.preimageHex, preimage.toString('hex'));
    assert.strictEqual(classified.settlementId, 'settlement-1');
  });

  it('scans verbosity-2 blocks for related txs', function () {
    const addr = 'bcrt1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';
    const watchSet = buildWatchSet({}, { addresses: [addr] });
    const related = scanBlockForWalletTransactions({
      tx: [
        {
          txid: 'aa'.repeat(32),
          vin: [{ coinbase: '01' }],
          vout: [{ scriptPubKey: { address: addr } }]
        },
        {
          txid: 'bb'.repeat(32),
          vin: [{}],
          vout: [{ scriptPubKey: { address: 'bcrt1qother' } }]
        }
      ]
    }, watchSet);
    assert.strictEqual(related.length, 1);
    assert.strictEqual(related[0].kind, 'coinbase');
  });
});

describe('Wallet multi-seed watch', function () {
  it('loadSeed adds another seed without replacing primary', function () {
    const wallet = new Wallet({ network: 'regtest', gapLimit: 2 });
    const primaryXpub = wallet.key.xpub;
    const second = Wallet.createSeed();
    const loaded = wallet.loadSeed(second.phrase, ['alt']);
    assert.ok(loaded.seedId);
    assert.notStrictEqual(wallet.key.xpub, loaded.xpub);
    assert.strictEqual(wallet.key.xpub, primaryXpub);
    const seeds = wallet.listSeeds();
    assert.ok(seeds.some((s) => s.seedId === 'primary'));
    assert.ok(seeds.some((s) => s.seedId === loaded.seedId));
    const watch = wallet.getWatchSet();
    assert.ok(watch.addresses.size > 0);
  });

  it('ingestBitcoinBlock emits walletTransaction for watched HTLC funding', function () {
    const wallet = new Wallet({ network: 'regtest', gapLimit: 1 });
    const seller = randomKeyPair();
    const buyer = randomKeyPair();
    const preimage = crypto.randomBytes(32);
    const paymentHash32 = inventoryHtlc.hash256(preimage);
    const built = inventoryHtlc.buildInventoryHtlcP2tr({
      networkName: 'regtest',
      sellerPubkeyCompressed: seller.publicKey,
      buyerRefundPubkeyCompressed: buyer.publicKey,
      paymentHash32,
      refundLocktimeHeight: 10
    });
    wallet.watchHtlc({
      paymentAddress: built.address,
      paymentHashHex: paymentHash32.toString('hex'),
      settlementId: 's1',
      documentId: 'doc1'
    });

    const events = [];
    wallet.on('walletTransaction', (ev) => events.push(ev));
    wallet.on('htlcFunding', (ev) => events.push({ funding: true, ...ev }));

    wallet.ingestBitcoinBlock({
      tip: 'cc'.repeat(32),
      height: 5,
      tx: [{
        txid: 'dd'.repeat(32),
        vin: [{}],
        vout: [{ value: 0.0003, scriptPubKey: { address: built.address } }]
      }]
    });

    assert.ok(events.some((e) => e.kind === 'htlc_funding' || e.funding));
  });
});
