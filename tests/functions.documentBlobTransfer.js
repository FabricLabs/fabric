'use strict';

const assert = require('assert');
const crypto = require('crypto');
const {
  splitBlobs,
  blobPaymentHashHex,
  merkleRootHexFromBlobHashes
} = require('../functions/documentBlobManifest');
const {
  parseFileSendObject,
  DocumentBlobTransferBook,
  settlementDedupeKey
} = require('../functions/documentBlobManifest');
const { DocumentBook } = require('../types/documentBook');
const {
  createDocumentPurchaseSession,
  isDuplicateSettlement,
  rememberSettlement
} = require('../types/documentBook');

describe('functions/documentBlobTransfer', function () {
  it('rejects tampered blob bytes', function () {
    const split = splitBlobs(Buffer.alloc(3000, 1), 1000, 'doc');
    const book = new DocumentBlobTransferBook();
    const good = parseFileSendObject({
      name: 'doc',
      body: split.blobs[0].bytes.toString('base64'),
      blobIndex: 0,
      blobTotal: 3,
      blobHashHex: split.blobs[0].blobHashHex,
      merkleRootHex: split.merkleRootHex
    });
    assert.strictEqual(book.ingest(good).status, 'need_more');

    const bad = parseFileSendObject({
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
    const split = splitBlobs(data, 1200, 'big');
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
      const frame = parseFileSendObject({
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
        last = book.ingest(parseFileSendObject(obj));
        if (last.status === 'reject') break;
      }
      return last;
    };
    const perBlob = ingestAll(frames);
    assert.strictEqual(perBlob.status, 'complete', perBlob.error);
    assert.strictEqual(perBlob.merkleRootHex, doc.merkleRootHex);

    // A whole-document sale: one payment hash on every leaf, IV outside the tree.
    const pay = crypto.createHash('sha256').update('K').digest('hex');
    const split = splitBlobs(crypto.randomBytes(5000), 2048, 'whole');
    const root = merkleRootHexFromBlobHashes(split.blobs.map((b) => b.blobHashHex), { paymentHashHex: pay });
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
    const pay = blobPaymentHashHex({ documentId: 'd', blobIndex: 0, blobHashHex });
    const book = new DocumentBook();
    book.ingestInventoryResponse({
      origin: 'seller:1',
      items: [{
        id: 'd',
        rateSats: 50,
        contentHash: 'cd'.repeat(32),
        merkleRootHex: merkleRootHexFromBlobHashes([blobHashHex]),
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
    assert.strictEqual(settlementDedupeKey(s1), s1.dedupeKey);
  });

  it('completes unindexed whole-body frames without pending state', function () {
    const book = new DocumentBlobTransferBook();
    const frame = parseFileSendObject({
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

    const split = splitBlobs(Buffer.alloc(2400, 2), 800, 'mismatch');
    const totals = new DocumentBlobTransferBook();
    totals.expectTransfer({
      documentId: 'mismatch',
      merkleRootHex: split.merkleRootHex,
      total: split.blobs.length,
      blobHashHexes: split.blobs.map((b) => b.blobHashHex)
    });
    const wrongTotal = parseFileSendObject({
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
    const split = splitBlobs(Buffer.alloc(2000, 5), 1000, 'pay');
    const paid = ['aa'.repeat(32), 'bb'.repeat(32)];
    const book = new DocumentBlobTransferBook();
    book.expectTransfer({
      documentId: 'pay',
      merkleRootHex: split.merkleRootHex,
      total: split.blobs.length,
      blobHashHexes: split.blobs.map((b) => b.blobHashHex),
      paymentHashHexes: paid
    });
    const frame = (index, paymentHashHex) => parseFileSendObject({
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
    const split = splitBlobs(data, 1000, 'sha');
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
      last = book.ingest(parseFileSendObject({
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
    const {
      MAX_DOCUMENT_BLOBS,
      MAX_DOCUMENT_BYTES,
      DEFAULT_BLOB_CHUNK_BYTES
    } = require('../functions/documentBlobManifest');
    const crypto = require('crypto');
    assert.strictEqual(MAX_DOCUMENT_BLOBS, require('../constants').MAX_DOCUMENT_BLOBS);
    assert.strictEqual(MAX_DOCUMENT_BYTES, MAX_DOCUMENT_BLOBS * DEFAULT_BLOB_CHUNK_BYTES);
    assert.strictEqual(MAX_DOCUMENT_BYTES, 197394432);

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
    const root = merkleRootHexFromBlobHashes([blobHashHex, blobHashHex]);
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
