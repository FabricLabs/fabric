'use strict';

const assert = require('assert');
const crypto = require('crypto');

const Document = require('../types/document');
const Peer = require('../types/peer');
const { merkleRootHexFromBlobHashes, DEFAULT_BLOB_CHUNK_BYTES } = require('../functions/documentBlobManifest');
const { paymentHashHexFromKey, isWellFormedKeyReveal } = require('../functions/documentSealedExchange');
const { DocumentOfferBook } = require('../types/offerBook');

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

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
    assert.strictEqual(doc.merkleRootHex, merkleRootHexFromBlobHashes(doc.blobs.map((b) => b.blobHashHex)));
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
    const book = new DocumentOfferBook();
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
    const pub = seller.publishSealedDocument(doc, { rateSats: 3 });
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

  it('Peer: per-blob reassembly rejects forged shape and opens blobs with an out-of-band key', function () {
    const seller = new Peer({ listen: false, sealPricedDocuments: true });
    const buyer = new Peer({ listen: false });
    const plain = crypto.randomBytes(4000);
    const doc = Document.seal(plain, { chunkBytes: 2048 });
    const { documentId } = seller.publishSealedDocument(doc, { rateSats: 3 });
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

  it('Peer: pending sealed blobs are bounded by a global byte budget and a TTL', function () {
    const seller = new Peer({ listen: false, sealPricedDocuments: true });
    const framesFor = (bytes) => {
      const doc = Document.seal(crypto.randomBytes(bytes), { chunkBytes: 2048 });
      const { documentId } = seller.publishSealedDocument(doc, { rateSats: 3 });
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
    const { documentId } = seller.publishSealedDocument(doc, { rateSats: 1 });
    const parsed = { document: documentId, blobIndex: 1, contentHashHex: doc.paymentHashFor(1) };
    assert.strictEqual(seller._mayRevealSealedBlobKey(documentId, parsed), false, 'hash echo alone never unlocks');
    seller.authorizeDocumentKeyReveal({ documentId, contentHashHex: doc.paymentHashFor(1), settlementId: 'x' });
    assert.strictEqual(seller._mayRevealSealedBlobKey(documentId, parsed), true);
    assert.strictEqual(seller._mayRevealSealedBlobKey(documentId, Object.assign({}, parsed, { blobIndex: 0 })), false);
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
