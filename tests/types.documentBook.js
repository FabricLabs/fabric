'use strict';

const assert = require('assert');
const Book = require('../types/book');
const DocumentBook = require('../types/documentBook');
const { TELEMETRY_TYPE } = require('../types/documentBook');
const Document = require('../types/document');
const crypto = require('crypto');
const Key = require('../types/key');
const Message = require('../types/message');
const Peer = require('../types/peer');
const { P2P_DOCUMENT_BID, P2P_DOCUMENT_ASK, DOCUMENT_BID_MAX_TTL_SECONDS, DOCUMENT_BID_MAX_RELAYS_PER_ORIGIN_PER_MINUTE, PEER_MAX_ASKS_PER_DOCUMENT_BID } = require('../constants');
const { lookupGossipType, isRelayAsIsWireType, isFirstClassOpcodeOnlyType } = require('../functions/gossipNetwork');
const { offlinePeerSettings, waitUntil, getFreePort } = require('./helpers/peer');
const { createDocumentPurchaseSession, isDuplicateSettlement, rememberSettlement } = require('../types/documentBook');
const DocumentBlobTransferBook = require('../types/documentBlobTransferBook');
const { MAX_DOCUMENT_BLOBS } = require('../constants');
const Market = require('../services/market');
const { DOCUMENT_L1_BATCH_BLOBS } = require('../constants');
const { createBlobBatch, openBlobBatch } = require('../functions/documentSealedExchange');
const { BLOB_QUOTE_TYPE, wrapBlobKey, unwrapBlobKey, createBlobQuote, isWellFormedBlobQuote, checkBlobQuote, paymentHashHexFromKey, advertiseSealedDocument, prepareSealedSale } = require('../functions/documentSealedExchange');

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
    const root = Document.rootHex(blobs.map((b) => ({ blobHashHex: b.blobHashHex, paymentHashHex: b.contentHash })));
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
    const advertised = Document.advertise(Buffer.alloc(5000, 3), { documentId: 'plain', chunkBytes: 2048, rateSats: 30 });
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
    const root = Document.rootHex(leaves);
    const bare = Document.rootHexFromBlobHashes(leaves.map((l) => l.blobHashHex));
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

  it('ingests a producer advertisement and pays only hashes its root commits', function () {
    const ad = Document.advertise(Buffer.alloc(3000, 7), { documentId: 'doc', chunkBytes: 1024, rateSats: 30 });
    const book = new DocumentBook();
    const rows = book.ingestInventoryResponse({ origin: 'publisher', items: [{ id: 'doc', merkleRootHex: ad.merkleRootHex, blobs: ad.itemBlobs }] });
    assert.strictEqual(rows.length, ad.itemBlobs.length);
    assert.ok(rows.every((r) => r.rootVerified === true));

    // Leaves without their own payment hash, plus a stray item-level hash:
    // the rows must carry the tagged hash of each committed leaf.
    const bare = ad.itemBlobs.map((b) => ({ index: b.index, total: b.total, blobHashHex: b.blobHashHex, size: b.size }));
    const relisted = new DocumentBook().ingestInventoryResponse({ origin: 'reseller', items: [{ id: 'doc', contentHash: H('ee'), merkleRootHex: ad.merkleRootHex, blobs: bare }] });
    assert.strictEqual(relisted.length, bare.length);
    for (const r of relisted) {
      assert.strictEqual(r.rootVerified, true);
      assert.strictEqual(r.contentHashHex, Document.blobPaymentHash({ documentId: 'doc', blobIndex: r.blobIndex, blobHashHex: r.blobHashHex }));
    }
  });

  it('never picks a paid unsealed offer while a sealed one is listed', function () {
    const ad = Document.advertise(Buffer.alloc(3000, 7), { documentId: 'doc', chunkBytes: 1024, rateSats: 1 });
    const sealed = [0, 1, 2].map((i) => ({ index: i, total: 3, blobHashHex: H(`c${i}`), paymentHashHex: H(`d${i}`), iv: Buffer.alloc(12, i + 1).toString('base64') }));
    const root = Document.rootHex(sealed);
    const book = new DocumentBook();
    book.ingestInventoryResponse({ origin: 'publisher', latencyMs: 400, items: [{ id: 'doc', sealed: true, merkleRootHex: root, blobs: sealed.map((b) => Object.assign({ rateSats: 900 }, b)) }] });
    book.ingestInventoryResponse({ origin: 'cheap', latencyMs: 5, items: [{ id: 'doc', rateSats: 1, merkleRootHex: ad.merkleRootHex, blobs: ad.itemBlobs }] });
    assert.strictEqual(book.pickBest('doc', { blobIndex: 0 }).sellerAddress, 'publisher');
    assert.ok(Array.from(book.pickBlobPlan('doc', 3).values()).every((o) => o.sellerAddress === 'publisher'));

    // A free unsealed copy costs the buyer nothing, so it may still win.
    const free = new DocumentBook();
    free.ingestInventoryResponse({ origin: 'publisher', latencyMs: 400, items: [{ id: 'doc', sealed: true, merkleRootHex: root, blobs: sealed.map((b) => Object.assign({ rateSats: 900 }, b)) }] });
    free.ingestInventoryResponse({ origin: 'mirror', latencyMs: 5, items: [{ id: 'doc', rateSats: 0, merkleRootHex: ad.merkleRootHex, blobs: ad.itemBlobs.map((b) => Object.assign({}, b, { rateSats: 0 })) }] });
    assert.strictEqual(free.pickBest('doc', { blobIndex: 0 }).sellerAddress, 'mirror');

    // paidSealedOnly drops paid unsealed offers even with no sealed one listed.
    const alone = new DocumentBook();
    alone.ingestInventoryResponse({ origin: 'cheap', latencyMs: 5, items: [{ id: 'doc', rateSats: 1, merkleRootHex: ad.merkleRootHex, blobs: ad.itemBlobs }] });
    assert.strictEqual(alone.pickBest('doc', { blobIndex: 0 }).sellerAddress, 'cheap');
    assert.strictEqual(alone.pickBest('doc', { blobIndex: 0, paidSealedOnly: true }), null);
    assert.strictEqual(alone.pickBlobPlan('doc', 3, { paidSealedOnly: true }).size, 0);
  });
});

const ROOT = 'aa'.repeat(32);

const LEAF = 'bb'.repeat(32);

const now = () => Math.floor(Date.now() / 1000);

/** Fake connections recording what the Peer writes to each. */
function wire (peer, names) {
  const writes = {};
  for (const name of names) {
    writes[name] = [];
    peer.connections[name] = {
      _writeFabric (buf) { writes[name].push(Message.fromBuffer(Buffer.from(buf))); },
      destroy () {}
    };
  }
  return writes;
}

/** A seller Peer holding one per-blob sealed document. */
function sellerWith (settings = {}) {
  const peer = new Peer(offlinePeerSettings(settings));
  const doc = Document.seal(crypto.randomBytes(5000), { chunkBytes: 2048 });
  const { documentId } = peer.publishSealedDocument(doc, { rateSats: 800 });
  return { peer, doc, documentId };
}

describe('@fabric/core chunk bids (P2P_DOCUMENT_BID / P2P_DOCUMENT_ASK)', function () {
  describe('catalog', function () {
    it('bids flood and asks are directed, both first-class and relayed as signed', function () {
      const order = new Map(Message.WIRE_TYPE_DECODE_ORDER.map(([opcode, name]) => [name, opcode]));
      assert.strictEqual(order.get('P2P_DOCUMENT_BID'), P2P_DOCUMENT_BID);
      assert.strictEqual(order.get('P2P_DOCUMENT_ASK'), P2P_DOCUMENT_ASK);
      assert.strictEqual(lookupGossipType(P2P_DOCUMENT_BID).name, 'P2P_DOCUMENT_BID');
      assert.strictEqual(lookupGossipType('DocumentBid').policy, 'flood');
      assert.strictEqual(lookupGossipType('P2P_DOCUMENT_ASK').policy, 'directed');
      for (const t of ['P2P_DOCUMENT_BID', 'P2P_DOCUMENT_ASK']) {
        assert.strictEqual(isRelayAsIsWireType(t), true);
        assert.strictEqual(isFirstClassOpcodeOnlyType(t), true);
      }
    });
  });

  describe('DocumentBook statics', function () {
    it('round-trips a bid through the wire with open selectors as null', function () {
      const { message, bid } = DocumentBook.createBid({ documentId: 'doc-1', blobIndex: 4, maxSats: 1500, ttlSeconds: 120 });
      const back = Message.fromBuffer(message.toBuffer());
      assert.strictEqual(back.type, 'P2P_DOCUMENT_BID');
      const read = DocumentBook.readBid(back);
      assert.ok(read.ok, read.error);
      assert.deepStrictEqual(read.bid, bid);
      assert.strictEqual(bid.merkleRootHex, null);
      assert.strictEqual(bid.blobHashHex, null);
      assert.strictEqual(bid.maxSats, 1500);
      assert.ok(bid.expiresAt - now() <= 120);
      assert.strictEqual(bid.id, DocumentBook.bidId(back));
    });

    it('signs each bid with a fresh key unless one is given', function () {
      const a = DocumentBook.createBid({ documentId: 'd', blobIndex: 0, maxSats: 1 });
      const b = DocumentBook.createBid({ documentId: 'd', blobIndex: 0, maxSats: 1 });
      assert.notStrictEqual(a.bid.author, b.bid.author);
      const key = new Key();
      const c = DocumentBook.createBid({ documentId: 'd', blobIndex: 0, maxSats: 1, key });
      assert.strictEqual(c.bid.author, c.message.author);
    });

    it('binds the bid id to its author, so a re-signed copy is another bid', function () {
      const { message, bid } = DocumentBook.createBid({ documentId: 'd', blobIndex: 0, maxSats: 5 });
      const copy = Message.fromBuffer(message.toBuffer());
      copy.signWithKey(new Key());
      const read = DocumentBook.readBid(copy);
      assert.ok(read.ok);
      assert.notStrictEqual(read.bid.id, bid.id);
    });

    it('refuses bad bids', function () {
      assert.throws(() => DocumentBook.createBid({ documentId: '', blobIndex: 0, maxSats: 1 }), /documentId/);
      assert.throws(() => DocumentBook.createBid({ documentId: 'd', blobIndex: -1, maxSats: 1 }), /blobIndex/);
      assert.throws(() => DocumentBook.createBid({ documentId: 'd', blobIndex: 0, maxSats: 0 }), /maxSats/);
      assert.throws(() => DocumentBook.createBid({ documentId: 'd', blobIndex: 0, maxSats: 1, merkleRootHex: 'xy' }), /merkleRootHex/);
      assert.throws(() => DocumentBook.createBid({ documentId: 'd', blobIndex: 0, maxSats: 1, ttlSeconds: DOCUMENT_BID_MAX_TTL_SECONDS + 1 }), /ttlSeconds/);

      const { message } = DocumentBook.createBid({ documentId: 'd', blobIndex: 0, maxSats: 1, ttlSeconds: 60 });
      assert.strictEqual(DocumentBook.readBid(message, { now: now() + 61 }).error, 'expired');
      assert.strictEqual(DocumentBook.readBid(message, { now: now() - 2 * DOCUMENT_BID_MAX_TTL_SECONDS }).error, 'expires too far ahead');

      const tampered = message.toBuffer();
      tampered[tampered.length - 1] ^= 1;
      assert.notStrictEqual(DocumentBook.readBid(tampered).ok, true);

      const forged = Message.fromBuffer(message.toBuffer());
      forged.raw.signature = Buffer.alloc(64, 7);
      assert.strictEqual(DocumentBook.readBid(forged).error, 'signature invalid');
      assert.strictEqual(DocumentBook.readBid(Message.fromVector(['P2P_PING', ''])).ok, false);
    });

    it('builds an ask within the bid and checks it against the bid', function () {
      const { bid } = DocumentBook.createBid({ documentId: 'doc', blobIndex: 2, maxSats: 1000, merkleRootHex: ROOT });
      const seller = new Key();
      const { message, ask } = DocumentBook.createAsk(bid, { key: seller, merkleRootHex: ROOT, blobHashHex: LEAF, priceSats: 900 });
      const read = DocumentBook.readAsk(Message.fromBuffer(message.toBuffer()), { bid });
      assert.ok(read.ok, read.error);
      assert.deepStrictEqual(read.ask, ask);
      assert.strictEqual(ask.seller, message.author);
      assert.strictEqual(ask.bidId, bid.id);
      assert.strictEqual(ask.expiresAt, bid.expiresAt);

      assert.throws(() => DocumentBook.createAsk(bid, { key: seller, merkleRootHex: ROOT, blobHashHex: LEAF, priceSats: 1001 }), /price over the bid/);
      assert.throws(() => DocumentBook.createAsk(bid, { key: seller, merkleRootHex: LEAF, blobHashHex: LEAF, priceSats: 1 }), /another document tree/);
      assert.throws(() => DocumentBook.createAsk(bid, { key: seller, merkleRootHex: ROOT, blobHashHex: LEAF, priceSats: 1, expiresAt: bid.expiresAt + 1 }), /outlives the bid/);
      assert.throws(() => DocumentBook.createAsk(bid, { merkleRootHex: ROOT, blobHashHex: LEAF, priceSats: 1 }), /seller key/);
    });

    it('refuses an ask for another bid or another chunk', function () {
      const one = DocumentBook.createBid({ documentId: 'doc', blobIndex: 2, maxSats: 1000 }).bid;
      const two = DocumentBook.createBid({ documentId: 'doc', blobIndex: 3, maxSats: 1000 }).bid;
      const { message } = DocumentBook.createAsk(one, { key: new Key(), merkleRootHex: ROOT, blobHashHex: LEAF, priceSats: 5 });
      assert.strictEqual(DocumentBook.readAsk(message, { bid: two }).error, 'answers another bid');
      const lied = Message.fromFields('P2P_DOCUMENT_ASK', {
        bid: one.id, document: 'doc', merkleRoot: ROOT, blobIndex: 3, blobHash: LEAF, priceSats: 5, expiresAt: one.expiresAt
      }).signWithKey(new Key());
      assert.strictEqual(DocumentBook.readAsk(lied, { bid: one }).error, 'names another chunk');
    });

    it('ranks asks in the book as offers for the chunk', function () {
      const book = new DocumentBook();
      const { bid } = DocumentBook.createBid({ documentId: 'doc', blobIndex: 0, maxSats: 1000 });
      const cheap = DocumentBook.createAsk(bid, { key: new Key(), merkleRootHex: ROOT, blobHashHex: LEAF, priceSats: 300 }).ask;
      const dear = DocumentBook.createAsk(bid, { key: new Key(), merkleRootHex: ROOT, blobHashHex: LEAF, priceSats: 900 }).ask;
      book.ingestAsk(dear, { origin: '127.0.0.1:1', latencyMs: 40 });
      const row = book.ingestAsk(cheap, { origin: '127.0.0.1:2', latencyMs: 40 });
      assert.strictEqual(row.bidId, bid.id);
      assert.strictEqual(row.sellerId, cheap.seller);
      const ranked = book.rankOffers(book.listOffers({ documentId: 'doc', blobIndex: 0 }));
      assert.strictEqual(ranked.length, 2);
      assert.strictEqual(ranked[0].rateSats, 300);
      assert.strictEqual(book.ingestAsk({}), null);
    });
  });

  describe('Peer (mocked connections)', function () {
    it('relay floods a bid bit-identical and routes the ask back only to the previous hop', function () {
      const relay = new Peer(offlinePeerSettings());
      const writes = wire(relay, ['buyer', 'seller', 'other']);
      const book = new DocumentBook();
      const { message, bid } = DocumentBook.createBid({ documentId: 'doc', blobIndex: 0, maxSats: 1000, book });
      const seen = [];
      relay.on('documentBid', (ev) => seen.push(ev));
      relay._handleFabricMessage(message.toBuffer(), { name: 'buyer' }, null);
      assert.strictEqual(seen.length, 1);
      assert.strictEqual(seen[0].routed, true);
      assert.strictEqual(writes.buyer.length, 0);
      for (const hop of ['seller', 'other']) {
        assert.strictEqual(writes[hop].length, 1);
        assert.ok(writes[hop][0].toBuffer().equals(message.toBuffer()), 'bit-identical');
      }

      relay._handleFabricMessage(message.toBuffer(), { name: 'other' }, null);
      assert.strictEqual(seen.length, 1, 'a repeated bid is dropped');

      const ask = DocumentBook.createAsk(bid, { key: new Key(), merkleRootHex: ROOT, blobHashHex: LEAF, priceSats: 700 }).message;
      relay._handleFabricMessage(ask.toBuffer(), { name: 'seller' }, null);
      assert.strictEqual(writes.buyer.length, 1);
      assert.ok(writes.buyer[0].toBuffer().equals(ask.toBuffer()));
      assert.strictEqual(writes.other.length, 1, 'asks are never flooded');
    });

    it('drops asks for bids nobody routed, over the bid, or past the per-bid cap', function () {
      const relay = new Peer(offlinePeerSettings());
      const writes = wire(relay, ['buyer', 'seller']);
      const { message, bid } = DocumentBook.createBid({ documentId: 'doc', blobIndex: 0, maxSats: 100 });
      const stray = DocumentBook.createBid({ documentId: 'doc', blobIndex: 0, maxSats: 100 }).bid;
      relay._handleFabricMessage(DocumentBook.createAsk(stray, { key: new Key(), merkleRootHex: ROOT, blobHashHex: LEAF, priceSats: 1 }).message.toBuffer(), { name: 'seller' }, null);
      assert.strictEqual(writes.buyer.length, 0);

      relay._handleFabricMessage(message.toBuffer(), { name: 'buyer' }, null);
      const over = Message.fromFields('P2P_DOCUMENT_ASK', {
        bid: bid.id, document: 'doc', merkleRoot: ROOT, blobIndex: 0, blobHash: LEAF, priceSats: 101, expiresAt: bid.expiresAt
      }).signWithKey(new Key());
      relay._handleFabricMessage(over.toBuffer(), { name: 'seller' }, null);
      assert.strictEqual(writes.buyer.length, 0);

      const seller = new Key();
      for (let i = 0; i < 2; i++) {
        const again = DocumentBook.createAsk(bid, { key: seller, merkleRootHex: ROOT, blobHashHex: LEAF, priceSats: 50 + i }).message;
        relay._handleFabricMessage(again.toBuffer(), { name: 'seller' }, null);
      }
      assert.strictEqual(writes.buyer.length, 1, 'one ask per seller');
      for (let i = 0; i < PEER_MAX_ASKS_PER_DOCUMENT_BID + 5; i++) {
        const ask = DocumentBook.createAsk(bid, { key: new Key(), merkleRootHex: ROOT, blobHashHex: LEAF, priceSats: 1 }).message;
        relay._handleFabricMessage(ask.toBuffer(), { name: 'seller' }, null);
      }
      assert.strictEqual(writes.buyer.length, PEER_MAX_ASKS_PER_DOCUMENT_BID);
    });

    it('stops flooding bids from one origin past the per-minute rate', function () {
      const relay = new Peer(offlinePeerSettings());
      const writes = wire(relay, ['buyer', 'other']);
      for (let i = 0; i < DOCUMENT_BID_MAX_RELAYS_PER_ORIGIN_PER_MINUTE + 3; i++) {
        const { message } = DocumentBook.createBid({ documentId: 'doc', blobIndex: i, maxSats: 10 });
        relay._handleFabricMessage(message.toBuffer(), { name: 'buyer' }, null);
      }
      assert.strictEqual(writes.other.length, DOCUMENT_BID_MAX_RELAYS_PER_ORIGIN_PER_MINUTE);
    });

    it('drops expired bids', function () {
      const relay = new Peer(offlinePeerSettings());
      const writes = wire(relay, ['buyer', 'other']);
      const stale = Message.fromFields('P2P_DOCUMENT_BID', {
        document: 'doc', merkleRoot: '', blobIndex: 0, blobHash: '', maxSats: 10, expiresAt: now() - 1, nonce: crypto.randomBytes(32)
      }).signWithKey(new Key());
      relay._handleFabricMessage(stale.toBuffer(), { name: 'buyer' }, null);
      assert.strictEqual(writes.other.length, 0);
      assert.strictEqual(relay._documentBidRoutes.size, 0);
    });

    it('a seller answers only when asked to, at its rate or a price it picks', function () {
      const quiet = sellerWith();
      const writesQuiet = wire(quiet.peer, ['buyer']);
      const first = DocumentBook.createBid({ documentId: quiet.documentId, blobIndex: 1, maxSats: 1000 });
      const bids = [];
      quiet.peer.on('documentBid', (ev) => bids.push(ev));
      quiet.peer._handleFabricMessage(first.message.toBuffer(), { name: 'buyer' }, null);
      assert.strictEqual(bids.length, 1);
      assert.strictEqual(writesQuiet.buyer.length, 0, 'off by default');
      const manual = quiet.peer.askDocumentBid(first.bid.id, { priceSats: 650 });
      assert.ok(manual.ok, manual.error);
      assert.strictEqual(writesQuiet.buyer.length, 1);
      const sent = DocumentBook.readAsk(writesQuiet.buyer[0], { bid: first.bid });
      assert.ok(sent.ok, sent.error);
      assert.strictEqual(sent.ask.priceSats, 650);
      assert.strictEqual(sent.ask.merkleRootHex, quiet.doc.merkleRootHex);
      assert.strictEqual(sent.ask.blobHashHex, quiet.doc.blob(1).blobHashHex);
      assert.strictEqual(sent.ask.seller, quiet.peer.key.pubkey.slice(2));
      assert.strictEqual(quiet.peer.askDocumentBid(first.bid.id).ok, false, 'once per bid');

      const auto = sellerWith({ answerDocumentBids: true });
      const writesAuto = wire(auto.peer, ['buyer']);
      const cheap = DocumentBook.createBid({ documentId: auto.documentId, blobIndex: 0, maxSats: 500 });
      auto.peer._handleFabricMessage(cheap.message.toBuffer(), { name: 'buyer' }, null);
      assert.strictEqual(writesAuto.buyer.length, 0, 'listed rate over the bid');
      const fair = DocumentBook.createBid({ documentId: auto.documentId, blobIndex: 0, maxSats: 800 });
      auto.peer._handleFabricMessage(fair.message.toBuffer(), { name: 'buyer' }, null);
      assert.strictEqual(writesAuto.buyer.length, 1);
      assert.strictEqual(DocumentBook.readAsk(writesAuto.buyer[0], { bid: fair.bid }).ask.priceSats, 800);
      const otherTree = DocumentBook.createBid({ documentId: auto.documentId, blobIndex: 0, maxSats: 800, merkleRootHex: ROOT });
      auto.peer._handleFabricMessage(otherTree.message.toBuffer(), { name: 'buyer' }, null);
      assert.strictEqual(writesAuto.buyer.length, 1, 'not held under that root');

      const priced = sellerWith({ answerDocumentBids: (bid, held) => (bid.blobIndex === 0 ? null : held.rateSats - 100) });
      const writesPriced = wire(priced.peer, ['buyer']);
      for (const blobIndex of [0, 1]) {
        const b = DocumentBook.createBid({ documentId: priced.documentId, blobIndex, maxSats: 1000 });
        priced.peer._handleFabricMessage(b.message.toBuffer(), { name: 'buyer' }, null);
      }
      assert.strictEqual(writesPriced.buyer.length, 1);
      const pricedAsk = DocumentBook.readAsk(writesPriced.buyer[0]).ask;
      assert.strictEqual(pricedAsk.blobIndex, 1);
      assert.strictEqual(pricedAsk.priceSats, 700);
    });

    it('the buyer takes asks for its own bid into the bid\'s book', function () {
      const buyer = new Peer(offlinePeerSettings());
      const writes = wire(buyer, ['relay']);
      const book = new DocumentBook();
      const bid = buyer.bidForDocumentChunk({ documentId: 'doc', blobIndex: 0, maxSats: 1000, book });
      assert.strictEqual(writes.relay.length, 1);
      assert.notStrictEqual(writes.relay[0].author, buyer.key.pubkey.slice(2), 'not signed by the Peer identity');
      const asks = [];
      buyer.on('documentAsk', (ev) => asks.push(ev));
      buyer._handleFabricMessage(writes.relay[0].toBuffer(), { name: 'relay' }, null);
      const ask = DocumentBook.createAsk(bid, { key: new Key(), merkleRootHex: ROOT, blobHashHex: LEAF, priceSats: 400 }).message;
      buyer._handleFabricMessage(ask.toBuffer(), { name: 'relay' }, null);
      assert.strictEqual(asks.length, 1);
      assert.strictEqual(asks[0].row.rateSats, 400);
      assert.strictEqual(book.listOffers({ documentId: 'doc' }).length, 1);
      assert.strictEqual(writes.relay.length, 1, 'own bid and its asks are not relayed');
    });
  });

  describe('Peer (live three-peer mesh)', function () {
    this.timeout(30000);

    it('a bid floods buyer → relay → seller and the ask returns along its path', async function () {
      const relayPort = await getFreePort();
      const sellerPort = await getFreePort();
      const relay = new Peer(offlinePeerSettings({
        listen: true, networking: true, port: relayPort, interface: '127.0.0.1',
        constraints: { peers: { max: 8, shuffle: 8 } }
      }));
      const { peer: seller, doc, documentId } = sellerWith({
        listen: true, networking: true, port: sellerPort, interface: '127.0.0.1',
        peers: [`127.0.0.1:${relayPort}`],
        answerDocumentBids: true,
        constraints: { peers: { max: 8, shuffle: 8 } }
      });
      const buyer = new Peer(offlinePeerSettings({
        listen: false, networking: true,
        peers: [`127.0.0.1:${relayPort}`],
        constraints: { peers: { max: 8, shuffle: 8 } }
      }));
      for (const p of [relay, seller, buyer]) p.on('error', () => {});
      const relayed = [];
      relay.on('documentBid', (ev) => relayed.push(ev));
      const asks = [];
      buyer.on('documentAsk', (ev) => asks.push(ev));

      try {
        await relay.start();
        await seller.start();
        await buyer.start();
        await waitUntil(() => Object.keys(relay.connections || {}).length >= 2, 15000);
        await waitUntil(() => Object.keys(buyer.connections || {}).length >= 1, 15000);
        await waitUntil(() => Object.keys(seller.connections || {}).length >= 1, 15000);

        const book = new DocumentBook();
        const bid = buyer.bidForDocumentChunk({ documentId, blobIndex: 2, maxSats: 5000, book });
        await waitUntil(() => asks.length >= 1, 15000);

        assert.strictEqual(relayed.length, 1);
        assert.strictEqual(asks[0].ask.bidId, bid.id);
        assert.strictEqual(asks[0].ask.priceSats, 800);
        assert.strictEqual(asks[0].ask.seller, seller.key.pubkey.slice(2));
        assert.strictEqual(asks[0].ask.blobHashHex, doc.blob(2).blobHashHex);
        const ranked = book.rankOffers(book.listOffers({ documentId }));
        assert.strictEqual(ranked.length, 1);
        assert.strictEqual(ranked[0].merkleRootHex, doc.merkleRootHex);
      } finally {
        await buyer.stop();
        await seller.stop();
        await relay.stop();
      }
    });
  });
});

describe('DocumentBlobTransferBook', function () {
  it('rejects tampered blob bytes', function () {
    const split = Document.split(Buffer.alloc(3000, 1), 1000, 'doc');
    const book = new DocumentBlobTransferBook();
    const good = DocumentBlobTransferBook.parseFrame({
      name: 'doc',
      body: split.blobs[0].bytes.toString('base64'),
      blobIndex: 0,
      blobTotal: 3,
      blobHashHex: split.blobs[0].blobHashHex,
      merkleRootHex: split.merkleRootHex
    });
    assert.strictEqual(book.ingest(good).status, 'need_more');

    const bad = DocumentBlobTransferBook.parseFrame({
      name: 'doc',
      body: Buffer.alloc(1000, 9).toString('base64'),
      blobIndex: 1,
      blobTotal: 3,
      blobHashHex: split.blobs[1].blobHashHex,
      merkleRootHex: split.merkleRootHex
    });
    assert.strictEqual(bad.ok, false);
    assert.ok(/hash mismatch/.test(bad.error));
  });

  it('reassembles multi-blob transfer only when Tree root matches', function () {
    const data = Buffer.alloc(4500, 0x42);
    const split = Document.split(data, 1200, 'big');
    const book = new DocumentBlobTransferBook();
    book.expectTransfer({
      documentId: 'big',
      merkleRootHex: split.merkleRootHex,
      total: split.blobs.length,
      blobHashHexes: split.blobs.map((b) => b.blobHashHex),
      contentSha256: split.contentSha256
    });
    let last = null;
    for (const b of split.blobs) {
      const frame = DocumentBlobTransferBook.parseFrame({
        name: 'big',
        body: b.bytes.toString('base64'),
        blobIndex: b.index,
        blobTotal: b.total,
        blobHashHex: b.blobHashHex,
        merkleRootHex: split.merkleRootHex,
        contentSha256: split.contentSha256
      });
      last = book.ingest(frame);
    }
    assert.strictEqual(last.status, 'complete');
    assert.strictEqual(last.verified, true);
    assert.ok(last.buffer.equals(data));
  });

  it('reassembles sealed transfers from each blob\'s own leaf', function () {
    const Document = require('../types/document');
    const doc = Document.seal(crypto.randomBytes(5000), { chunkBytes: 2048 });
    const frames = doc.fileSendObjects();
    assert.ok(frames.length > 1);
    assert.notStrictEqual(frames[0].paymentHashHex, frames[1].paymentHashHex);
    const ingestAll = (objs) => {
      const book = new DocumentBlobTransferBook();
      let last = null;
      for (const obj of objs) {
        last = book.ingest(DocumentBlobTransferBook.parseFrame(obj));
        if (last.status === 'reject') break;
      }
      return last;
    };
    const perBlob = ingestAll(frames);
    assert.strictEqual(perBlob.status, 'complete', perBlob.error);
    assert.strictEqual(perBlob.merkleRootHex, doc.merkleRootHex);

    // A whole-document sale: one payment hash on every leaf, IV outside the tree.
    const pay = crypto.createHash('sha256').update('K').digest('hex');
    const split = Document.split(crypto.randomBytes(5000), 2048, 'whole');
    const root = Document.rootHexFromBlobHashes(split.blobs.map((b) => b.blobHashHex), { paymentHashHex: pay });
    const whole = split.blobs.map((b) => ({
      name: 'whole',
      body: b.bytes.toString('base64'),
      blobIndex: b.index,
      blobTotal: b.total,
      blobHashHex: b.blobHashHex,
      merkleRootHex: root,
      sealed: true,
      paymentHashHex: pay,
      iv: crypto.randomBytes(12).toString('base64')
    }));
    assert.strictEqual(ingestAll(whole).status, 'complete');

    const swapped = frames.map((f, i) => (i === 1 ? Object.assign({}, f, { paymentHashHex: frames[0].paymentHashHex }) : f));
    assert.strictEqual(ingestAll(swapped).error, 'merkle/root mismatch');
  });

  it('offer book binds payment hash not raw blob hash', function () {
    const blobHashHex = 'ab'.repeat(32);
    const pay = Document.blobPaymentHash({ documentId: 'd', blobIndex: 0, blobHashHex });
    const book = new DocumentBook();
    book.ingestInventoryResponse({
      origin: 'seller:1',
      items: [{
        id: 'd',
        rateSats: 50,
        contentHash: 'cd'.repeat(32),
        merkleRootHex: Document.rootHexFromBlobHashes([blobHashHex]),
        blobs: [{
          index: 0,
          total: 1,
          blobHashHex,
          contentHash: pay,
          size: 10,
          rateSats: 50
        }]
      }]
    });
    const best = book.pickBest('d');
    assert.strictEqual(best.contentHashHex, pay);
    assert.strictEqual(best.blobHashHex, blobHashHex);
    assert.notStrictEqual(best.contentHashHex, best.blobHashHex);
  });

  it('settlement dedupe blocks double-pay keys', function () {
    const s1 = createDocumentPurchaseSession({
      documentId: 'd',
      seller: 's',
      contentHashHex: 'aa'.repeat(32),
      amountSats: 10,
      paymentAddress: 'bcrt1qtest',
      blobIndex: 0,
      blobTotal: 2
    });
    const paid = new Set();
    assert.strictEqual(isDuplicateSettlement(paid, s1), false);
    rememberSettlement(paid, s1);
    assert.strictEqual(isDuplicateSettlement(paid, s1), true);
    assert.strictEqual(DocumentBook.settlementDedupeKey(s1), s1.dedupeKey);
  });

  it('completes unindexed whole-body frames without pending state', function () {
    const book = new DocumentBlobTransferBook();
    const frame = DocumentBlobTransferBook.parseFrame({
      name: 'unindexed-doc',
      body: Buffer.from('whole-file').toString('base64')
    });
    assert.strictEqual(frame.unindexed, true);
    const out = book.ingest(frame);
    assert.strictEqual(out.status, 'complete');
    assert.strictEqual(out.unindexed, true);
    assert.strictEqual(out.verified, true);
    assert.ok(out.buffer.equals(Buffer.from('whole-file')));
    assert.strictEqual(book.pendingCount, 0);
  });

  it('rejects bad frames, blobTotal mismatch, and advertised-index hash drift', function () {
    assert.strictEqual(new DocumentBlobTransferBook().ingest(null).status, 'reject');
    assert.strictEqual(
      new DocumentBlobTransferBook().ingest({ ok: false, error: 'nope' }).error,
      'nope'
    );

    const split = Document.split(Buffer.alloc(2400, 2), 800, 'mismatch');
    const totals = new DocumentBlobTransferBook();
    totals.expectTransfer({
      documentId: 'mismatch',
      merkleRootHex: split.merkleRootHex,
      total: split.blobs.length,
      blobHashHexes: split.blobs.map((b) => b.blobHashHex)
    });
    const wrongTotal = DocumentBlobTransferBook.parseFrame({
      name: 'mismatch',
      body: split.blobs[0].bytes.toString('base64'),
      blobIndex: 0,
      blobTotal: 99,
      blobHashHex: split.blobs[0].blobHashHex,
      merkleRootHex: split.merkleRootHex
    });
    assert.strictEqual(totals.ingest(wrongTotal).error, 'blobTotal mismatch');

    const indexBook = new DocumentBlobTransferBook();
    indexBook.expectTransfer({
      documentId: 'idx',
      merkleRootHex: split.merkleRootHex,
      total: split.blobs.length,
      blobHashHexes: ['11'.repeat(32), '22'.repeat(32), '33'.repeat(32)]
    });
    // Bytes match claimed hash, but claimed hash is not the advertised leaf for index 0.
    const leafBytes = Buffer.alloc(32, 9);
    const leafHash = require('crypto').createHash('sha256').update(leafBytes).digest('hex');
    const drift = indexBook.ingest({
      ok: true,
      unindexed: false,
      documentId: 'idx',
      bytes: leafBytes,
      blobIndex: 0,
      blobTotal: split.blobs.length,
      blobHashHex: leafHash,
      merkleRootHex: split.merkleRootHex,
      contentSha256: null
    });
    assert.strictEqual(drift.status, 'reject');
    assert.strictEqual(drift.error, 'blob hash not in advertised index');
  });

  it('rejects a frame whose payment hash is not the one bought at that index', function () {
    const split = Document.split(Buffer.alloc(2000, 5), 1000, 'pay');
    const paid = ['aa'.repeat(32), 'bb'.repeat(32)];
    const book = new DocumentBlobTransferBook();
    book.expectTransfer({
      documentId: 'pay',
      merkleRootHex: split.merkleRootHex,
      total: split.blobs.length,
      blobHashHexes: split.blobs.map((b) => b.blobHashHex),
      paymentHashHexes: paid
    });
    const frame = (index, paymentHashHex) => DocumentBlobTransferBook.parseFrame({
      name: 'pay',
      body: split.blobs[index].bytes.toString('base64'),
      blobIndex: index,
      blobTotal: split.blobs.length,
      blobHashHex: split.blobs[index].blobHashHex,
      merkleRootHex: split.merkleRootHex,
      paymentHashHex
    });
    const planted = book.ingest(frame(0, 'cc'.repeat(32)));
    assert.strictEqual(planted.status, 'reject');
    assert.strictEqual(planted.error, 'payment hash not in advertised index');
    assert.strictEqual(book.ingest(frame(0, paid[0])).status, 'need_more');
  });

  it('rejects contentSha256 mismatch after full reassemble', function () {
    const data = Buffer.alloc(2000, 7);
    const split = Document.split(data, 1000, 'sha');
    const book = new DocumentBlobTransferBook();
    book.expectTransfer({
      documentId: 'sha',
      merkleRootHex: split.merkleRootHex,
      total: split.blobs.length,
      blobHashHexes: split.blobs.map((b) => b.blobHashHex),
      contentSha256: 'ff'.repeat(32)
    });
    let last = null;
    for (const b of split.blobs) {
      last = book.ingest(DocumentBlobTransferBook.parseFrame({
        name: 'sha',
        body: b.bytes.toString('base64'),
        blobIndex: b.index,
        blobTotal: b.total,
        blobHashHex: b.blobHashHex,
        merkleRootHex: split.merkleRootHex,
        contentSha256: 'ff'.repeat(32)
      }));
    }
    assert.strictEqual(last.status, 'reject');
    assert.strictEqual(last.error, 'contentSha256 mismatch');
    assert.strictEqual(book.pendingCount, 0);
  });

  it('TTL purge and maxPending eviction keep the book bounded', function () {
    const book = new DocumentBlobTransferBook({ maxPending: 1, ttlMs: 1 });
    book.expectTransfer({
      documentId: 'old',
      merkleRootHex: 'aa'.repeat(32),
      total: 2
    });
    const row = book._expectations.get(`old|${'aa'.repeat(32)}`);
    row.updated = Date.now() - 1000;
    book.expectTransfer({
      documentId: 'new',
      merkleRootHex: 'bb'.repeat(32),
      total: 2
    });
    // Cap keeps only the newest registration; purge drops stale on ingest.
    assert.ok(book.pendingCount <= 1);
    const stale = book.ingest({
      ok: true,
      unindexed: false,
      documentId: 'ghost',
      bytes: Buffer.alloc(4),
      blobIndex: 0,
      blobTotal: 2,
      blobHashHex: require('crypto').createHash('sha256').update(Buffer.alloc(4)).digest('hex'),
      merkleRootHex: 'cc'.repeat(32)
    });
    assert.ok(stale.status === 'need_more' || stale.status === 'reject');
  });

  it('caps one transfer at MAX_DOCUMENT_BLOBS and bounds pending bytes', function () {
    const crypto = require('crypto');
    const { MAX_DOCUMENT_BYTES, DOCUMENT_SEALED_CHUNK_BYTES } = require('../constants');
    assert.strictEqual(Document.MAX_BYTES, MAX_DOCUMENT_BYTES);
    assert.strictEqual(Document.MAX_BYTES, 0xFFFFFFFF);
    assert.strictEqual(new DocumentBlobTransferBook().maxPendingBytes, MAX_DOCUMENT_BLOBS * DOCUMENT_SEALED_CHUNK_BYTES);

    const bytes = Buffer.alloc(100, 3);
    const blobHashHex = crypto.createHash('sha256').update(bytes).digest('hex');
    const frame = (over) => Object.assign({
      ok: true,
      unindexed: false,
      documentId: 'cap',
      bytes,
      blobIndex: 0,
      blobTotal: 2,
      blobHashHex,
      merkleRootHex: 'aa'.repeat(32),
      contentSha256: null
    }, over);

    const book = new DocumentBlobTransferBook();
    const huge = book.ingest(frame({ blobTotal: MAX_DOCUMENT_BLOBS + 1 }));
    assert.strictEqual(huge.status, 'reject');
    assert.ok(/blobTotal exceeds/.test(huge.error));
    assert.strictEqual(book.pendingCount, 0);
    assert.strictEqual(book.expectTransfer({ documentId: 'cap', total: MAX_DOCUMENT_BLOBS + 1 }), null);

    const outOfRange = book.ingest(frame({ blobIndex: 2 }));
    assert.strictEqual(outOfRange.error, 'blobIndex out of range');

    const tight = new DocumentBlobTransferBook({ maxPendingBytes: 200 });
    assert.strictEqual(tight.ingest(frame({ documentId: 'a' })).status, 'need_more');
    assert.strictEqual(tight.pendingBytes, 100);
    // A repeated blob is not counted twice.
    assert.strictEqual(tight.ingest(frame({ documentId: 'a' })).status, 'need_more');
    assert.strictEqual(tight.pendingBytes, 100);
    // Finishing (or failing) a transfer releases its bytes.
    tight.ingest(frame({ documentId: 'a', blobIndex: 1 }));
    assert.strictEqual(tight.pendingBytes, 0);
    assert.strictEqual(tight.ingest(frame({ documentId: 'b' })).status, 'need_more');
    assert.strictEqual(tight.ingest(frame({ documentId: 'c' })).status, 'need_more');
    const over = tight.ingest(frame({ documentId: 'd' }));
    assert.strictEqual(over.status, 'reject');
    assert.strictEqual(over.error, 'pending blob bytes exceeded');
    assert.strictEqual(tight.pendingBytes, 200);
  });

  describe('purchase pins', function () {
    const bytes = Buffer.alloc(100, 3);
    const blobHashHex = crypto.createHash('sha256').update(bytes).digest('hex');
    const root = Document.rootHexFromBlobHashes([blobHashHex, blobHashHex]);
    const frame = (over) => Object.assign({
      ok: true,
      unindexed: false,
      documentId: 'doc',
      bytes,
      blobIndex: 0,
      blobTotal: 2,
      blobHashHex,
      merkleRootHex: root,
      contentSha256: null
    }, over);

    it('expectations outlive the idle TTL until their session expires', function () {
      const book = new DocumentBlobTransferBook({ ttlMs: 1 });
      book.expectTransfer({ documentId: 'doc', merkleRootHex: root, total: 2, ttlMs: 60000 });
      assert.strictEqual(book.ingest(frame()).status, 'need_more');
      const key = `doc|${root}`;
      book._pending.get(key).updated = Date.now() - 1000;
      assert.strictEqual(book.expectedFor('doc').length, 1);
      assert.ok(book._pending.has(key), 'pinned row survives the idle TTL');
      book._expectations.get(key).expiresAt = Date.now() - 1;
      assert.strictEqual(book.expectedFor('doc').length, 0);
      assert.ok(!book._pending.has(key));
    });

    it('unsolicited transfers never evict an expectation', function () {
      const book = new DocumentBlobTransferBook({ maxPending: 2, maxPendingPerOrigin: 100 });
      book.expectTransfer({ documentId: 'doc', merkleRootHex: root, total: 2 });
      for (let i = 0; i < 10; i++) {
        book.ingest(frame({ documentId: `spam${i}`, merkleRootHex: 'bb'.repeat(32) }), { origin: 'attacker' });
      }
      assert.strictEqual(book.expectedFor('doc').length, 1);
      assert.strictEqual(book.ingest(frame(), { origin: 'seller' }).status, 'need_more');
      assert.strictEqual(book.ingest(frame({ blobIndex: 1 }), { origin: 'seller' }).status, 'complete');
    });

    it('a planted row whose total contradicts the pin is replaced', function () {
      const book = new DocumentBlobTransferBook();
      assert.strictEqual(book.ingest(frame({ blobTotal: 3 }), { origin: 'attacker' }).status, 'need_more');
      book.expectTransfer({ documentId: 'doc', merkleRootHex: root, total: 2 });
      assert.strictEqual(book.pendingBytes, 0, 'the planted row was dropped');
      assert.strictEqual(book.ingest(frame({ blobTotal: 3 }), { origin: 'attacker' }).error, 'blobTotal mismatch');
      assert.strictEqual(book.ingest(frame(), { origin: 'seller' }).status, 'need_more');
      assert.strictEqual(book.ingest(frame({ blobIndex: 1 }), { origin: 'seller' }).status, 'complete');
    });

    it('a planted part at the right total never shadows the seller\'s frame', function () {
      const junk = Buffer.alloc(100, 9);
      const junkHash = crypto.createHash('sha256').update(junk).digest('hex');
      const book = new DocumentBlobTransferBook();
      assert.strictEqual(book.ingest(frame({ bytes: junk, blobHashHex: junkHash }), { origin: 'attacker' }).status, 'need_more');
      book.expectTransfer({ documentId: 'doc', merkleRootHex: root, total: 2, blobHashHexes: [blobHashHex, blobHashHex] });
      assert.strictEqual(book.pendingBytes, 0, 'the unsolicited row was dropped');
      assert.strictEqual(book.ingest(frame(), { origin: 'seller' }).status, 'need_more');
      assert.strictEqual(book.ingest(frame({ blobIndex: 1 }), { origin: 'seller' }).status, 'complete');
    });

    it('merging pins drops held parts that contradict them', function () {
      const junk = Buffer.alloc(100, 9);
      const junkHash = crypto.createHash('sha256').update(junk).digest('hex');
      const book = new DocumentBlobTransferBook();
      book.expectTransfer({ documentId: 'doc', merkleRootHex: root, total: 2 });
      assert.strictEqual(book.ingest(frame({ bytes: junk, blobHashHex: junkHash }), { origin: 'attacker' }).status, 'need_more');
      book.expectTransfer({ documentId: 'doc', merkleRootHex: root, total: 2, blobHashHexes: [blobHashHex, null], merge: true });
      assert.strictEqual(book.pendingBytes, 0);
      assert.strictEqual(book.ingest(frame(), { origin: 'seller' }).status, 'need_more');
      assert.strictEqual(book.ingest(frame({ blobIndex: 1 }), { origin: 'seller' }).status, 'complete');
    });

    it('per-origin row and byte quotas only cost the noisy origin', function () {
      const rows = new DocumentBlobTransferBook({ maxPendingPerOrigin: 2 });
      const results = [];
      for (let i = 0; i < 5; i++) results.push(rows.ingest(frame({ documentId: `a${i}` }), { origin: 'attacker' }));
      assert.strictEqual(results[4].error, 'too many pending blob transfers from this peer');
      assert.strictEqual(rows.ingest(frame({ documentId: 'honest' }), { origin: 'other' }).status, 'need_more');
      const attackerRows = Array.from(rows._pending.values()).filter((r) => r.origin === 'attacker');
      assert.deepStrictEqual(attackerRows.map((r) => r.documentId).sort(), ['a0', 'a1']);
      assert.ok(rows._pending.has(`honest|${root}`));

      const quota = new DocumentBlobTransferBook({ maxPendingBytes: 10000, maxPendingBytesPerOrigin: 200, maxPendingPerOrigin: 100 });
      quota.ingest(frame({ documentId: 'x1' }), { origin: 'attacker' });
      quota.ingest(frame({ documentId: 'x2' }), { origin: 'attacker' });
      quota.ingest(frame({ documentId: 'x3' }), { origin: 'attacker' });
      assert.ok((quota._originBytes.get('attacker') || 0) <= 200);
      assert.strictEqual(quota.ingest(frame({ documentId: 'y1' }), { origin: 'other' }).status, 'need_more');
    });

    it('releaseTransfer ends the session and frees its bytes', function () {
      const book = new DocumentBlobTransferBook();
      book.expectTransfer({ documentId: 'doc', merkleRootHex: root, total: 2 });
      book.ingest(frame(), { origin: 'seller' });
      assert.strictEqual(book.pendingBytes, 100);
      assert.strictEqual(book.releaseTransfer({ documentId: 'doc', merkleRootHex: root }), true);
      assert.strictEqual(book.pendingBytes, 0);
      assert.strictEqual(book.expectedFor('doc').length, 0);
    });
  });
});

describe('document L1 batches', function () {
  it('wraps a range under one preimage and keeps wraps off the inventory item', function () {
    const doc = Document.seal(crypto.randomBytes(5000), { chunkBytes: 2048, documentId: 'batch-doc' });
    const blobs = doc.blobs.map((leaf) => ({
      blobIndex: leaf.index,
      blobHashHex: leaf.blobHashHex,
      keyHex: doc.keyFor(leaf.index)
    }));
    const { batch, secretHex } = createBlobBatch({
      documentId: 'batch-doc',
      merkleRootHex: doc.merkleRootHex,
      blobs,
      amountSats: 716 * blobs.length
    });
    assert.strictEqual(batch.type, 'DocumentBlobBatch');
    assert.strictEqual(batch.blobs.length, blobs.length);
    const item = JSON.stringify(doc.inventoryItem({ rateSats: 716, documentId: 'batch-doc' }));
    assert.strictEqual(item.includes('wrappedKeyHex'), false);
    const opened = openBlobBatch({ batch, preimageHex: secretHex, blobIndex: 0 });
    assert.strictEqual(opened.ok, true);
    assert.strictEqual(opened.keyHex, doc.keyFor(0));
    const lie = Object.assign({}, batch, {
      blobs: batch.blobs.map((b, i) => i === 0 ? Object.assign({}, b, { wrappedKeyHex: crypto.randomBytes(32).toString('hex') }) : b)
    });
    const fraud = openBlobBatch({ batch: lie, preimageHex: secretHex, blobIndex: 0 });
    assert.strictEqual(fraud.ok, false);
    assert.strictEqual(fraud.fraud, true);
  });

  it('packs a maximum file into 1025 batches of 128', function () {
    const batches = Math.ceil(MAX_DOCUMENT_BLOBS / DOCUMENT_L1_BATCH_BLOBS);
    assert.strictEqual(DOCUMENT_L1_BATCH_BLOBS, 128);
    assert.strictEqual(batches, 1025);
  });

  it('refuses a 716-sat L1 offer at 4 sat/vB before funding', function () {
    const market = new Market({
      budgetSats: 100000,
      tickMs: 0,
      network: 'regtest',
      claimFeerate: 4,
      tipHeight: () => 1000,
      minHtlcLockBlocks: 1
    });
    const want = { documentId: 'd', lastError: null, sessions: [] };
    const session = market.openSession(want, {
      rateSats: 716,
      sealed: true,
      contentHashHex: 'ab'.repeat(32),
      sellerId: 's'
    }, 0, 1);
    assert.strictEqual(session, null);
    assert.match(want.lastError, /4 sat\/vB/);
    assert.ok(market._lockError(1007));
    assert.strictEqual(market._lockError(1008), null);
  });

  it('batches consecutive blobs on mainnet without paying a per-buyer quote hash', function () {
    const market = new Market({ budgetSats: 1, tickMs: 0, network: 'mainnet' });
    assert.strictEqual(market.settings.quotes, false);
    assert.strictEqual(market.settings.l1Batch, true);
    const planned = {
      plan: new Map([
        [0, { sellerId: 'a', sealed: true }],
        [1, { sellerId: 'a', sealed: true }],
        [2, { sellerId: 'b', sealed: true }]
      ])
    };
    const batches = market._l1BatchRows(planned);
    assert.deepStrictEqual(batches.map((b) => [b.seller, b.start, b.end]), [
      ['a', 0, 1],
      ['b', 2, 2]
    ]);
  });
});

const rand = () => crypto.randomBytes(32).toString('hex');

describe('functions/documentSealedExchange (per-buyer blob quotes)', function () {
  const base = { documentId: 'doc', merkleRootHex: 'ab'.repeat(32), blobIndex: 2 };

  it('wrap / unwrap round-trips and is bound to document, root, and index', function () {
    const keyHex = rand();
    const secretHex = rand();
    const wrappedKeyHex = wrapBlobKey(Object.assign({ keyHex, secretHex }, base));
    assert.notStrictEqual(wrappedKeyHex, keyHex);
    const out = unwrapBlobKey(Object.assign({ wrappedKeyHex, secretHex, keyHashHex: paymentHashHexFromKey(keyHex) }, base));
    assert.deepStrictEqual(out, { ok: true, keyHex });
    for (const over of [{ documentId: 'other' }, { merkleRootHex: 'cd'.repeat(32) }, { blobIndex: 3 }, { secretHex: rand() }]) {
      const wrong = unwrapBlobKey(Object.assign({ wrappedKeyHex, secretHex, keyHashHex: paymentHashHexFromKey(keyHex) }, base, over));
      assert.strictEqual(wrong.ok, false, JSON.stringify(over));
    }
    assert.strictEqual(unwrapBlobKey(Object.assign({ wrappedKeyHex: 'zz', secretHex }, base)).ok, false);
  });

  it('createBlobQuote commits SHA256(K_i) and pays to SHA256(s)', function () {
    const keyHex = rand();
    const { quote, secretHex } = createBlobQuote(Object.assign({ keyHex, amountSats: 716, expiresAt: 123 }, base));
    assert.strictEqual(quote.type, BLOB_QUOTE_TYPE);
    assert.strictEqual(quote.keyHashHex, paymentHashHexFromKey(keyHex));
    assert.strictEqual(quote.paymentHashHex, paymentHashHexFromKey(secretHex));
    assert.strictEqual(quote.amountSats, 716);
    assert.strictEqual(quote.expiresAt, 123);
    assert.ok(!JSON.stringify(quote).includes(keyHex));
    assert.ok(!JSON.stringify(quote).includes(secretHex));
    assert.ok(isWellFormedBlobQuote(quote));
    const again = createBlobQuote(Object.assign({ keyHex }, base));
    assert.notStrictEqual(again.quote.paymentHashHex, quote.paymentHashHex, 'a fresh secret per quote');
  });

  it('isWellFormedBlobQuote refuses quotes that would pay to SHA256(K_i)', function () {
    const { quote } = createBlobQuote(Object.assign({ keyHex: rand() }, base));
    assert.strictEqual(isWellFormedBlobQuote(Object.assign({}, quote, { paymentHashHex: quote.keyHashHex })), false);
    assert.strictEqual(isWellFormedBlobQuote(Object.assign({}, quote, { blobIndex: -1 })), false);
    assert.strictEqual(isWellFormedBlobQuote(Object.assign({}, quote, { documentId: '' })), false);
    assert.strictEqual(isWellFormedBlobQuote(Object.assign({}, quote, { wrappedKeyHex: 'nope' })), false);
    assert.strictEqual(isWellFormedBlobQuote(null), false);
  });

  it('checkBlobQuote unwraps K_i with the HTLC preimage', function () {
    const keyHex = rand();
    const { quote, secretHex } = createBlobQuote(Object.assign({ keyHex }, base));
    assert.deepStrictEqual(checkBlobQuote({ quote, preimageHex: secretHex }), { ok: true, keyHex });
    assert.deepStrictEqual(checkBlobQuote({ quote, preimageHex: secretHex, keyHashHex: quote.keyHashHex }), { ok: true, keyHex });
    const wrongPre = checkBlobQuote({ quote, preimageHex: rand() });
    assert.strictEqual(wrongPre.ok, false);
    assert.ok(!wrongPre.fraud, 'a wrong preimage is not the seller\'s fault');
  });

  it('checkBlobQuote reports fraud: a lying wrap, or a key hash the document does not commit', function () {
    const keyHex = rand();
    const { quote, secretHex } = createBlobQuote(Object.assign({ keyHex }, base));
    const lie = Object.assign({}, quote, { wrappedKeyHex: rand() });
    const bad = checkBlobQuote({ quote: lie, preimageHex: secretHex });
    assert.strictEqual(bad.ok, false);
    assert.strictEqual(bad.fraud, true);
    const committed = paymentHashHexFromKey(rand());
    const swapped = checkBlobQuote({ quote, preimageHex: secretHex, keyHashHex: committed });
    assert.strictEqual(swapped.ok, false);
    assert.strictEqual(swapped.fraud, true);
  });

  it('advertiseSealedDocument no longer publishes plaintextSha256', function () {
    const sale = prepareSealedSale(Buffer.alloc(3000, 4));
    const adv = advertiseSealedDocument(sale, { documentId: 'd', rateSats: 10, chunkBytes: 1000 });
    assert.ok(!('plaintextSha256' in adv));
    for (const b of adv.itemBlobs) assert.ok(!('plaintextSha256' in b));
  });
});
