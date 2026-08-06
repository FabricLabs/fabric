'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, it } = require('mocha');

const { CliDocumentExchange } = require('../functions/cliDocumentExchange');
const {
  DocumentOfferBook,
  createDocumentPurchaseSession
} = require('../functions/documentMarket');

describe('functions/cliDocumentExchange path & publish edges', function () {
  it('rejects null-byte paths and oversized paths', function () {
    const exchange = new CliDocumentExchange({});
    assert.strictEqual(exchange.importFile('evil\0.txt').ok, false);
    assert.strictEqual(exchange.importFile('a'.repeat(4097)).ok, false);
    assert.strictEqual(exchange.importFile('   ').ok, false);
    assert.strictEqual(exchange.importFile(undefined).ok, false);
    assert.strictEqual(exchange.importFile(123).ok, false);
  });

  it('rejects directories (not a regular file)', function () {
    const exchange = new CliDocumentExchange({});
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-doc-dir-'));
    try {
      const res = exchange.importFile(dir);
      assert.strictEqual(res.ok, false);
    } finally {
      fs.rmdirSync(dir);
    }
  });

  it('accepts absolute paths outside cwd when the file exists', function () {
    const tmp = path.join(os.tmpdir(), `fabric-abs-${Date.now()}.txt`);
    fs.writeFileSync(tmp, 'absolute-ok');
    const exchange = new CliDocumentExchange({
      getPeer: () => ({
        _state: { content: { documents: {}, documentRates: {} } },
        settings: {},
        _publishDocument () {}
      }),
      getFilesystem: () => null
    });
    try {
      const res = exchange.importFile(tmp);
      assert.ok(res.ok, res.error);
      assert.ok(res.data.documentId);
    } finally {
      fs.unlinkSync(tmp);
    }
  });

  it('trims surrounding whitespace on import paths', function () {
    const tmp = path.join(os.tmpdir(), `fabric-trim-${Date.now()}.txt`);
    fs.writeFileSync(tmp, 'trim-me');
    const exchange = new CliDocumentExchange({
      getPeer: () => ({
        _state: { content: { documents: {}, documentRates: {} } },
        settings: {},
        _publishDocument () {}
      }),
      getFilesystem: () => null
    });
    try {
      const res = exchange.importFile(`  ${tmp}  `);
      assert.ok(res.ok, res.error);
    } finally {
      fs.unlinkSync(tmp);
    }
  });

  it('publish rejects non-finite and negative rateSats; accepts finite fractions', function () {
    const published = [];
    const exchange = new CliDocumentExchange({
      getPeer: () => ({
        _state: { content: { documents: {}, documentRates: {} } },
        settings: {},
        _publishDocument (id, body, rate) { published.push(rate); }
      })
    });
    exchange.documents.docA = Buffer.from('x');
    for (const bad of [NaN, Infinity, -Infinity, -1, 'nope']) {
      assert.strictEqual(exchange.publish('docA', bad).ok, false, String(bad));
    }
    // Current policy: Number.isFinite only — fractional sats are accepted.
    assert.strictEqual(exchange.publish('docA', 1.5).ok, true);
    assert.deepStrictEqual(published, [1.5]);
  });

  it('publish propagates host getPeer errors (not swallowed)', function () {
    const exchange = new CliDocumentExchange({
      getPeer: () => { throw new Error('peer boom'); }
    });
    exchange.documents.docB = Buffer.from('y');
    assert.throws(() => exchange.publish('docB', 0), /peer boom/);
  });

  it('buyerPrivateKey32 accepts hex string private + wallet.watchHtlc registers', function () {
    const Key = require('../types/key');
    const buyer = new Key();
    const watched = [];
    const privHex = Buffer.isBuffer(buyer.private)
      ? buyer.private.toString('hex')
      : String(buyer.private);
    const exchange = new CliDocumentExchange({
      getPeer: () => ({
        key: { private: privHex },
        settings: {}
      }),
      getWallet: () => ({
        watchHtlc (row) { watched.push(row); }
      })
    });
    assert.strictEqual(exchange.buyerPrivateKey32().length, 32);
    exchange.registerSessionHtlcWatch({
      settlementId: 's1',
      documentId: 'd1',
      paymentAddress: 'bcrt1q',
      contentHashHex: 'aa'.repeat(32)
    });
    assert.strictEqual(watched.length, 1);
    assert.strictEqual(watched[0].settlementId, 's1');

    const warn = [];
    const boom = new CliDocumentExchange({
      getWallet: () => ({
        watchHtlc () { throw new Error('watch fail'); }
      }),
      onWarning: (m) => warn.push(m)
    });
    boom.registerSessionHtlcWatch({ settlementId: 's2', documentId: 'd2' });
    assert.ok(warn.some((w) => /watch fail/.test(w)));
  });

  it('buy by seller id + AMP signer mismatch refuse', function () {
    const Key = require('../types/key');
    const inventoryHtlc = require('../functions/inventoryHtlc');
    const seller = new Key();
    const other = new Key();
    const buyer = new Key();
    const contentHash = 'ab'.repeat(32);
    const lock = 900_000;
    const built = inventoryHtlc.buildInventoryHtlcP2tr({
      networkName: 'regtest',
      sellerPubkeyCompressed: Buffer.from(String(seller.pubkey), 'hex'),
      buyerRefundPubkeyCompressed: Buffer.from(String(buyer.pubkey), 'hex'),
      paymentHash32: Buffer.from(contentHash, 'hex'),
      refundLocktimeHeight: lock
    });
    const book = new DocumentOfferBook();
    book.ingestInventoryResponse({
      origin: 'seller-named',
      sellerPubkey: String(seller.pubkey).toLowerCase(),
      // Wire AMP signer deliberately mismatches the seller pubkey claimed in the offer.
      ampSignerPubkey: String(other.pubkey).toLowerCase(),
      peerScore: 2,
      latencyMs: 5,
      items: [{
        id: 'doc-named',
        rateSats: 25,
        contentHash,
        sellerPubkey: String(seller.pubkey).toLowerCase(),
        sellerAddress: 'seller-named',
        htlc: { paymentAddress: built.address, paymentHashHex: contentHash }
      }]
    });
    const exchange = new CliDocumentExchange({
      offerBook: book,
      getPeer: () => ({
        settings: { inventoryHtlcLocktimeHeight: lock },
        key: {
          public: {
            encodeCompressed (enc) {
              return enc === 'hex' ? String(buyer.pubkey).toLowerCase() : Buffer.from(String(buyer.pubkey), 'hex');
            }
          }
        },
        peers: {
          'seller-named': {
            id: 'seller-named',
            name: 'seller-named',
            publicKey: String(seller.pubkey).toLowerCase()
          }
        }
      }),
      getNetworkName: () => 'regtest',
      getWallet: () => null
    });
    const mismatch = exchange.buy('doc-named', 'seller-named');
    assert.ok(!mismatch.ok);
    assert.match(mismatch.error, /AMP signer|seller pubkey/i);

    // Drop AMP mismatch and buy by seller filter via registry pubkey resolve.
    book.ingestInventoryResponse({
      origin: 'seller-named',
      sellerPubkey: String(seller.pubkey).toLowerCase(),
      peerScore: 2,
      latencyMs: 5,
      items: [{
        id: 'doc-named-2',
        rateSats: 25,
        contentHash: 'ac'.repeat(32),
        sellerAddress: 'seller-named',
        htlc: {
          paymentAddress: inventoryHtlc.buildInventoryHtlcP2tr({
            networkName: 'regtest',
            sellerPubkeyCompressed: Buffer.from(String(seller.pubkey), 'hex'),
            buyerRefundPubkeyCompressed: Buffer.from(String(buyer.pubkey), 'hex'),
            paymentHash32: Buffer.from('ac'.repeat(32), 'hex'),
            refundLocktimeHeight: lock
          }).address,
          paymentHashHex: 'ac'.repeat(32)
        }
      }]
    });
    const ok = exchange.buy('doc-named-2', 'seller-named');
    assert.ok(ok.ok, ok.error);
    assert.strictEqual(ok.session.documentId, 'doc-named-2');
  });

  it('claimWatch opens via Hub reveal and claim witness', async function () {
    const crypto = require('crypto');
    const bitcoin = require('bitcoinjs-lib');
    const ecc = require('../types/ecc');
    const inventoryHtlc = require('../functions/inventoryHtlc');
    bitcoin.initEccLib(ecc);

    const sellerPriv = crypto.randomBytes(32);
    const buyerPriv = crypto.randomBytes(32);
    const sellerPub = Buffer.from(ecc.pointFromScalar(sellerPriv, true));
    const buyerPub = Buffer.from(ecc.pointFromScalar(buyerPriv, true));
    const preimage = crypto.randomBytes(32);
    const paymentHash32 = inventoryHtlc.hash256(preimage);
    const built = inventoryHtlc.buildInventoryHtlcP2tr({
      networkName: 'regtest',
      sellerPubkeyCompressed: sellerPub,
      buyerRefundPubkeyCompressed: buyerPub,
      paymentHash32,
      refundLocktimeHeight: 1_000_000
    });
    const fundingTx = new bitcoin.Transaction();
    fundingTx.version = 2;
    fundingTx.addInput(Buffer.alloc(32, 3), 0, 0xffffffff);
    fundingTx.addOutput(built.output, 50_000n);
    const destAddr = bitcoin.payments.p2wpkh({
      pubkey: buyerPub,
      network: bitcoin.networks.regtest
    }).address;
    const claimBundle = inventoryHtlc.prepareInventoryHtlcSellerClaimPsbt({
      networkName: 'regtest',
      fundedTxHex: fundingTx.toHex(),
      paymentAddress: built.address,
      claimScript: built.claimScript,
      refundScript: built.refundScript,
      preimage32: preimage,
      destinationAddress: destAddr,
      feeSats: 1500
    });
    const { txHex: claimHex, txid: claimTxid } =
      inventoryHtlc.signAndExtractInventoryHtlcSellerClaim(claimBundle, sellerPriv);

    const session = createDocumentPurchaseSession({
      documentId: 'doc-claim-open',
      seller: 'seller:1',
      contentHashHex: paymentHash32.toString('hex'),
      amountSats: 1,
      paymentAddress: built.address,
      network: 'regtest'
    });
    session.status = 'delivery_pending';

    // Hub reveal path
    const prevFetch = global.fetch;
    global.fetch = async () => ({
      async json () {
        return {
          result: {
            claimTxid,
            preimageHex: preimage.toString('hex')
          }
        };
      }
    });
    try {
      let opened = null;
      const hubEx = new CliDocumentExchange({
        getPeer: () => ({
          openSealedDeliveryWithPreimage (id, hex) {
            opened = { id, hex };
            return { ok: true };
          }
        }),
        getSettings: () => ({
          hubRpcUrl: 'http://127.0.0.1:9',
          hubAdminToken: 'tok'
        }),
        getBitcoin: () => null
      });
      hubEx.purchaseSessions.set(session.settlementId, session);
      const hubOk = await hubEx.claimWatch(session.settlementId);
      assert.ok(hubOk.ok, hubOk.error);
      assert.strictEqual(session.status, 'complete');
      assert.strictEqual(session.openedFrom, 'hub_reveal');
      assert.strictEqual(opened.hex, preimage.toString('hex'));
    } finally {
      global.fetch = prevFetch;
    }

    // Claim-witness path (no hub)
    const session2 = createDocumentPurchaseSession({
      documentId: 'doc-claim-wit',
      seller: 'seller:1',
      contentHashHex: paymentHash32.toString('hex'),
      amountSats: 1,
      paymentAddress: built.address,
      network: 'regtest'
    });
    session2.status = 'delivery_pending';
    const bitcoinRpc = {
      async _makeRPCRequest (method, params) {
        if (method === 'getrawtransaction' && params[0] === claimTxid) return claimHex;
        return null;
      }
    };
    let opened2 = null;
    const witEx = new CliDocumentExchange({
      getPeer: () => ({
        openSealedDeliveryWithPreimage (id, hex) {
          opened2 = { id, hex };
          return { ok: true };
        }
      }),
      getBitcoin: () => bitcoinRpc,
      getSettings: () => ({})
    });
    witEx.purchaseSessions.set(session2.settlementId, session2);
    const witOk = await witEx.claimWatch(session2.settlementId, claimTxid);
    assert.ok(witOk.ok, witOk.error);
    assert.strictEqual(session2.openedFrom, 'claim_witness');
    assert.strictEqual(opened2.hex, preimage.toString('hex'));

    // Pending-delivery miss → actionable error (not fraud)
    const session3 = createDocumentPurchaseSession({
      documentId: 'doc-claim-miss',
      seller: 'seller:1',
      contentHashHex: paymentHash32.toString('hex'),
      amountSats: 1,
      paymentAddress: built.address,
      network: 'regtest'
    });
    session3.status = 'delivery_pending';
    const missEx = new CliDocumentExchange({
      getPeer: () => ({
        openSealedDeliveryWithPreimage () {
          return { ok: false, error: 'no pending sealed delivery for doc' };
        }
      }),
      getBitcoin: () => bitcoinRpc,
      getSettings: () => ({})
    });
    missEx.purchaseSessions.set(session3.settlementId, session3);
    const miss = await missEx.claimWatch(session3.settlementId, claimTxid);
    assert.ok(!miss.ok);
    assert.match(miss.error, /no pending sealed/i);
  });

  it('refund broadcasts mature buyer refund and stores hex on broadcast fail', async function () {
    const crypto = require('crypto');
    const bitcoin = require('bitcoinjs-lib');
    const ecc = require('../types/ecc');
    const inventoryHtlc = require('../functions/inventoryHtlc');
    bitcoin.initEccLib(ecc);

    const sellerPriv = crypto.randomBytes(32);
    const buyerPriv = crypto.randomBytes(32);
    const sellerPub = Buffer.from(ecc.pointFromScalar(sellerPriv, true));
    const buyerPub = Buffer.from(ecc.pointFromScalar(buyerPriv, true));
    const preimage = crypto.randomBytes(32);
    const paymentHash32 = inventoryHtlc.hash256(preimage);
    const lock = 100;
    const built = inventoryHtlc.buildInventoryHtlcP2tr({
      networkName: 'regtest',
      sellerPubkeyCompressed: sellerPub,
      buyerRefundPubkeyCompressed: buyerPub,
      paymentHash32,
      refundLocktimeHeight: lock
    });
    const fundingTx = new bitcoin.Transaction();
    fundingTx.version = 2;
    fundingTx.addInput(Buffer.alloc(32, 4), 0, 0xffffffff);
    fundingTx.addOutput(built.output, 40_000n);
    const destAddr = bitcoin.payments.p2wpkh({
      pubkey: buyerPub,
      network: bitcoin.networks.regtest
    }).address;

    const session = createDocumentPurchaseSession({
      documentId: 'doc-refund-ok',
      seller: 'seller:1',
      contentHashHex: paymentHash32.toString('hex'),
      amountSats: 1000,
      paymentAddress: built.address,
      network: 'regtest',
      htlc: {
        paymentAddress: built.address,
        claimScriptHex: built.claimScript.toString('hex'),
        refundScriptHex: built.refundScript.toString('hex'),
        refundLocktimeHeight: lock
      }
    });
    session.status = 'confirmed';
    session.txid = 'dd'.repeat(32);
    session.fundedTxHex = fundingTx.toHex();

    const broadcasts = [];
    const bitcoinOk = {
      async _makeRPCRequest (method, params) {
        if (method === 'getblockchaininfo') return { blocks: 200 };
        if (method === 'sendrawtransaction') {
          broadcasts.push(params[0]);
          return 'ee'.repeat(32);
        }
        return null;
      },
      async getUnusedAddress () { return destAddr; }
    };
    const exchange = new CliDocumentExchange({
      getPeer: () => ({
        settings: {},
        key: { private: buyerPriv }
      }),
      getBitcoin: () => bitcoinOk,
      getNetworkName: () => 'regtest'
    });
    exchange.purchaseSessions.set(session.settlementId, session);
    const ok = await exchange.refund(session.settlementId);
    assert.ok(ok.ok, ok.error);
    assert.strictEqual(session.status, 'refunded');
    assert.strictEqual(broadcasts.length, 1);

    const again = await exchange.refund(session.settlementId);
    assert.ok(again.ok);
    assert.match(again.message, /already refunded/i);

    // Broadcast failure keeps signed hex on the session
    const session2 = createDocumentPurchaseSession({
      documentId: 'doc-refund-fail',
      seller: 'seller:1',
      contentHashHex: paymentHash32.toString('hex'),
      amountSats: 1000,
      paymentAddress: built.address,
      network: 'regtest',
      htlc: {
        paymentAddress: built.address,
        claimScriptHex: built.claimScript.toString('hex'),
        refundScriptHex: built.refundScript.toString('hex'),
        refundLocktimeHeight: lock
      }
    });
    session2.status = 'confirmed';
    session2.fundedTxHex = fundingTx.toHex();
    const bitcoinFail = {
      async _makeRPCRequest (method) {
        if (method === 'getblockchaininfo') return { blocks: 200 };
        if (method === 'sendrawtransaction') throw new Error('reject');
        return null;
      }
    };
    const failEx = new CliDocumentExchange({
      getPeer: () => ({ settings: {}, key: { private: buyerPriv } }),
      getBitcoin: () => bitcoinFail,
      getNetworkName: () => 'regtest'
    });
    failEx.purchaseSessions.set(session2.settlementId, session2);
    const failed = await failEx.refund(session2.settlementId, destAddr, 1000);
    assert.ok(!failed.ok);
    assert.match(failed.error, /broadcast failed/);
    assert.ok(session2.refundTxHex && session2.refundTxHex.length > 100);
  });

  it('confirm wires blobTransfers.expectTransfer when merkle root present', async function () {
    const expected = [];
    const session = createDocumentPurchaseSession({
      documentId: 'doc-blob',
      seller: 'seller:1',
      contentHashHex: 'cd'.repeat(32),
      amountSats: 0,
      paymentAddress: '',
      network: 'regtest',
      blobIndex: 0,
      blobTotal: 2,
      blobHashHex: 'ce'.repeat(32),
      merkleRootHex: 'cf'.repeat(32)
    });
    const peer = {
      settings: {},
      blobTransfers: {
        expectTransfer (row) { expected.push(row); }
      },
      requestDocument () { return true; }
    };
    const exchange = new CliDocumentExchange({
      getPeer: () => peer,
      getBitcoin: () => ({
        async _makeRPCRequest (method) {
          if (method === 'getrawtransaction') return '00';
          return null;
        }
      }),
      getSettings: () => ({})
    });
    exchange.purchaseSessions.set(session.settlementId, session);
    const ok = await exchange.confirm(session.settlementId, 'af'.repeat(32));
    assert.ok(ok.ok, ok.error);
    assert.strictEqual(expected.length, 1);
    assert.strictEqual(expected[0].merkleRootHex, 'cf'.repeat(32));
    assert.strictEqual(session.status, 'delivery_pending');
  });
});
