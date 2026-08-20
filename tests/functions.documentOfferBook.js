'use strict';

const assert = require('assert');
const { DocumentOfferBook } = require('../functions/documentMarket');
const {
  splitBlobs,
  verifyBlob,
  reassemble,
  blobPaymentHashHex
} = require('../functions/documentBlobManifest');
const {
  computeRelayFee,
  buildForwardedDocumentRequest,
  assertMonotoneBudget
} = require('../functions/documentMarket');
const { createDocumentPurchaseSession } = require('../functions/documentMarket');

describe('documentOfferBook + blobs + relay', function () {
  it('ranks cheaper faster higher-score offers first', function () {
    const book = new DocumentOfferBook();
    book.ingestInventoryResponse({
      origin: 'a:1',
      peerScore: 900,
      latencyMs: 20,
      items: [{ id: 'doc1', rateSats: 100, contentHash: 'aa'.repeat(32) }]
    });
    book.ingestInventoryResponse({
      origin: 'b:2',
      peerScore: 100,
      latencyMs: 200,
      items: [{ id: 'doc1', rateSats: 90, contentHash: 'aa'.repeat(32) }]
    });
    book.ingestInventoryResponse({
      origin: 'c:3',
      peerScore: 800,
      latencyMs: 30,
      items: [{ id: 'doc1', rateSats: 100, contentHash: 'aa'.repeat(32) }]
    });
    const best = book.pickBest('doc1');
    assert.ok(best);
    // High score + low latency should beat slightly cheaper sybil.
    assert.ok(best.sellerAddress === 'a:1' || best.sellerAddress === 'c:3');
    assert.ok(book.pickBest('missing') == null);
    const cheap = book.pickBest('doc1', { maxSats: 95 });
    assert.ok(cheap && cheap.sellerAddress === 'b:2');
    const excluded = book.pickBest('doc1', { excludeSellers: ['b:2', 'a:1'] });
    assert.ok(excluded && excluded.sellerAddress === 'c:3');
  });

  it('prefers high peerScore over equal-price zero-score sybil', function () {
    const book = new DocumentOfferBook();
    book.ingestInventoryResponse({
      origin: 'honest:1',
      peerScore: 900,
      latencyMs: 15,
      items: [{ id: 'x', rateSats: 100, contentHash: 'cd'.repeat(32) }]
    });
    book.ingestInventoryResponse({
      origin: 'sybil:1',
      peerScore: 0,
      latencyMs: 15,
      items: [{ id: 'x', rateSats: 100, contentHash: 'cd'.repeat(32) }]
    });
    const best = book.pickBest('x');
    assert.ok(best && best.sellerAddress === 'honest:1');
  });

  it('splitBlobs verify and reassemble', function () {
    const data = Buffer.alloc(3000, 7);
    const { blobs, merkleRootHex } = splitBlobs(data, 1000);
    assert.strictEqual(blobs.length, 3);
    for (const b of blobs) {
      assert.ok(verifyBlob(b.bytes, b.blobHashHex));
    }
    const map = new Map(blobs.map((b) => [b.index, b.bytes]));
    const out = reassemble(map, 3, merkleRootHex);
    assert.strictEqual(out.ok, true);
    assert.ok(out.buffer.equals(data));
    assert.ok(!verifyBlob(Buffer.from('x'), blobs[0].blobHashHex));
    const pay = blobPaymentHashHex({
      documentId: 'd1',
      blobIndex: 0,
      blobHashHex: blobs[0].blobHashHex
    });
    assert.strictEqual(pay.length, 64);
  });

  it('relay fee monotone rewrite', function () {
    const fee = computeRelayFee({ documentRelayFeeSats: 10, documentRelayMinRemainingSats: 1 }, 100);
    assert.strictEqual(fee.ok, true);
    assert.strictEqual(fee.feeSats, 10);
    assert.strictEqual(fee.maxSatsOut, 90);
    assert.ok(assertMonotoneBudget(100, 90));
    const fwd = buildForwardedDocumentRequest(
      { document: 'doc', maxSats: 100, relayHop: 3 },
      { documentRelayFeeSats: 5, documentRelayMaxHops: 4 }
    );
    assert.strictEqual(fwd.ok, true);
    assert.strictEqual(fwd.body.maxSats, 95);
    assert.strictEqual(fwd.body.relayHop, 2);
    assert.ok(fwd.body.routeId);
    assert.ok(!('buyerFabricId' in fwd.body));
  });

  it('createDocumentPurchaseSession', function () {
    const s = createDocumentPurchaseSession({
      documentId: 'd',
      seller: 'p:1',
      contentHashHex: 'ab'.repeat(32),
      amountSats: 1000,
      paymentAddress: 'bcrt1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
      network: 'regtest'
    });
    assert.ok(s.settlementId);
    assert.strictEqual(s.amountSats, 1000);
  });

  it('pickBlobPlan diversifies unsealed sellers but locks sealed to one seller', function () {
    const book = new DocumentOfferBook();
    book.ingestInventoryResponse({
      origin: 'seller-a',
      peerScore: 500,
      latencyMs: 10,
      items: [{
        id: 'unsealed-doc',
        rateSats: 20,
        contentHash: 'aa'.repeat(32),
        sealed: false,
        blobs: [
          { index: 0, total: 2, blobHashHex: 'b1'.repeat(32), rateSats: 10, contentHash: 'c1'.repeat(32) },
          { index: 1, total: 2, blobHashHex: 'b2'.repeat(32), rateSats: 10, contentHash: 'c2'.repeat(32) }
        ]
      }]
    });
    book.ingestInventoryResponse({
      origin: 'seller-b',
      peerScore: 500,
      latencyMs: 10,
      items: [{
        id: 'unsealed-doc',
        rateSats: 20,
        contentHash: 'aa'.repeat(32),
        sealed: false,
        blobs: [
          { index: 0, total: 2, blobHashHex: 'b1'.repeat(32), rateSats: 10, contentHash: 'c1'.repeat(32) },
          { index: 1, total: 2, blobHashHex: 'b2'.repeat(32), rateSats: 10, contentHash: 'c2'.repeat(32) }
        ]
      }]
    });
    const unsealed = book.pickBlobPlan('unsealed-doc', 2);
    assert.strictEqual(unsealed.size, 2);
    const sellersUnsealed = new Set([
      String(unsealed.get(0).sellerAddress),
      String(unsealed.get(1).sellerAddress)
    ]);
    assert.strictEqual(sellersUnsealed.size, 2, 'unsealed plan should diversify sellers');

    const sealedBook = new DocumentOfferBook();
    sealedBook.ingestInventoryResponse({
      origin: 'seal-a',
      peerScore: 900,
      latencyMs: 5,
      items: [{
        id: 'sealed-doc',
        rateSats: 100,
        contentHash: 'dd'.repeat(32),
        sealed: true,
        blobs: [
          { index: 0, total: 2, blobHashHex: 'e1'.repeat(32), rateSats: 50 },
          { index: 1, total: 2, blobHashHex: 'e2'.repeat(32), rateSats: 50 }
        ]
      }]
    });
    sealedBook.ingestInventoryResponse({
      origin: 'seal-b',
      peerScore: 900,
      latencyMs: 5,
      items: [{
        id: 'sealed-doc',
        rateSats: 90,
        contentHash: 'dd'.repeat(32),
        sealed: true,
        blobs: [
          { index: 0, total: 2, blobHashHex: 'e1'.repeat(32), rateSats: 45 },
          { index: 1, total: 2, blobHashHex: 'e2'.repeat(32), rateSats: 45 }
        ]
      }]
    });
    const sealed = sealedBook.pickBlobPlan('sealed-doc', 2);
    assert.strictEqual(sealed.size, 2);
    assert.strictEqual(
      String(sealed.get(0).sellerAddress),
      String(sealed.get(1).sellerAddress),
      'sealed plan must keep a single seller for all blobs'
    );
    assert.strictEqual(sealed.get(0).sealed, true);
  });

  it('updates the same origin when a seller reprices (inventory snapshot)', function () {
    const book = new DocumentOfferBook();
    const hash = 'aa'.repeat(32);
    book.ingestInventoryResponse({
      origin: 'relay:7',
      peerScore: 500,
      latencyMs: 10,
      items: [{ id: 'doc1', rateSats: 100, contentHash: hash }]
    });
    book.ingestInventoryResponse({
      origin: 'relay:7',
      peerScore: 500,
      latencyMs: 10,
      items: [{ id: 'doc1', rateSats: 110, contentHash: hash }]
    });
    const best = book.pickBest('doc1');
    assert.ok(best);
    assert.strictEqual(best.sellerAddress, 'relay:7');
    const rate = Number(best.rateSats != null ? best.rateSats : best.purchasePriceSats);
    assert.strictEqual(rate, 110);
  });

  it('Hub-style 10% listing markup covers a 10% relay skim on origin cost', function () {
    const origin = 100;
    let hubList = 110;
    try {
      const path = require('path');
      const market = require(path.join(__dirname, '..', '..', 'hub.fabric.pub', 'functions', 'documentInventoryMarket'));
      hubList = market.markupListPrice(origin, { markupBps: 1000, markupSats: 0 });
    } catch (_) {
      hubList = Math.ceil((origin * 11000) / 10000);
    }
    assert.strictEqual(hubList, 110);
    const fee = computeRelayFee({ documentRelayFeeBps: 1000 }, origin);
    assert.strictEqual(fee.ok, true);
    assert.strictEqual(fee.feeSats, 10);
    assert.ok(hubList - origin >= fee.feeSats, 'republish spread should cover a same-bps hop fee');
  });

  it('does not keep peer contentBase64 or costBasis on ranked offers', function () {
    const book = new DocumentOfferBook();
    book.ingestInventoryResponse({
      origin: 'seller:1',
      peerScore: 400,
      latencyMs: 20,
      items: [{
        id: 'doc-leak',
        rateSats: 25,
        contentHash: '11'.repeat(32),
        contentBase64: Buffer.from('secret').toString('base64'),
        costBasisSats: 1
      }]
    });
    const offers = book.listOffers({ documentId: 'doc-leak' });
    assert.strictEqual(offers.length, 1);
    assert.strictEqual(offers[0].rateSats, 25);
    assert.strictEqual(offers[0].contentBase64, undefined);
    assert.strictEqual(offers[0].costBasisSats, undefined);
  });

  it('skips inventory items without an id and filters listOffers by blobIndex', function () {
    const book = new DocumentOfferBook();
    book.ingestInventoryResponse({
      origin: 'seller:1',
      items: [
        { rateSats: 1 },
        {
          id: 'blob-doc',
          rateSats: 40,
          contentHash: '22'.repeat(32),
          blobs: [
            { index: 0, total: 2, blobHashHex: 'b0'.repeat(32), rateSats: 10 },
            { index: 1, total: 2, blobHashHex: 'b1'.repeat(32), rateSats: 30 }
          ]
        }
      ]
    });
    assert.strictEqual(book.listOffers({ documentId: '' }).filter((o) => !o.documentId).length, 0);
    assert.strictEqual(book.listOffers({ documentId: 'blob-doc' }).length, 2);
    assert.strictEqual(book.listOffers({ documentId: 'blob-doc', blobIndex: 1 }).length, 1);
    assert.strictEqual(book.listOffers({ documentId: 'blob-doc', blobIndex: 1 })[0].rateSats, 30);
  });
});
