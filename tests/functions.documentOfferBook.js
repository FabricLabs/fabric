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
});
