'use strict';

const assert = require('assert');
const crypto = require('crypto');

const Document = require('../types/document');
const DocumentBook = require('../types/documentBook');
const Key = require('../types/key');
const Message = require('../types/message');
const Peer = require('../types/peer');
const {
  P2P_DOCUMENT_BID,
  P2P_DOCUMENT_ASK,
  DOCUMENT_BID_MAX_TTL_SECONDS,
  DOCUMENT_BID_MAX_RELAYS_PER_ORIGIN_PER_MINUTE,
  PEER_MAX_ASKS_PER_DOCUMENT_BID
} = require('../constants');
const {
  lookupGossipType,
  isRelayAsIsWireType,
  isFirstClassOpcodeOnlyType
} = require('../functions/gossipNetwork');
const { offlinePeerSettings, waitUntil, getFreePort } = require('./helpers/peer');

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
