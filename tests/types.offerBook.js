'use strict';

const assert = require('assert');
const DocumentOfferBook = require('../types/offerBook');
const { TELEMETRY_TYPE } = require('../types/offerBook');
const market = require('../functions/documentMarket');

const H = (c) => String(c).repeat(32);

describe('types/offerBook (chunk index + local telemetry)', function () {
  it('is the same class re-exported from functions/documentMarket', function () {
    assert.strictEqual(market.DocumentOfferBook, DocumentOfferBook);
    assert.strictEqual(market.DEFAULT_WEIGHTS, DocumentOfferBook.DEFAULT_WEIGHTS);
  });

  it('applies locally measured RTT and delivery outcomes when the caller supplies none', function () {
    const book = new DocumentOfferBook();
    const items = [{ id: 'doc', rateSats: 10, contentHash: H('aa'), blobs: [
      { index: 0, total: 1, blobHashHex: H('b0'), rateSats: 10 }
    ] }];
    book.ingestInventoryResponse({ origin: 'fast', items, latencyMs: 10 });
    book.ingestInventoryResponse({ origin: 'slow', items, latencyMs: 400 });
    book.recordDelivery('fast', { ok: true, latencyMs: 30, bytes: 1000 });
    book.recordDelivery('slow', { ok: false });
    book.recordDelivery('slow', { ok: false });
    // Re-ingest without caller telemetry: stats must flow onto the rows.
    book.ingestInventoryResponse({ origin: 'fast', items });
    book.ingestInventoryResponse({ origin: 'slow', items });
    const best = book.pickBest('doc');
    assert.strictEqual(best.sellerAddress, 'fast');
    assert.ok(book.scoreFor('fast') > book.scoreFor('slow'));
    assert.strictEqual(book.scoreFor('slow'), 0);
    assert.strictEqual(book.scoreFor('unknown'), 0);
    const stats = book.providerStats('fast');
    assert.strictEqual(stats.deliveries, 1);
    assert.strictEqual(stats.bytesDelivered, 1000);
    assert.ok(stats.latencyMs > 0);
  });

  it('penalties and refunds lower the score; hops add latency', function () {
    const book = new DocumentOfferBook({ hopPenaltyMs: 100 });
    book.recordDelivery('p', { ok: true });
    book.recordDelivery('p', { ok: true });
    const before = book.scoreFor('p');
    book.recordPenalty('p', { kind: 'WrongLeaf' });
    assert.ok(book.scoreFor('p') < before);
    book.recordRefund('p');
    assert.strictEqual(book.providerStats('p').refunds, 1);
    assert.strictEqual(book.providerStats('p').lastPenaltyKind, 'WrongLeaf');
    book.recordInventoryLatency('far', 20, { hops: 3 });
    assert.strictEqual(book.latencyFor('far'), 20 + 300);
  });

  it('indexes offers by blob hash and ranks providers per chunk', function () {
    const book = new DocumentOfferBook();
    const blobs = [
      { index: 0, total: 2, blobHashHex: H('c0'), rateSats: 5, contentHash: H('d0') },
      { index: 1, total: 2, blobHashHex: H('c1'), rateSats: 5, contentHash: H('d1') }
    ];
    book.ingestInventoryResponse({ origin: 'a', latencyMs: 5, items: [{ id: 'doc', merkleRootHex: H('ee'), blobs }] });
    book.ingestInventoryResponse({ origin: 'b', latencyMs: 500, items: [{ id: 'doc', merkleRootHex: H('ee'), blobs: [blobs[1]] }] });
    const idx = book.indexByBlobHash({ merkleRootHex: H('ee') });
    assert.strictEqual(idx.size, 2);
    assert.strictEqual(idx.get(H('c0')).length, 1);
    assert.strictEqual(idx.get(H('c1')).length, 2);
    assert.strictEqual(idx.get(H('c1'))[0].sellerAddress, 'a');
    assert.strictEqual(book.providersForBlob(H('c1'))[0].sellerAddress, 'a');
    assert.strictEqual(book.listOffers({ merkleRootHex: H('ff') }).length, 0);
    assert.strictEqual(book.listOffers({ blobHashHex: H('c0') }).length, 1);
    assert.strictEqual(book.forgetSeller('b'), 1);
    assert.strictEqual(book.listOffers({ blobHashHex: H('c1') }).length, 1);
  });

  it('splits per-blob sealed trees across sellers but locks legacy single-key seals', function () {
    const perBlob = new DocumentOfferBook();
    const mk = (origin, price) => perBlob.ingestInventoryResponse({
      origin,
      latencyMs: 10,
      items: [{ id: 'sealed', sealed: true, rateSats: price * 2, blobs: [
        { index: 0, total: 2, blobHashHex: H('e0'), rateSats: price, contentHash: H('f0') },
        { index: 1, total: 2, blobHashHex: H('e1'), rateSats: price, contentHash: H('f1') }
      ] }]
    });
    mk('s1', 10);
    mk('s2', 10);
    const plan = perBlob.pickBlobPlan('sealed', 2);
    const sellers = new Set([plan.get(0).sellerAddress, plan.get(1).sellerAddress]);
    assert.strictEqual(sellers.size, 2, 'per-blob keys allow multi-seller plans');
    const groups = perBlob.groupPlanBySeller(plan);
    assert.strictEqual(groups.length, 2);
    assert.strictEqual(groups[0].totalSats, 10);

    const legacy = new DocumentOfferBook();
    const mkLegacy = (origin) => legacy.ingestInventoryResponse({
      origin,
      latencyMs: 10,
      items: [{ id: 'legacy', sealed: true, rateSats: 20, contentHash: H('dd'), blobs: [
        { index: 0, total: 2, blobHashHex: H('e0'), rateSats: 10 },
        { index: 1, total: 2, blobHashHex: H('e1'), rateSats: 10 }
      ] }]
    });
    mkLegacy('l1');
    mkLegacy('l2');
    const lp = legacy.pickBlobPlan('legacy', 2);
    assert.strictEqual(lp.get(0).sellerAddress, lp.get(1).sellerAddress);
  });

  it('exports and re-imports a versioned telemetry record', function () {
    const a = new DocumentOfferBook();
    a.recordInventoryLatency('x', 40);
    a.recordDelivery('x', { ok: true, bytes: 10 });
    a.recordDelivery('y', { ok: false });
    const rec = a.exportTelemetry();
    assert.strictEqual(rec.type, TELEMETRY_TYPE);
    assert.strictEqual(rec.version, 1);
    assert.strictEqual(rec.providers.length, 2);
    assert.strictEqual(rec.hash.length, 64);
    const b = new DocumentOfferBook();
    assert.strictEqual(b.importTelemetry(rec), 2);
    assert.strictEqual(b.providerStats('x').deliveries, 1);
    assert.strictEqual(b.providerStats('x').inventoryLatencyMs, 40);
    assert.strictEqual(b.importTelemetry({ type: 'nope' }), 0);
  });
});
