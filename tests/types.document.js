'use strict';

const assert = require('assert');
const crypto = require('crypto');

const Document = require('../types/document');
const Peer = require('../types/peer');
const {
  merkleRootHexFromBlobHashes,
  documentMerkleRootHex,
  verifyOfferLeaves,
  verifySealedBlobFrame,
  DEFAULT_BLOB_CHUNK_BYTES,
  DOCUMENT_TREE_VERSION,
  SEALED_BLOB_CHUNK_BYTES
} = require('../functions/documentBlobManifest');
const { paymentHashHexFromKey, isWellFormedKeyReveal, BLOB_QUOTE_TYPE } = require('../functions/documentSealedExchange');
const DocumentBook = require('../types/documentBook');
const Message = require('../types/message');
const { HTLC_MINIMUM_SATS } = require('../constants');

const RATE = HTLC_MINIMUM_SATS;

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

/** Frames a seller writes for `documentId` (ciphertext only, no key). */
function sealedSends (seller, documentId, opts = {}) {
  const written = [];
  seller.connections.buyer = { _writeFabric: (buf) => written.push(buf) };
  seller._sendP2pFileSendToPeer(documentId, 'buyer', Object.assign({ revealKey: false, settlementId: 's' }, opts));
  const sends = written.map((buf) => Message.fromBuffer(buf)).filter((m) => m.type === 'P2P_FILE_SEND');
  return { sends, bodies: sends.map((m) => JSON.parse(m.body)) };
}

describe('types/document (sealed blob tree)', function () {
  it('seals one key per blob; blob hash = SHA256(ciphertext), payment hash = SHA256(K_i)', function () {
    const plain = crypto.randomBytes(DEFAULT_BLOB_CHUNK_BYTES * 2 + 100);
    const doc = Document.seal(plain);
    assert.strictEqual(doc.sealed, true);
    assert.strictEqual(doc.blobTotal, 3);
    assert.ok(doc.bytesFor(0).length <= DEFAULT_BLOB_CHUNK_BYTES, 'ciphertext blob fits an AMP frame');
    const pays = new Set();
    for (const b of doc.blobs) {
      assert.strictEqual(sha256(doc.bytesFor(b.index)), b.blobHashHex);
      assert.strictEqual(paymentHashHexFromKey(doc.keyFor(b.index)), b.paymentHashHex);
      assert.strictEqual(doc.paymentHashFor(b.index), b.paymentHashHex);
      pays.add(b.paymentHashHex);
    }
    assert.strictEqual(pays.size, 3, 'distinct K_i per blob');
    assert.strictEqual(doc.treeVersion, DOCUMENT_TREE_VERSION);
    assert.strictEqual(doc.chunkBytes, SEALED_BLOB_CHUNK_BYTES, 'leaves room for the inclusion proof');
    assert.strictEqual(doc.merkleRootHex, documentMerkleRootHex(doc.blobs));
    assert.notStrictEqual(doc.merkleRootHex, merkleRootHexFromBlobHashes(doc.blobs.map((b) => b.blobHashHex)));
    assert.strictEqual(doc.hash, doc.merkleRootHex);
    assert.strictEqual(doc.contract.integrity, `sha256-${doc.merkleRootHex}`);
    assert.ok(doc.content().equals(plain));
  });

  it('record() and inventoryItem() are hash-only (no name / mime / url)', function () {
    const doc = Document.seal(Buffer.from('hello world'), { publisher: '02' + 'ab'.repeat(32) });
    const rec = doc.record();
    for (const k of ['name', 'mime', 'url', 'title']) assert.ok(!(k in rec));
    const item = doc.inventoryItem({ rateSats: 5 });
    for (const k of ['name', 'mime', 'url', 'title']) assert.ok(!(k in item));
    assert.strictEqual(item.id, doc.merkleRootHex);
    assert.strictEqual(item.perBlob, true);
    assert.strictEqual(item.blobs[0].contentHashHex, doc.paymentHashFor(0));
    assert.notStrictEqual(item.blobs[0].contentHashHex, item.blobs[0].blobHashHex, 'payment hash never binds to the blob hash');
  });

  it('a receiver rehydrates from the record, verifies bytes, and opens each blob with its own reveal', function () {
    const plain = crypto.randomBytes(5000);
    const seller = Document.seal(plain, { chunkBytes: 2048 });
    const buyer = Document.fromRecord(seller.record());
    assert.strictEqual(buyer.merkleRootHex, seller.merkleRootHex);
    assert.strictEqual(buyer.complete, false);
    for (const f of seller.fileSendObjects()) {
      assert.strictEqual(f.perBlob, true);
      assert.ok(buyer.acceptBytes(f.blobIndex, Buffer.from(f.body, 'base64')));
    }
    assert.strictEqual(buyer.acceptBytes(0, Buffer.from('nope')), false);
    for (const b of seller.blobs) {
      const reveal = seller.keyRevealFor(b.index, { settlementId: 's1' });
      assert.strictEqual(reveal.type, 'DocumentContentKeyReveal');
      assert.ok(isWellFormedKeyReveal(reveal.object));
      assert.strictEqual(reveal.object.blobIndex, b.index);
      assert.strictEqual(reveal.object.blobHashHex, b.blobHashHex);
      const wrong = buyer.openBlob(b.index, '11'.repeat(32));
      assert.strictEqual(wrong.ok, false);
      const ok = buyer.openBlob(reveal.object.blobIndex, reveal.object.keyHex);
      assert.strictEqual(ok.ok, true, ok.error);
    }
    assert.ok(buyer.complete);
    assert.ok(buyer.content().equals(plain));
  });

  it('manifest blob convention: encode/decode canonical DocumentManifest', function () {
    const bytes = Document.encodeManifest({ title: 'Page', url: 'https://example.com', merkleRootHex: 'cc'.repeat(32) });
    const again = Document.encodeManifest({ url: 'https://example.com', merkleRootHex: 'cc'.repeat(32), title: 'Page' });
    assert.ok(bytes.equals(again), 'key order is canonical');
    const m = Document.decodeManifest(bytes);
    assert.strictEqual(m.type, Document.MANIFEST_TYPE);
    assert.strictEqual(m.title, 'Page');
    assert.strictEqual(Document.decodeManifest(Buffer.from('{"a":1}')), null);
    const manifestDoc = Document.seal(bytes);
    assert.strictEqual(manifestDoc.blobTotal, 1, 'manifest is one more sealed blob');
  });

  it('fromPlain keeps the splitBlobs leaves and binds payment hash to the blob hash', function () {
    const plain = crypto.randomBytes(3000);
    const doc = Document.fromPlain(plain, { chunkBytes: 1024 });
    assert.strictEqual(doc.sealed, false);
    assert.strictEqual(doc.blobTotal, 3);
    assert.strictEqual(doc.paymentHashFor(1), doc.blob(1).blobHashHex);
    assert.ok(doc.complete);
    assert.ok(doc.content().equals(plain));
  });

  it('per-blob sealed inventory yields a multi-seller blob plan in the offer book', function () {
    const doc = Document.seal(crypto.randomBytes(6000), { chunkBytes: 2048 });
    const book = new DocumentBook();
    const item = doc.inventoryItem({ rateSats: 10 });
    book.ingestInventoryResponse({ origin: 'A', items: [item], latencyMs: 50 });
    const cheaper = JSON.parse(JSON.stringify(item));
    cheaper.blobs = [Object.assign({}, cheaper.blobs[1], { rateSats: 1 })];
    cheaper.rateSats = 1;
    book.ingestInventoryResponse({ origin: 'B', items: [cheaper], latencyMs: 50 });
    const plan = book.pickBlobPlan(item.id, doc.blobTotal);
    assert.strictEqual(plan.size, doc.blobTotal);
    const sellers = new Set(Array.from(plan.values()).map((p) => p.sellerId));
    assert.deepStrictEqual(Array.from(sellers).sort(), ['A', 'B']);
    assert.strictEqual(plan.get(1).sellerId, 'B');
  });

  it('Peer: publishSealedDocument → per-blob frames + one key reveal per blob opens the document', function () {
    const seller = new Peer({ listen: false, sealPricedDocuments: true });
    const buyer = new Peer({ listen: false });
    const plain = crypto.randomBytes(4000);
    const doc = Document.seal(plain, { chunkBytes: 2048 });
    assert.strictEqual(doc.blobTotal, 2);
    // A paid blob must settle with an HTLC its claim can collect on chain.
    assert.match(seller.publishSealedDocument(doc, { rateSats: RATE - 1 }).error, /HTLC minimum/);
    const pub = seller.publishSealedDocument(doc, { rateSats: RATE });
    assert.ok(pub.ok, pub.error);
    const docId = pub.documentId;

    // Inventory item from the seller's registry (hash-only, selector on blob hash).
    const items = seller._sealedBlobInventoryItems({ blobHashHex: doc.blob(1).blobHashHex });
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].blobs.length, 1);
    assert.strictEqual(items[0].blobs[0].index, 1);

    // Capture frames the seller would write to the buyer's socket.
    const written = [];
    seller.connections['buyer'] = { _writeFabric: (buf) => written.push(buf) };
    assert.ok(seller._sendP2pFileSendToPeer(docId, 'buyer', { revealKey: true, settlementId: 's' }));
    const Message = require('../types/message');
    const frames = written.map((buf) => Message.fromBuffer(buf));
    const sends = frames.filter((m) => m.type === 'P2P_FILE_SEND');
    const reveals = frames.filter((m) => m.type === 'GENERIC_MESSAGE' || m.type === 'GenericMessage');
    assert.strictEqual(sends.length, 2);
    assert.strictEqual(reveals.length, 2);

    // A frame the socket refuses (legacy frame cap) is not sent, and its key is not revealed.
    const partial = [];
    let sendCount = 0;
    seller.connections['legacy'] = {
      _writeFabric: (buf) => {
        const m = Message.fromBuffer(buf);
        if (m.type === 'P2P_FILE_SEND' && sendCount++ === 0) return false;
        partial.push(m);
        return true;
      }
    };
    assert.ok(seller._sendP2pFileSendToPeer(docId, 'legacy', { revealKey: true, settlementId: 's' }));
    assert.strictEqual(partial.filter((m) => m.type === 'P2P_FILE_SEND').length, 1);
    assert.strictEqual(partial.filter((m) => m.type !== 'P2P_FILE_SEND').length, 1);
    seller.connections['closed'] = { _writeFabric: () => false };
    assert.strictEqual(seller._sendP2pFileSendToPeer(docId, 'closed', { revealKey: true, settlementId: 's' }), false);

    let received = null;
    buyer.on('documentReceived', (ev) => { received = ev; });
    const opened = [];
    buyer.on('documentBlobOpened', (ev) => opened.push(ev.blobIndex));
    for (const m of sends) {
      const r = buyer._ingestP2pFileSend({ object: JSON.parse(m.body) }, { name: 'seller' }, m);
      assert.strictEqual(r.status, 'awaiting_key');
      assert.strictEqual(r.perBlob, true);
    }
    const rowKey = `${docId}|${doc.merkleRootHex}`;
    assert.ok(buyer.pendingSealedBlobs[rowKey], 'row keyed by document id + root');
    const located = buyer.sealedBlobKeyForPaymentHash(doc.paymentHashFor(1));
    assert.strictEqual(located.blobIndex, 1);
    assert.strictEqual(located.frameHex, sends[1].toBuffer().toString('hex'), 'raw signed frame kept per blob');
    for (const m of reveals) {
      const body = JSON.parse(m.body);
      const r = buyer._handleDocumentContentKeyReveal(body.object, { name: 'seller' });
      assert.ok(r.ok, r.error);
    }
    assert.deepStrictEqual(opened.sort(), [0, 1]);
    assert.ok(received, 'documentReceived after last blob opened');
    assert.ok(received.buffer.equals(plain));
    assert.strictEqual(received.perBlob, true);
    assert.strictEqual(buyer.pendingSealedBlobs[rowKey], undefined);
  });

  it('Peer (legacy v1 tree): per-blob reassembly rejects forged shape and opens blobs with an out-of-band key', function () {
    const seller = new Peer({ listen: false, sealPricedDocuments: true });
    const buyer = new Peer({ listen: false });
    const plain = crypto.randomBytes(4000);
    const doc = Document.seal(plain, { chunkBytes: 2048, treeVersion: 1 });
    const { documentId } = seller.publishSealedDocument(doc, { rateSats: RATE });
    const written = [];
    seller.connections['buyer'] = { _writeFabric: (buf) => written.push(buf) };
    assert.ok(seller._sendP2pFileSendToPeer(documentId, 'buyer', { revealKey: false, settlementId: 's' }));
    const Message = require('../types/message');
    const sends = written.map((buf) => Message.fromBuffer(buf)).filter((m) => m.type === 'P2P_FILE_SEND');
    const bodies = sends.map((m) => JSON.parse(m.body));
    assert.strictEqual(bodies.length, 2);

    // Missing / malformed root is refused outright.
    let r = buyer._ingestP2pFileSend({ object: Object.assign({}, bodies[0], { merkleRootHex: undefined }) }, { name: 'seller' });
    assert.strictEqual(r.status, 'reject');
    assert.match(r.error, /merkleRootHex/);
    // Index past the advertised total is refused.
    r = buyer._ingestP2pFileSend({ object: Object.assign({}, bodies[0], { blobIndex: 7 }) }, { name: 'seller' });
    assert.strictEqual(r.status, 'reject');
    // Honest first frame.
    r = buyer._ingestP2pFileSend({ object: bodies[0] }, { name: 'seller' }, sends[0]);
    assert.strictEqual(r.status, 'awaiting_key');
    // Multi-seller plan: an unheld index of the same tree from another seller lands.
    r = buyer._ingestP2pFileSend({ object: bodies[1] }, { name: 'beta' });
    assert.strictEqual(r.status, 'awaiting_key');
    const rowKey = `${documentId}|${bodies[0].merkleRootHex.toLowerCase()}`;
    assert.strictEqual(buyer.pendingSealedBlobs[rowKey].parts.get(0).origin, 'seller');
    assert.strictEqual(buyer.pendingSealedBlobs[rowKey].parts.get(1).origin, 'beta', 'origin is recorded per part');
    // A frame that disagrees on blobTotal is refused.
    r = buyer._ingestP2pFileSend({ object: Object.assign({}, bodies[1], { blobTotal: 3 }) }, { name: 'seller' });
    assert.strictEqual(r.status, 'reject');
    assert.match(r.error, /blobTotal/);
    // Re-sending index 0 with different bytes never overwrites the held blob.
    const other = Document.seal(crypto.randomBytes(2048), { chunkBytes: 2048 });
    const ob = other.blob(0);
    const forged = Object.assign({}, bodies[0], {
      blobHashHex: ob.blobHashHex,
      paymentHashHex: ob.paymentHashHex,
      iv: ob.iv,
      body: other.bytesFor ? other.bytesFor(0).toString('base64') : bodies[0].body
    });
    r = buyer._ingestP2pFileSend({ object: forged }, { name: 'seller' });
    assert.strictEqual(r.status, 'reject');
    // Same ciphertext under a different payment hash or IV never replaces the
    // held frame; it waits as an alternate (bounded) for the key reveal.
    const held = buyer.pendingSealedBlobs[rowKey].parts.get(0);
    r = buyer._ingestP2pFileSend({ object: Object.assign({}, bodies[0], { paymentHashHex: 'ee'.repeat(32) }) }, { name: 'mallory' });
    assert.strictEqual(r.status, 'awaiting_key');
    assert.strictEqual(r.alternate, true);
    r = buyer._ingestP2pFileSend({ object: Object.assign({}, bodies[0], { iv: 'ab'.repeat(12) }) }, { name: 'mallory' });
    assert.strictEqual(r.alternate, true);
    assert.strictEqual(held.alternates.length, 2);
    assert.strictEqual(held.paymentHashHex, bodies[0].paymentHashHex.toLowerCase());
    for (let i = 0; i < 4; i++) {
      buyer._ingestP2pFileSend({ object: Object.assign({}, bodies[0], { paymentHashHex: String(i).repeat(64) }) }, { name: 'mallory' });
    }
    assert.strictEqual(held.alternates.length, 4, 'alternates are capped');
    // An identical resend is a duplicate; the first frame and origin stay.
    r = buyer._ingestP2pFileSend({ object: bodies[0] }, { name: 'mallory' });
    assert.strictEqual(r.status, 'awaiting_key');
    assert.strictEqual(r.duplicate, true);
    assert.strictEqual(buyer.pendingSealedBlobs[rowKey].parts.get(0), held);
    assert.strictEqual(held.origin, 'seller');
    // Second honest frame lands.
    r = buyer._ingestP2pFileSend({ object: bodies[1] }, { name: 'seller' }, sends[1]);
    assert.strictEqual(r.status, 'awaiting_key');

    // Seller-fulfils channel rail: the HTLC preimage is K_i; open with it directly.
    let received = null;
    buyer.on('documentReceived', (ev) => { received = ev; });
    const bad = buyer.openSealedBlobWithKey({ documentId, keyHex: crypto.randomBytes(32).toString('hex') });
    assert.strictEqual(bad.ok, false);
    for (let i = 0; i < doc.blobTotal; i++) {
      const out = buyer.openSealedBlobWithKey({ documentId, keyHex: doc.keyFor(i) });
      assert.ok(out.ok, out.error);
      assert.strictEqual(out.blobIndex, i, 'blob resolved from SHA256(key)');
    }
    assert.ok(received && received.buffer.equals(plain));
  });

  it('Peer (legacy v1 tree): expected blob hashes are checked per index', function () {
    const seller = new Peer({ listen: false, sealPricedDocuments: true });
    const doc = Document.seal(crypto.randomBytes(4000), { chunkBytes: 2048, treeVersion: 1 });
    const { documentId } = seller.publishSealedDocument(doc, { rateSats: RATE });
    const written = [];
    seller.connections['buyer'] = { _writeFabric: (buf) => written.push(buf) };
    seller._sendP2pFileSendToPeer(documentId, 'buyer', { revealKey: false, settlementId: 's' });
    const Message = require('../types/message');
    const bodies = written.map((buf) => Message.fromBuffer(buf)).filter((m) => m.type === 'P2P_FILE_SEND').map((m) => JSON.parse(m.body));

    const buyer = new Peer({ listen: false });
    buyer.blobTransfers.expectTransfer({
      documentId,
      merkleRootHex: doc.merkleRootHex,
      total: doc.blobTotal,
      blobHashHexes: [doc.blob(0).blobHashHex, doc.blob(1).blobHashHex]
    });
    // Blob 0's bytes delivered at index 1 hash to a leaf we asked for, but not at that index.
    let r = buyer._ingestP2pFileSend({ object: Object.assign({}, bodies[0], { blobIndex: 1 }) }, { name: 'seller' });
    assert.strictEqual(r.status, 'reject');
    assert.match(r.error, /at that index/);
    r = buyer._ingestP2pFileSend({ object: bodies[1] }, { name: 'seller' });
    assert.strictEqual(r.status, 'awaiting_key');

    // A single-blob purchase pins only its own index (Market#confirm).
    const single = new Peer({ listen: false });
    const pinned = [];
    pinned[1] = doc.blob(1).blobHashHex;
    single.blobTransfers.expectTransfer({ documentId, merkleRootHex: doc.merkleRootHex, total: doc.blobTotal, blobHashHexes: pinned });
    assert.strictEqual(single._ingestP2pFileSend({ object: bodies[1] }, { name: 'seller' }).status, 'awaiting_key');
  });

  it('Peer (legacy v1 tree): a poisoned first frame cannot block the paid blob, and pins survive later purchases', function () {
    const seller = new Peer({ listen: false, sealPricedDocuments: true });
    const doc = Document.seal(crypto.randomBytes(4000), { chunkBytes: 2048, treeVersion: 1 });
    const { documentId } = seller.publishSealedDocument(doc, { rateSats: RATE });
    const written = [];
    seller.connections['buyer'] = { _writeFabric: (buf) => written.push(buf) };
    seller._sendP2pFileSendToPeer(documentId, 'buyer', { revealKey: false, settlementId: 's' });
    const Message = require('../types/message');
    const bodies = written.map((buf) => Message.fromBuffer(buf)).filter((m) => m.type === 'P2P_FILE_SEND').map((m) => JSON.parse(m.body));
    const expect = (peer, index) => {
      const blobHashHexes = [];
      const paymentHashHexes = [];
      blobHashHexes[index] = doc.blob(index).blobHashHex;
      paymentHashHexes[index] = doc.paymentHashFor(index);
      return peer.blobTransfers.expectTransfer({ documentId, merkleRootHex: doc.merkleRootHex, total: doc.blobTotal, blobHashHexes, paymentHashHexes, merge: true });
    };

    // Buying blob 1 after blob 0 keeps blob 0 pinned (Market#confirm merges).
    const buyer = new Peer({ listen: false });
    expect(buyer, 0);
    const row = expect(buyer, 1);
    assert.deepStrictEqual(row.expectedHashes, [doc.blob(0).blobHashHex, doc.blob(1).blobHashHex]);
    let r = buyer._ingestP2pFileSend({ object: Object.assign({}, bodies[0], { paymentHashHex: 'ee'.repeat(32) }) }, { name: 'mallory' });
    assert.strictEqual(r.status, 'reject');
    assert.match(r.error, /paid for/);

    // An index that was not bought is refused outright.
    const single = new Peer({ listen: false });
    expect(single, 1);
    r = single._ingestP2pFileSend({ object: bodies[0] }, { name: 'mallory' });
    assert.strictEqual(r.status, 'reject');
    assert.match(r.error, /did not buy/);

    // The right ciphertext and payment hash with a wrong IV arrives first; the
    // seller's frame still lands and is the one the paid key opens.
    expect(single, 0);
    const poison = Object.assign({}, bodies[0], { iv: crypto.randomBytes(12).toString('base64') });
    assert.strictEqual(single._ingestP2pFileSend({ object: poison }, { name: 'mallory' }).status, 'awaiting_key');
    r = single._ingestP2pFileSend({ object: bodies[0] }, { name: 'seller' });
    assert.strictEqual(r.alternate, true);
    const out = single.openSealedBlobWithKey({ documentId, keyHex: doc.keyFor(0) });
    assert.ok(out.ok, out.error);
    const part = single.pendingSealedBlobs[`${documentId}|${doc.merkleRootHex}`].parts.get(0);
    assert.strictEqual(part.origin, 'seller');
    assert.strictEqual(part.iv, bodies[0].iv);
    assert.strictEqual(part.alternates, undefined);
  });

  it('Peer (legacy v1 tree): frames held before the purchase pin, or a full alternates list, never block the paid blob', function () {
    const seller = new Peer({ listen: false, sealPricedDocuments: true });
    const doc = Document.seal(crypto.randomBytes(4000), { chunkBytes: 2048, treeVersion: 1 });
    const { documentId } = seller.publishSealedDocument(doc, { rateSats: RATE });
    const written = [];
    seller.connections['buyer'] = { _writeFabric: (buf) => written.push(buf) };
    seller._sendP2pFileSendToPeer(documentId, 'buyer', { revealKey: false, settlementId: 's' });
    const Message = require('../types/message');
    const bodies = written.map((buf) => Message.fromBuffer(buf)).filter((m) => m.type === 'P2P_FILE_SEND').map((m) => JSON.parse(m.body));
    const rowKey = `${documentId}|${doc.merkleRootHex}`;

    // Inventory advertises each blob's IV; the offer book keeps it.
    const item = doc.inventoryItem({ rateSats: RATE });
    assert.strictEqual(item.blobs[0].iv, bodies[0].iv);
    const book = new DocumentBook();
    const [offer] = book.ingestInventoryResponse({ origin: 'seller', items: [item] });
    assert.strictEqual(offer.iv, bodies[0].iv);

    const pin = (peer, opts = {}) => {
      const at = (v) => { const a = []; a[0] = v; return a; };
      return peer.blobTransfers.expectTransfer({
        documentId,
        merkleRootHex: doc.merkleRootHex,
        total: doc.blobTotal,
        blobHashHexes: at(doc.blob(0).blobHashHex),
        paymentHashHexes: at(doc.paymentHashFor(0)),
        ivs: opts.iv === false ? null : at(bodies[0].iv),
        origins: at('seller'),
        merge: true
      });
    };
    const randomIv = () => Object.assign({}, bodies[0], { iv: crypto.randomBytes(12).toString('base64') });
    const openOnChannelRail = (peer) => peer.openSealedBlobWithKey({ documentId, blobIndex: 0, keyHex: doc.keyFor(0) });

    // Self-hashed junk under the advertised root lands before the buyer pays.
    const junkBytes = crypto.randomBytes(2048);
    const junk = Object.assign({}, bodies[0], {
      body: junkBytes.toString('base64'),
      blobHashHex: crypto.createHash('sha256').update(junkBytes).digest('hex')
    });
    const a = new Peer({ listen: false });
    assert.strictEqual(a._ingestP2pFileSend({ object: junk }, { name: 'mallory' }).status, 'awaiting_key');
    pin(a);
    assert.strictEqual(a._ingestP2pFileSend({ object: bodies[0] }, { name: 'seller' }).status, 'awaiting_key');
    assert.strictEqual(a.pendingSealedBlobs[rowKey].parts.get(0).blobHashHex, doc.blob(0).blobHashHex);
    assert.ok(openOnChannelRail(a).ok);

    // Five random-IV frames before the pin; the advertised IV clears them.
    const b = new Peer({ listen: false });
    for (let i = 0; i < 5; i++) b._ingestP2pFileSend({ object: randomIv() }, { name: 'mallory' });
    assert.strictEqual(b.pendingSealedBlobs[rowKey].parts.get(0).alternates.length, 4);
    pin(b);
    const late = b._ingestP2pFileSend({ object: randomIv() }, { name: 'mallory' });
    assert.strictEqual(late.status, 'reject');
    assert.match(late.error, /advertised/);
    assert.strictEqual(b._ingestP2pFileSend({ object: bodies[0] }, { name: 'seller' }).status, 'awaiting_key');
    assert.strictEqual(b.pendingSealedBlobs[rowKey].parts.get(0).alternates, undefined);
    assert.ok(openOnChannelRail(b).ok);

    // No advertised IV: the seller bought from displaces another origin's alternate.
    const c = new Peer({ listen: false });
    pin(c, { iv: false });
    for (let i = 0; i < 5; i++) c._ingestP2pFileSend({ object: randomIv() }, { name: 'mallory' });
    assert.strictEqual(c._ingestP2pFileSend({ object: randomIv() }, { name: 'mallory' }).status, 'reject');
    assert.strictEqual(c._ingestP2pFileSend({ object: bodies[0] }, { name: 'seller' }).alternate, true);
    const opened = openOnChannelRail(c);
    assert.ok(opened.ok, opened.error);
    assert.strictEqual(c.pendingSealedBlobs[rowKey].parts.get(0).origin, 'seller');

    // A frame's unauthenticated plaintextSha256 cannot veto the paid open.
    const d = new Peer({ listen: false });
    pin(d);
    d._ingestP2pFileSend({ object: Object.assign({}, bodies[0], { plaintextSha256: 'ab'.repeat(32) }) }, { name: 'mallory' });
    assert.strictEqual(d._ingestP2pFileSend({ object: bodies[0] }, { name: 'seller' }).duplicate, true);
    assert.ok(openOnChannelRail(d).ok);
  });

  it('Peer: pending sealed blobs are bounded by a global byte budget and a TTL', function () {
    const seller = new Peer({ listen: false, sealPricedDocuments: true });
    const framesFor = (bytes) => {
      const doc = Document.seal(crypto.randomBytes(bytes), { chunkBytes: 2048 });
      const { documentId } = seller.publishSealedDocument(doc, { rateSats: RATE });
      const written = [];
      seller.connections['buyer'] = { _writeFabric: (buf) => written.push(buf) };
      seller._sendP2pFileSendToPeer(documentId, 'buyer', { revealKey: false, settlementId: `s-${documentId}` });
      const Message = require('../types/message');
      return written.map((buf) => Message.fromBuffer(buf)).filter((m) => m.type === 'P2P_FILE_SEND');
    };
    const a = framesFor(2048);
    const b = framesFor(2048);
    // Budget fits one ~2 KiB row (ciphertext + its retained frame), not two.
    const buyer = new Peer({ listen: false, maxPendingSealedBytes: 8 * 1024 });
    assert.strictEqual(buyer._ingestP2pFileSend({ object: JSON.parse(a[0].body) }, { name: 'seller' }, a[0]).status, 'awaiting_key');
    assert.ok(Buffer.isBuffer([...Object.values(buyer.pendingSealedBlobs)[0].parts.values()][0].frame), 'retained frame is a Buffer, not hex');
    assert.strictEqual(buyer._ingestP2pFileSend({ object: JSON.parse(b[0].body) }, { name: 'seller' }, b[0]).status, 'awaiting_key');
    assert.strictEqual(Object.keys(buyer.pendingSealedBlobs).length, 1, 'oldest row evicted to stay under budget');
    assert.ok(Object.keys(buyer.pendingSealedBlobs)[0].startsWith(JSON.parse(b[0].body).name));
    // A single frame larger than the whole budget is refused outright.
    const tiny = new Peer({ listen: false, maxPendingSealedBytes: 64 });
    const r = tiny._ingestP2pFileSend({ object: JSON.parse(a[0].body) }, { name: 'seller' }, a[0]);
    assert.strictEqual(r.status, 'reject');
    assert.match(r.error, /budget/);
    // Rows that never complete expire.
    const ttl = new Peer({ listen: false, pendingSealedTtlMs: 1000 });
    ttl._ingestP2pFileSend({ object: JSON.parse(a[0].body) }, { name: 'seller' }, a[0]);
    for (const row of Object.values(ttl.pendingSealedBlobs)) row.created -= 5000;
    ttl._ingestP2pFileSend({ object: JSON.parse(b[0].body) }, { name: 'seller' }, b[0]);
    assert.strictEqual(Object.keys(ttl.pendingSealedBlobs).length, 1);
  });

  it('Peer: request for one blob reveals only after authorizeDocumentKeyReveal for that blob', function () {
    const seller = new Peer({ listen: false });
    const doc = Document.seal(crypto.randomBytes(3000), { chunkBytes: 2048 });
    const { documentId } = seller.publishSealedDocument(doc, { rateSats: RATE });
    const parsed = { document: documentId, blobIndex: 1, contentHashHex: doc.paymentHashFor(1) };
    assert.strictEqual(seller._mayRevealSealedBlobKey(documentId, parsed), false, 'hash echo alone never unlocks');
    seller.authorizeDocumentKeyReveal({ documentId, contentHashHex: doc.paymentHashFor(1), settlementId: 'x' });
    assert.strictEqual(seller._mayRevealSealedBlobKey(documentId, parsed), true);
    assert.strictEqual(seller._mayRevealSealedBlobKey(documentId, Object.assign({}, parsed, { blobIndex: 0 })), false);
  });

  describe('v2 tree: verify before pay', function () {
    const publish = (opts = {}) => {
      const seller = new Peer(Object.assign({ listen: false }, opts.peer || {}));
      const plain = opts.plain || crypto.randomBytes(4000);
      const doc = Document.seal(plain, { chunkBytes: 2048 });
      const { documentId } = seller.publishSealedDocument(doc, { rateSats: RATE });
      return Object.assign({ seller, plain, doc, documentId }, sealedSends(seller, documentId));
    };

    it('free ciphertext frames carry an inclusion proof and no plaintext hash', function () {
      const { doc, bodies } = publish();
      assert.strictEqual(doc.treeVersion, 2);
      for (const b of bodies) {
        assert.strictEqual(b.treeVersion, 2);
        assert.ok(Array.isArray(b.proof));
        assert.ok(!('plaintextSha256' in b));
        const v = verifySealedBlobFrame(b, { merkleRootHex: doc.merkleRootHex, blobTotal: doc.blobTotal });
        assert.strictEqual(v.ok, true, v.error);
      }
      const item = doc.inventoryItem({ rateSats: RATE });
      assert.ok(!('plaintextSha256' in item));
      assert.ok(!('plaintextSha256' in doc.record()));
      assert.strictEqual(item.treeVersion, 2);
      const leaves = item.blobs.map((b) => ({ index: b.index, blobHashHex: b.blobHashHex, contentHashHex: b.contentHashHex, iv: b.iv }));
      assert.strictEqual(verifyOfferLeaves({ merkleRootHex: item.merkleRootHex, blobTotal: item.blobTotal, blobs: leaves }).ok, true);
    });

    it('a blob-hash inventory selector returns one blob with its proof', function () {
      const { seller, doc } = publish();
      const [item] = seller._sealedBlobInventoryItems({ blobHashHex: doc.blob(1).blobHashHex });
      assert.strictEqual(item.blobs.length, 1);
      const b = item.blobs[0];
      assert.ok(Array.isArray(b.proof));
      assert.strictEqual(verifyOfferLeaves({
        merkleRootHex: item.merkleRootHex,
        blobTotal: item.blobTotal,
        blobs: [{ index: b.index, blobHashHex: b.blobHashHex, paymentHashHex: b.contentHashHex, iv: b.iv, proof: b.proof }]
      }).ok, true);
    });

    it('forged, self-hashed junk, swapped hash / IV, and wrong-total frames never land', function () {
      const { plain, doc, documentId, sends, bodies } = publish();
      const buyer = new Peer({ listen: false });
      const junk = crypto.randomBytes(2048);
      const forgeries = [
        { body: junk.toString('base64'), blobHashHex: sha256(junk) },
        { paymentHashHex: 'ee'.repeat(32) },
        { iv: crypto.randomBytes(12).toString('base64') },
        { blobTotal: 3 },
        { blobIndex: 1 }
      ];
      for (const over of forgeries) {
        const r = buyer._ingestP2pFileSend({ object: Object.assign({}, bodies[0], over) }, { name: 'mallory' });
        assert.strictEqual(r.status, 'reject', JSON.stringify(Object.keys(over)));
      }
      assert.strictEqual(Object.keys(buyer.pendingSealedBlobs).length, 0, 'nothing planted');
      for (let i = 0; i < sends.length; i++) {
        const r = buyer._ingestP2pFileSend({ object: bodies[i] }, { name: 'seller' }, sends[i]);
        assert.strictEqual(r.status, 'awaiting_key');
        assert.strictEqual(r.committed, true);
      }
      const rowKey = `${documentId}|${doc.merkleRootHex}`;
      assert.strictEqual(buyer.pendingSealedBlobs[rowKey].parts.get(0).verified, true);
      let received = null;
      buyer.on('documentReceived', (ev) => { received = ev; });
      for (let i = 0; i < doc.blobTotal; i++) assert.ok(buyer.openSealedBlobWithKey({ documentId, keyHex: doc.keyFor(i) }).ok);
      assert.ok(received.buffer.equals(plain));
    });

    it('a proven frame replaces an unproven planted part; a v2 pin refuses unproven frames', function () {
      const { doc, documentId, sends, bodies } = publish();
      const rowKey = `${documentId}|${doc.merkleRootHex}`;
      const junk = crypto.randomBytes(2048);
      const unproven = Object.assign({}, bodies[0], { body: junk.toString('base64'), blobHashHex: sha256(junk), proof: undefined, treeVersion: undefined });

      const a = new Peer({ listen: false });
      assert.strictEqual(a._ingestP2pFileSend({ object: unproven }, { name: 'mallory' }).status, 'awaiting_key');
      assert.strictEqual(a._ingestP2pFileSend({ object: bodies[0] }, { name: 'seller' }, sends[0]).status, 'awaiting_key');
      const part = a.pendingSealedBlobs[rowKey].parts.get(0);
      assert.strictEqual(part.blobHashHex, doc.blob(0).blobHashHex);
      assert.strictEqual(part.verified, true);
      assert.strictEqual(part.alternates, undefined);
      const late = a._ingestP2pFileSend({ object: Object.assign({}, bodies[1], { proof: undefined, treeVersion: undefined }) }, { name: 'seller' });
      assert.strictEqual(late.status, 'reject', 'a v2 row refuses unproven frames');

      const b = new Peer({ listen: false });
      b.blobTransfers.expectTransfer({ documentId, merkleRootHex: doc.merkleRootHex, total: doc.blobTotal, treeVersion: 2 });
      assert.strictEqual(b._ingestP2pFileSend({ object: Object.assign({}, bodies[0], { proof: undefined, treeVersion: undefined }) }, { name: 'seller' }).status, 'reject');
      assert.strictEqual(b._ingestP2pFileSend({ object: bodies[0] }, { name: 'seller' }, sends[0]).status, 'awaiting_key');

      // A planted row with a different blob count is replaced by the proven frame.
      const c = new Peer({ listen: false });
      assert.strictEqual(c._ingestP2pFileSend({ object: Object.assign({}, unproven, { blobTotal: 3 }) }, { name: 'mallory' }).status, 'awaiting_key');
      assert.strictEqual(c.pendingSealedBlobs[rowKey].total, 3);
      assert.strictEqual(c._ingestP2pFileSend({ object: bodies[0] }, { name: 'seller' }, sends[0]).status, 'awaiting_key');
      assert.strictEqual(c.pendingSealedBlobs[rowKey].total, doc.blobTotal);
    });

    it('a DocumentRequest for a per-blob document must name one held blob', function () {
      const { seller, documentId } = publish({ peer: { autoFulfillDocumentRequests: false } });
      assert.strictEqual(seller._documentRequestNamesBlob(documentId, { document: documentId }), false);
      assert.strictEqual(seller._documentRequestNamesBlob(documentId, { document: documentId, blobIndex: 9 }), false);
      assert.strictEqual(seller._documentRequestNamesBlob(documentId, { document: documentId, blobIndex: 1 }), true);
      assert.strictEqual(seller._documentRequestNamesBlob('plain-doc', { document: 'plain-doc' }), true);
      const pending = seller._queuePendingDocumentRequest(documentId, { name: 'buyer' }, { document: documentId });
      assert.match(seller.approveDocumentRequest(pending.key).error, /blobIndex required/);
      const one = seller._queuePendingDocumentRequest(documentId, { name: 'buyer' }, { document: documentId, blobIndex: 1 });
      assert.strictEqual(seller.approveDocumentRequest(one.key).ok, true);
    });
  });

  describe('seller secrets and payment hashes', function () {
    it('keys and ciphertext live outside _state; the state row is the public record', function () {
      const seller = new Peer({ listen: false });
      const doc = Document.seal(crypto.randomBytes(4000), { chunkBytes: 2048 });
      const { documentId } = seller.publishSealedDocument(doc, { rateSats: RATE });
      const json = JSON.stringify(seller._state.content);
      for (let i = 0; i < doc.blobTotal; i++) {
        assert.ok(!json.includes(doc.keyFor(i)), `K_${i} leaked into state`);
        assert.ok(!json.includes(doc.bytesFor(i).toString('base64').slice(0, 64)), `ciphertext ${i} in state`);
      }
      assert.deepStrictEqual(Object.keys(seller._state.content.documentSealedBlobs[documentId]), ['record']);
      assert.ok(!('plaintextSha256' in seller._state.content.documentSealedBlobs[documentId].record));
      // Served from the cached private copy (no decrypt per request).
      assert.strictEqual(seller._getSealedBlobDocument(documentId), seller._getSealedBlobDocument(documentId));
      assert.strictEqual(sealedSends(seller, documentId, { blobIndex: 1 }).sends.length, 1);
    });

    it('rows written by older versions move keys and ciphertext out of _state on first use', function () {
      const seller = new Peer({ listen: false });
      const doc = Document.seal(crypto.randomBytes(3000), { chunkBytes: 2048 });
      seller._state.content.documentSealedBlobs = {
        old: {
          record: doc.record(),
          keys: doc.blobs.map((b) => doc.keyFor(b.index)),
          ciphertextsBase64: doc.blobs.map((b) => doc.bytesFor(b.index).toString('base64'))
        }
      };
      const held = seller._getSealedBlobDocument('old');
      assert.ok(held);
      assert.strictEqual(held.keyFor(0), doc.keyFor(0));
      assert.deepStrictEqual(Object.keys(seller._state.content.documentSealedBlobs.old), ['record']);
      assert.strictEqual(seller.sealedBlobPreimageForPaymentHash(doc.paymentHashFor(1)).keyHex, doc.keyFor(1));
    });

    it('static payment hashes: an under-paying HTLC gets no preimage', function () {
      const seller = new Peer({ listen: false });
      const doc = Document.seal(crypto.randomBytes(3000), { chunkBytes: 2048 });
      seller.publishSealedDocument(doc, { rateSats: RATE });
      const ph = doc.paymentHashFor(0);
      assert.strictEqual(seller.sealedBlobPreimageForPaymentHash(ph, { amountSats: RATE - 1 }), null);
      assert.strictEqual(seller.sealedBlobPreimageForPaymentHash(ph, { amountSats: 'lots' }), null);
      const hit = seller.sealedBlobPreimageForPaymentHash(ph, { amountSats: RATE });
      assert.strictEqual(hit.keyHex, doc.keyFor(0));
      assert.strictEqual(hit.preimageHex, doc.keyFor(0));
      assert.strictEqual(hit.perBuyer, false);
      assert.strictEqual(hit.priceSats, RATE);
      assert.strictEqual(seller.sealedBlobPreimageForPaymentHash(ph).keyHex, doc.keyFor(0), 'no htlc: no amount check (compat)');
    });

    it('per-buyer quotes: the HTLC preimage s unwraps K_i only for the quoted buyer', function () {
      const seller = new Peer({ listen: false, sealedBlobPaymentMode: 'perBuyer' });
      const plain = crypto.randomBytes(4000);
      const doc = Document.seal(plain, { chunkBytes: 2048 });
      const { documentId } = seller.publishSealedDocument(doc, { rateSats: RATE });
      const { sends, bodies } = sealedSends(seller, documentId);
      assert.strictEqual(seller.sealedBlobPreimageForPaymentHash(doc.paymentHashFor(0), { amountSats: RATE }), null, 'static K_i never published');

      const written = [];
      seller.connections.buyer = { _writeFabric: (buf) => written.push(buf) };
      const quotes = [0, 1].map((i) => seller._sendSealedBlobQuote(documentId, i, 'buyer'));
      const quoteMsgs = written.map((buf) => Message.fromBuffer(buf));
      assert.strictEqual(quoteMsgs.length, 2);
      for (let i = 0; i < 2; i++) {
        assert.strictEqual(JSON.parse(quoteMsgs[i].body).type, BLOB_QUOTE_TYPE);
        assert.strictEqual(quotes[i].keyHashHex, doc.paymentHashFor(i));
        assert.notStrictEqual(quotes[i].paymentHashHex, doc.paymentHashFor(i));
        assert.strictEqual(quotes[i].amountSats, RATE);
      }
      const again = seller.quoteSealedBlob({ documentId, blobIndex: 0 }).quote;
      assert.notStrictEqual(again.paymentHashHex, quotes[0].paymentHashHex, 'fresh secret per quote');

      assert.strictEqual(seller.sealedBlobPreimageForPaymentHash(quotes[0].paymentHashHex, { amountSats: RATE - 1 }), null);
      const secrets = quotes.map((q) => seller.sealedBlobPreimageForPaymentHash(q.paymentHashHex, { amountSats: RATE }));
      for (let i = 0; i < 2; i++) {
        assert.strictEqual(secrets[i].perBuyer, true);
        assert.strictEqual(sha256(Buffer.from(secrets[i].preimageHex, 'hex')), quotes[i].paymentHashHex);
        assert.notStrictEqual(secrets[i].preimageHex, doc.keyFor(i));
      }

      // Someone who sees s on chain but holds no quote learns nothing.
      const watcher = new Peer({ listen: false });
      for (let i = 0; i < sends.length; i++) watcher._ingestP2pFileSend({ object: bodies[i] }, { name: 'seller' }, sends[i]);
      assert.strictEqual(watcher.openSealedBlobWithKey({ keyHex: secrets[0].preimageHex }).ok, false);

      const buyer = new Peer({ listen: false });
      for (let i = 0; i < sends.length; i++) buyer._ingestP2pFileSend({ object: bodies[i] }, { name: 'seller' }, sends[i]);
      for (const m of quoteMsgs) assert.ok(buyer._ingestSealedBlobQuote(JSON.parse(m.body).object, { name: 'seller' }, m).ok);
      const opened = [];
      let received = null;
      buyer.on('documentBlobOpened', (ev) => opened.push(ev));
      buyer.on('documentReceived', (ev) => { received = ev; });
      for (let i = 0; i < 2; i++) {
        const out = buyer.openSealedBlobWithKey({ keyHex: secrets[i].preimageHex });
        assert.ok(out.ok, out.error);
      }
      assert.strictEqual(opened[0].keyHex, doc.keyFor(0));
      assert.strictEqual(opened[0].preimageHex, secrets[0].preimageHex);
      assert.ok(received && received.buffer.equals(plain));
    });

    it('a quote that does not unwrap to the committed key is reported as fraud with the signed frame', function () {
      const seller = new Peer({ listen: false });
      const doc = Document.seal(crypto.randomBytes(3000), { chunkBytes: 2048 });
      const { documentId } = seller.publishSealedDocument(doc, { rateSats: RATE });
      const { sends, bodies } = sealedSends(seller, documentId);
      const { quote } = seller.quoteSealedBlob({ documentId, blobIndex: 0 });
      const lie = Object.assign({}, quote, { wrappedKeyHex: crypto.randomBytes(32).toString('hex') });
      const msg = Message.fromVector(['GenericMessage', JSON.stringify({ type: BLOB_QUOTE_TYPE, object: lie })]);
      msg.signWithKey(seller.key);

      const buyer = new Peer({ listen: false });
      for (let i = 0; i < sends.length; i++) buyer._ingestP2pFileSend({ object: bodies[i] }, { name: 'seller' }, sends[i]);
      assert.ok(buyer._ingestSealedBlobQuote(lie, { name: 'seller' }, msg).ok);
      const fraud = [];
      buyer.on('documentBlobQuoteFraud', (ev) => fraud.push(ev));
      const s = seller.sealedBlobPreimageForPaymentHash(quote.paymentHashHex, { amountSats: RATE }).preimageHex;
      const out = buyer.openSealedBlobWithKey({ keyHex: s });
      assert.strictEqual(out.ok, false);
      assert.strictEqual(out.fraud, true);
      assert.strictEqual(fraud.length, 1);
      assert.strictEqual(fraud[0].preimageHex, s);
      assert.strictEqual(fraud[0].quoteFrameHex, msg.toBuffer().toString('hex'));
      assert.strictEqual(fraud[0].origin, 'seller');
    });

    it('the seller quote map is bounded and quotes expire', function () {
      const seller = new Peer({ listen: false, maxSealedBlobQuotes: 3 });
      const doc = Document.seal(crypto.randomBytes(3000), { chunkBytes: 2048 });
      const { documentId } = seller.publishSealedDocument(doc, { rateSats: RATE });
      const quotes = [];
      for (let i = 0; i < 5; i++) quotes.push(seller.quoteSealedBlob({ documentId, blobIndex: 0 }).quote);
      assert.strictEqual(seller._sealedBlobQuotes.size, 3);
      assert.strictEqual(seller.sealedBlobPreimageForPaymentHash(quotes[0].paymentHashHex), null, 'oldest quote evicted');
      seller._sealedBlobQuotes.get(quotes[4].paymentHashHex).expiresAt = Date.now() - 1;
      assert.strictEqual(seller.sealedBlobPreimageForPaymentHash(quotes[4].paymentHashHex), null);
      assert.strictEqual(seller.quoteSealedBlob({ documentId, blobIndex: 9 }).ok, false);
    });
  });

  describe('binary documents', function () {
    it('a received non-UTF-8 document keeps its exact bytes', function () {
      const plain = Buffer.from([0xff, 0xfe, 0x00, 0x80, 0xc3, 0x28, ...crypto.randomBytes(3000)]);
      const seller = new Peer({ listen: false });
      const doc = Document.seal(plain, { chunkBytes: 2048 });
      const { documentId } = seller.publishSealedDocument(doc, { rateSats: RATE });
      const { sends, bodies } = sealedSends(seller, documentId);
      const buyer = new Peer({ listen: false });
      for (let i = 0; i < sends.length; i++) buyer._ingestP2pFileSend({ object: bodies[i] }, { name: 'seller' }, sends[i]);
      for (let i = 0; i < doc.blobTotal; i++) assert.ok(buyer.openSealedBlobWithKey({ documentId, keyHex: doc.keyFor(i) }).ok);
      assert.ok(buyer.getDocumentBuffer(documentId).equals(plain));
      assert.strictEqual(buyer._state.content.documentEncodings[documentId], 'base64');

      // Re-serving the stored document sends the same bytes.
      const relay = sealedSends(buyer, documentId);
      const sent = Buffer.concat(relay.bodies.sort((x, y) => x.blobIndex - y.blobIndex).map((b) => Buffer.from(b.body, 'base64')));
      assert.ok(sent.equals(plain));
    });

    it('UTF-8 documents are still stored as strings', function () {
      const peer = new Peer({ listen: false });
      peer._storeReceivedDocument('t', Buffer.from('héllo'));
      assert.strictEqual(peer._state.content.documents.t, 'héllo');
      assert.ok(peer.getDocumentBuffer('t').equals(Buffer.from('héllo')));
      peer._storeReceivedDocument('t', Buffer.from('other'), { overwrite: false });
      assert.strictEqual(peer._state.content.documents.t, 'héllo');
      assert.strictEqual(peer.getDocumentBuffer('missing'), null);
    });
  });

  describe('pending sealed rows: pins and per-origin quotas', function () {
    const framesFor = (seller, bytes) => {
      const doc = Document.seal(crypto.randomBytes(bytes), { chunkBytes: 2048 });
      const { documentId } = seller.publishSealedDocument(doc, { rateSats: RATE });
      return Object.assign({ doc, documentId }, sealedSends(seller, documentId));
    };

    it('an origin over its row quota loses its own oldest unsolicited rows only', function () {
      const seller = new Peer({ listen: false });
      const docs = Array.from({ length: 4 }, () => framesFor(seller, 1000));
      const honest = framesFor(seller, 1000);
      const buyer = new Peer({ listen: false, maxPendingSealedRowsPerOrigin: 2 });
      buyer._ingestP2pFileSend({ object: honest.bodies[0] }, { name: 'honest' }, honest.sends[0]);
      for (const d of docs) buyer._ingestP2pFileSend({ object: d.bodies[0] }, { name: 'mallory' }, d.sends[0]);
      const rows = Object.values(buyer.pendingSealedBlobs);
      assert.strictEqual(rows.filter((r) => r.originName === 'mallory').length, 2);
      assert.deepStrictEqual(rows.filter((r) => r.originName === 'mallory').map((r) => r.documentId).sort(), [docs[2].documentId, docs[3].documentId].sort());
      assert.ok(buyer.pendingSealedBlobs[`${honest.documentId}|${honest.doc.merkleRootHex}`]);
    });

    it('a per-origin byte quota stops one peer from filling the budget', function () {
      const seller = new Peer({ listen: false });
      const docs = Array.from({ length: 6 }, () => framesFor(seller, 2000));
      const honest = framesFor(seller, 2000);
      const buyer = new Peer({ listen: false, maxPendingSealedBytes: 64 * 1024, maxPendingSealedBytesPerOrigin: 12 * 1024, maxPendingSealedRowsPerOrigin: 100 });
      for (const d of docs) buyer._ingestP2pFileSend({ object: d.bodies[0] }, { name: 'mallory' }, d.sends[0]);
      assert.ok(buyer._pendingSealedOriginBytes.get('mallory') <= 12 * 1024);
      const r = buyer._ingestP2pFileSend({ object: honest.bodies[0] }, { name: 'honest' }, honest.sends[0]);
      assert.strictEqual(r.status, 'awaiting_key');
      const total = Object.values(buyer.pendingSealedBlobs).reduce((n, row) => n + row.bytes, 0);
      assert.strictEqual(buyer._pendingSealedBytes, total, 'running byte counter matches the rows');
    });

    it('pinned rows outlive the TTL while their expectation lives and are evicted last', function () {
      const seller = new Peer({ listen: false });
      const paid = framesFor(seller, 2000);
      const spam = Array.from({ length: 4 }, () => framesFor(seller, 2000));
      const buyer = new Peer({ listen: false, pendingSealedTtlMs: 1000, maxPendingSealedDeliveries: 3, maxPendingSealedRowsPerOrigin: 100 });
      buyer.blobTransfers.expectTransfer({ documentId: paid.documentId, merkleRootHex: paid.doc.merkleRootHex, total: paid.doc.blobTotal, treeVersion: 2 });
      buyer._ingestP2pFileSend({ object: paid.bodies[0] }, { name: 'seller' }, paid.sends[0]);
      const key = `${paid.documentId}|${paid.doc.merkleRootHex}`;
      assert.strictEqual(buyer.pendingSealedBlobs[key].pinned, true);
      buyer.pendingSealedBlobs[key].created -= 5000;
      for (const d of spam) buyer._ingestP2pFileSend({ object: d.bodies[0] }, { name: 'mallory' }, d.sends[0]);
      assert.ok(buyer.pendingSealedBlobs[key], 'pinned row kept past the TTL and under row pressure');
      assert.strictEqual(Object.keys(buyer.pendingSealedBlobs).length, 3);
      buyer.blobTransfers.releaseTransfer({ documentId: paid.documentId, merkleRootHex: paid.doc.merkleRootHex });
      buyer._capPendingSealedBlobs();
      assert.strictEqual(buyer.pendingSealedBlobs[key], undefined, 'expires once the session ends');
      const total = Object.values(buyer.pendingSealedBlobs).reduce((n, row) => n + row.bytes, 0);
      assert.strictEqual(buyer._pendingSealedBytes, total);
    });
  });

  it('compile keeps the [env, ui] Jade contract', async function () {
    const doc = Document.seal(Buffer.from('x'), { documentId: 'doc-1' });
    const out = await doc.compile(['./layout.jade', 'fabric-document']);
    // Valid @fabric/http page fragment: layout slot + hash-only attributes only.
    assert.ok(/^extends \.\/layout\.jade\nblock content\n {2}fabric-document\(state="[0-9a-f]{64}", data-merkle-root="[0-9a-f]{64}", data-document-id="doc-1"\)$/.test(out), out);
    assert.ok(out.includes(doc.merkleRootHex));
    assert.ok(!out.includes('{{'));
  });
});
