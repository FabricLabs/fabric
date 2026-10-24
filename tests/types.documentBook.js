'use strict';

const assert = require('assert');
const Book = require('../types/book');
const DocumentBook = require('../types/documentBook');
const { TELEMETRY_TYPE } = require('../types/documentBook');
const { merkleRootHexFromBlobHashes, documentMerkleRootHex } = require('../functions/documentBlobManifest');

const H = (c) => String(c).repeat(32);

describe('types/documentBook (chunk index + local telemetry)', function () {
  it('is a Book', function () {
    assert.ok(new DocumentBook() instanceof Book);
    assert.strictEqual(DocumentBook.DocumentBook, DocumentBook);
  });

  it('applies locally measured RTT and delivery outcomes when the caller supplies none', function () {
    const book = new DocumentBook();
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
    const book = new DocumentBook({ hopPenaltyMs: 100 });
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
    const book = new DocumentBook();
    const blobs = [
      { index: 0, total: 2, blobHashHex: H('c0'), rateSats: 5, contentHash: H('d0') },
      { index: 1, total: 2, blobHashHex: H('c1'), rateSats: 5, contentHash: H('d1') }
    ];
    const root = documentMerkleRootHex(blobs.map((b) => ({ blobHashHex: b.blobHashHex, paymentHashHex: b.contentHash })));
    book.ingestInventoryResponse({ origin: 'a', latencyMs: 5, items: [{ id: 'doc', sealed: true, merkleRootHex: root, blobs }] });
    // A subset without inclusion proofs cannot be checked: kept, unverified.
    const partial = book.ingestInventoryResponse({ origin: 'b', latencyMs: 500, items: [{ id: 'doc', sealed: true, merkleRootHex: root, blobs: [blobs[1]] }] });
    assert.strictEqual(partial[0].rootVerified, false);
    const idx = book.indexByBlobHash({ merkleRootHex: root });
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

  it('verifies an unsealed advertisement against its root (tagged hashes stay outside the tree)', function () {
    const { advertiseDocumentBlobs } = require('../functions/documentBlobManifest');
    const advertised = advertiseDocumentBlobs(Buffer.alloc(5000, 3), { documentId: 'plain', chunkBytes: 2048, rateSats: 30 });
    assert.ok(advertised.itemBlobs.every((b) => /^[0-9a-f]{64}$/.test(b.contentHash)));
    const book = new DocumentBook();
    const rows = book.ingestInventoryResponse({
      origin: 'seller',
      items: [{ id: 'plain', rateSats: 30, merkleRootHex: advertised.merkleRootHex, blobs: advertised.itemBlobs }]
    });
    assert.strictEqual(rows.length, advertised.itemBlobs.length);
    assert.ok(rows.every((r) => r.rootVerified === true));
    assert.strictEqual(rows[1].contentHashHex, advertised.itemBlobs[1].contentHash);
  });

  it('splits per-blob sealed trees across sellers but locks whole-document seals', function () {
    const perBlob = new DocumentBook();
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

    const whole = new DocumentBook();
    const mkWhole = (origin) => whole.ingestInventoryResponse({
      origin,
      latencyMs: 10,
      items: [{ id: 'whole', sealed: true, rateSats: 20, contentHash: H('dd'), blobs: [
        { index: 0, total: 2, blobHashHex: H('e0'), rateSats: 10 },
        { index: 1, total: 2, blobHashHex: H('e1'), rateSats: 10 }
      ] }]
    });
    mkWhole('w1');
    mkWhole('w2');
    const lp = whole.pickBlobPlan('whole', 2);
    assert.strictEqual(lp.get(0).sellerAddress, lp.get(1).sellerAddress);
  });

  it('exports and re-imports a versioned telemetry record', function () {
    const a = new DocumentBook();
    a.recordInventoryLatency('x', 40);
    a.recordDelivery('x', { ok: true, bytes: 10 });
    a.recordDelivery('y', { ok: false });
    const rec = a.exportTelemetry();
    assert.strictEqual(rec.type, TELEMETRY_TYPE);
    assert.strictEqual(rec.version, 2);
    assert.strictEqual(rec.providers.length, 2);
    assert.strictEqual(rec.hash.length, 64);
    const b = new DocumentBook();
    assert.strictEqual(b.importTelemetry(rec), 2);
    assert.strictEqual(b.providerStats('x').deliveries, 1);
    assert.strictEqual(b.providerStats('x').inventoryLatencyMs, 40);
    assert.strictEqual(b.importTelemetry({ type: 'nope' }), 0);
  });

  it('rejects a resale whose root does not commit the payment hashes it lists', function () {
    const leaves = [0, 1].map((i) => ({
      index: i,
      total: 2,
      blobHashHex: H(`c${i}`),
      paymentHashHex: H(`d${i}`),
      iv: Buffer.alloc(12, i + 1).toString('base64')
    }));
    const root = documentMerkleRootHex(leaves);
    const bare = merkleRootHexFromBlobHashes(leaves.map((l) => l.blobHashHex));
    const forged = leaves.map((l, i) => Object.assign({}, l, { paymentHashHex: H(`e${i}`), rateSats: 1 }));
    const book = new DocumentBook();
    book.ingestInventoryResponse({ origin: 'publisher', latencyMs: 400, items: [{ id: 'doc', sealed: true, merkleRootHex: root, blobs: leaves.map((l) => Object.assign({ rateSats: 900 }, l)) }] });
    // Claiming the bare (unsealed) root still needs the tagged per-blob hashes.
    assert.strictEqual(book.ingestInventoryResponse({ origin: 'reseller', latencyMs: 5, items: [{ id: 'doc', merkleRootHex: bare, blobs: forged }] }).length, 0);
    assert.strictEqual(book.ingestInventoryResponse({ origin: 'reseller', latencyMs: 5, items: [{ id: 'doc', merkleRootHex: root, blobs: forged }] }).length, 0);
    assert.strictEqual(book.ingestInventoryResponse({ origin: 'reseller', latencyMs: 5, items: [{ id: 'doc', sealed: true, merkleRootHex: root, blobs: forged }] }).length, 0);
    assert.strictEqual(book.pickBest('doc').sellerAddress, 'publisher');
    assert.ok(Array.from(book.pickBlobPlan('doc', 2).values()).every((o) => o.sellerAddress === 'publisher'));
  });
});
