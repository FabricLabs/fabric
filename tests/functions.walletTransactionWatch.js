'use strict';

const assert = require('assert');
const crypto = require('crypto');
const bitcoin = require('bitcoinjs-lib');
const ecc = require('../types/ecc');
const Wallet = require('../types/wallet');
const Htlc = require('../types/htlc');
const {
  BITCOIN_MESSAGE_TYPES,
  isKnownBitcoinMessageType,
  watchKey,
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
    const paymentHash32 = Htlc.sha256(preimage);
    const built = new Htlc({
      network: 'regtest',
      claimPubkey: seller.publicKey,
      refundPubkey: buyer.publicKey,
      paymentHash: paymentHash32,
      refundLocktime: 500
    });
    const fundingTx = new bitcoin.Transaction();
    fundingTx.version = 2;
    fundingTx.addInput(Buffer.alloc(32, 3), 0, 0xffffffff);
    fundingTx.addOutput(built.output, 25_000n);
    const destAddr = bitcoin.payments.p2wpkh({
      pubkey: buyer.publicKey,
      network: bitcoin.networks.regtest
    }).address;
    const bundle = Htlc.prepareClaimPsbt({
      networkName: 'regtest',
      fundedTxHex: fundingTx.toHex(),
      paymentAddress: built.address,
      claimScript: built.claimScript,
      refundScript: built.refundScript,
      preimage32: preimage,
      destinationAddress: destAddr,
      feeSats: 1000
    });
    const { txHex, txid } = Htlc.signClaim(bundle, seller.privateKey);

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

  it('matches a watched receive address from raw transaction hex', function () {
    const addr = bitcoin.payments.p2wpkh({ hash: Buffer.alloc(20, 7), network: bitcoin.networks.regtest }).address;
    const elsewhere = bitcoin.payments.p2wpkh({ hash: Buffer.alloc(20, 8), network: bitcoin.networks.regtest }).address;
    const tx = new bitcoin.Transaction();
    tx.addInput(Buffer.alloc(32, 1), 0);
    tx.addOutput(bitcoin.address.toOutputScript(addr, bitcoin.networks.regtest), 50000n);
    const watchSet = buildWatchSet({}, { addresses: [addr] });
    const classified = classifyWalletTransaction(tx.toHex(), watchSet);
    assert.strictEqual(classified.related, true);
    assert.strictEqual(classified.kind, 'receive');
    assert.deepStrictEqual(classified.matchedAddresses, [addr]);
    const other = buildWatchSet({}, { addresses: [elsewhere] });
    assert.strictEqual(classifyWalletTransaction(tx.toHex(), other).related, false);
  });

  it('matches a mainnet P2PKH receive from raw transaction hex on a default wallet', function () {
    const wallet = new Wallet({ gapLimit: 1 });
    const [addr] = [...wallet._watch.addresses.values()].filter((m) => m.type === 'p2pkh' && !m.change).map((m) => m.address);
    assert.ok(addr && addr.startsWith('1'), 'the default wallet watches mainnet P2PKH');
    const tx = new bitcoin.Transaction();
    tx.addInput(Buffer.alloc(32, 1), 0);
    tx.addOutput(bitcoin.address.toOutputScript(addr, bitcoin.networks.bitcoin), 50000n);
    const payments = [];
    wallet.on('payment', (ev) => payments.push(ev));
    const classified = wallet.ingestBitcoinTransaction(tx.toHex());
    assert.strictEqual(classified.kind, 'receive');
    assert.deepStrictEqual(classified.matchedAddresses, [addr]);
    assert.strictEqual(payments.length, 1);
    assert.deepStrictEqual(payments[0].matchedAddresses, [addr]);
  });

  it('matches Bech32 in any case, Base58 only as written, and reports the address as registered', function () {
    const net = bitcoin.networks.regtest;
    const lower = bitcoin.payments.p2wpkh({ hash: Buffer.alloc(20, 9), network: net }).address;
    const upper = lower.toUpperCase();
    const tx = new bitcoin.Transaction();
    tx.addInput(Buffer.alloc(32, 1), 0);
    tx.addOutput(bitcoin.address.toOutputScript(lower, net), 50000n);
    const byUpper = classifyWalletTransaction(tx.toHex(), buildWatchSet({}, { addresses: [upper], network: 'regtest' }));
    assert.strictEqual(byUpper.kind, 'receive');
    assert.deepStrictEqual(byUpper.matchedAddresses, [upper]);
    const verbose = { txid: 'ab'.repeat(32), vin: [{}], vout: [{ n: 0, value: 0.0005, scriptPubKey: { address: upper } }] };
    assert.deepStrictEqual(classifyWalletTransaction(verbose, buildWatchSet({}, { addresses: [lower] })).matchedAddresses, [lower]);
    assert.strictEqual(watchKey(upper), lower);
    assert.strictEqual(watchKey(lower.slice(0, 6) + lower.slice(6).toUpperCase()), lower.slice(0, 6) + lower.slice(6).toUpperCase(), 'mixed case is not Bech32');

    const p2pkh = bitcoin.payments.p2pkh({ hash: Buffer.alloc(20, 9), network: bitcoin.networks.bitcoin }).address;
    const swapped = p2pkh.replace(/[a-z]/, (c) => c.toUpperCase());
    assert.notStrictEqual(swapped, p2pkh);
    const legacy = { txid: 'cd'.repeat(32), vin: [{}], vout: [{ n: 0, scriptPubKey: { address: p2pkh } }] };
    assert.strictEqual(classifyWalletTransaction(legacy, buildWatchSet({}, { addresses: [swapped] })).related, false);
    assert.strictEqual(classifyWalletTransaction(legacy, buildWatchSet({}, { addresses: [p2pkh] })).related, true);
  });

  it('reads raw scripts only for the watch set network', function () {
    const hash = Buffer.alloc(32, 4);
    const onRegtest = bitcoin.payments.p2wsh({ hash, network: bitcoin.networks.regtest }).address;
    const onTestnet = bitcoin.payments.p2wsh({ hash, network: bitcoin.networks.testnet }).address;
    assert.notStrictEqual(onRegtest, onTestnet);
    const tx = new bitcoin.Transaction();
    tx.addInput(Buffer.alloc(32, 1), 0);
    tx.addOutput(bitcoin.address.toOutputScript(onRegtest, bitcoin.networks.regtest), 30000n);
    const htlcAddresses = {
      [onTestnet]: { kind: 'htlc', settlementId: 'testnet-settlement' },
      [onRegtest]: { kind: 'htlc', settlementId: 'regtest-settlement' }
    };
    const regtest = classifyWalletTransaction(tx.toHex(), buildWatchSet({}, { htlcAddresses, network: 'regtest' }));
    assert.deepStrictEqual(regtest.matchedAddresses, [onRegtest]);
    assert.strictEqual(regtest.settlementId, 'regtest-settlement');
    const testnet = classifyWalletTransaction(tx.toHex(), buildWatchSet({}, { htlcAddresses, network: 'testnet' }));
    assert.deepStrictEqual(testnet.matchedAddresses, [onTestnet]);
    assert.strictEqual(testnet.settlementId, 'testnet-settlement');
    const wallet = new Wallet({ network: 'regtest', gapLimit: 1 });
    assert.strictEqual(wallet.getWatchSet().network, bitcoin.networks.regtest);
  });

  it('a funding with a locktime is funding; a transaction spending the HTLC without the preimage is a refund', function () {
    const seller = randomKeyPair();
    const buyer = randomKeyPair();
    const paymentHash32 = Htlc.sha256(crypto.randomBytes(32));
    const built = new Htlc({
      network: 'regtest',
      claimPubkey: seller.publicKey,
      refundPubkey: buyer.publicKey,
      paymentHash: paymentHash32,
      refundLocktime: 500
    });
    const watchSet = buildWatchSet({}, {
      network: 'regtest',
      htlcAddresses: { [built.address]: { kind: 'htlc', paymentHashHex: paymentHash32.toString('hex'), settlementId: 's-refund' } },
      paymentHashes: { [paymentHash32.toString('hex')]: { settlementId: 's-refund' } }
    });
    const fundingTx = new bitcoin.Transaction();
    fundingTx.version = 2;
    fundingTx.locktime = 123;
    fundingTx.addInput(Buffer.alloc(32, 3), 0, 0xfffffffe);
    fundingTx.addOutput(built.output, 25_000n);
    const funding = classifyWalletTransaction(fundingTx.toHex(), watchSet);
    assert.strictEqual(funding.kind, 'htlc_funding', 'a locktime does not make a funding a refund');
    assert.strictEqual(funding.settlementId, 's-refund');

    const destAddr = bitcoin.payments.p2wpkh({ pubkey: buyer.publicKey, network: bitcoin.networks.regtest }).address;
    const bundle = Htlc.prepareRefundPsbt({
      networkName: 'regtest',
      fundedTxHex: fundingTx.toHex(),
      paymentAddress: built.address,
      claimScript: built.claimScript,
      refundScript: built.refundScript,
      refundLocktimeHeight: 500,
      destinationAddress: destAddr,
      feeSats: 1000
    });
    const { txHex, txid } = Htlc.signRefund(bundle, buyer.privateKey);
    const refund = classifyWalletTransaction(txHex, watchSet);
    assert.strictEqual(refund.kind, 'htlc_refund');
    assert.strictEqual(refund.txid, txid);
    assert.strictEqual(refund.settlementId, 's-refund');
    assert.deepStrictEqual(refund.matchedAddresses, [built.address]);

    const verboseRefund = {
      txid: 'ee'.repeat(32),
      locktime: 0,
      vin: [{ txid: fundingTx.getId(), vout: 0, prevout: { scriptPubKey: { address: built.address } } }],
      vout: [{ n: 0, scriptPubKey: { address: destAddr } }]
    };
    assert.strictEqual(classifyWalletTransaction(verboseRefund, watchSet).kind, 'htlc_refund', 'a verbose prevout names the HTLC');
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
    const paymentHash32 = Htlc.sha256(preimage);
    const built = new Htlc({
      network: 'regtest',
      claimPubkey: seller.publicKey,
      refundPubkey: buyer.publicKey,
      paymentHash: paymentHash32,
      refundLocktime: 10
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

  it('a raw transaction spending a coin the wallet received is a spend, and its change is no payment', function () {
    const wallet = new Wallet({ network: 'regtest', gapLimit: 2 });
    const net = bitcoin.networks.regtest;
    const [receiveAddr, changeAddr] = [...wallet._watch.addresses.values()]
      .filter((m) => m.type === 'p2wpkh').map((m) => m.address);
    const external = bitcoin.payments.p2wpkh({ hash: Buffer.alloc(20, 5), network: net }).address;
    const payments = [];
    const spends = [];
    wallet.on('payment', (ev) => payments.push(ev));
    wallet.on('walletTransaction', (ev) => { if (ev.kind === 'spend') spends.push(ev); });

    const incoming = new bitcoin.Transaction();
    incoming.addInput(Buffer.alloc(32, 1), 0);
    incoming.addOutput(bitcoin.address.toOutputScript(receiveAddr, net), 80000n);
    const received = wallet.ingestBitcoinTransaction(incoming.toHex());
    assert.strictEqual(received.kind, 'receive');
    assert.deepStrictEqual(received.ownedOutputs.map((o) => [o.txid, o.vout, o.address, o.valueSats]), [[incoming.getId(), 0, receiveAddr, 80000]]);
    assert.strictEqual(payments.length, 1);

    // A Taproot-style key-path witness names no address: only the remembered outpoint shows it is ours.
    const outgoing = new bitcoin.Transaction();
    outgoing.addInput(Buffer.from(incoming.getId(), 'hex').reverse(), 0);
    outgoing.ins[0].witness = [Buffer.alloc(64, 1)];
    outgoing.addOutput(bitcoin.address.toOutputScript(external, net), 50000n);
    outgoing.addOutput(bitcoin.address.toOutputScript(changeAddr, net), 29000n);
    const spent = wallet.ingestBitcoinTransaction(outgoing.toHex());
    assert.strictEqual(spent.kind, 'spend');
    assert.deepStrictEqual(spent.matchedAddresses.sort(), [receiveAddr, changeAddr].sort());
    assert.strictEqual(payments.length, 1, 'change is not reported as a payment');
    assert.strictEqual(spends.length, 1);
    assert.ok(wallet._ownedOutpoints.has(`${outgoing.getId()}:1`), 'the change is remembered too');
    // Seen again (block after mempool): the same spend, not a receive.
    assert.strictEqual(wallet.ingestBitcoinTransaction(outgoing.toHex()).kind, 'spend');
    assert.strictEqual(payments.length, 1);

    // A P2WPKH witness names the address it spends from, remembered or not.
    const fresh = new Wallet({ network: 'regtest', gapLimit: 1 });
    const node = fresh.key.master.derivePath("m/84'/1'/0'/0/0");
    const pubkey = Buffer.from(node.publicKey);
    const own = bitcoin.payments.p2wpkh({ pubkey, network: net }).address;
    assert.ok(fresh._watch.addresses.has(own));
    const sig = bitcoin.script.signature.encode(Buffer.from(ecc.sign(Buffer.alloc(32, 6), Buffer.from(node.privateKey))), bitcoin.Transaction.SIGHASH_ALL);
    const signed = new bitcoin.Transaction();
    signed.addInput(Buffer.alloc(32, 2), 0);
    signed.ins[0].witness = [Buffer.from(sig), pubkey];
    signed.addOutput(bitcoin.address.toOutputScript(own, net), 1000n);
    assert.strictEqual(fresh.ingestBitcoinTransaction(signed.toHex()).kind, 'spend');
  });

  it('remembers a bounded number of owned outpoints', function () {
    const wallet = new Wallet({ network: 'regtest', gapLimit: 1, ownedOutpointMemory: 3 });
    for (let i = 0; i < 5; i++) wallet._rememberOwnedOutputs([{ txid: 'aa'.repeat(32), vout: i, address: 'x' }]);
    assert.deepStrictEqual([...wallet._ownedOutpoints.keys()].map((k) => k.split(':')[1]), ['2', '3', '4']);
  });
});
