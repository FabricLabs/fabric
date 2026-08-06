'use strict';

const assert = require('assert');
const {
  splitBlobs,
  blobPaymentHashHex
} = require('../functions/documentBlobManifest');
const {
  parseFileSendObject,
  DocumentBlobTransferBook,
  settlementDedupeKey
} = require('../functions/documentBlobManifest');
const { DocumentOfferBook } = require('../functions/documentMarket');
const {
  createDocumentPurchaseSession,
  isDuplicateSettlement,
  rememberSettlement
} = require('../functions/documentMarket');

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

  it('offer book binds payment hash not raw blob hash', function () {
    const blobHashHex = 'ab'.repeat(32);
    const pay = blobPaymentHashHex({ documentId: 'd', blobIndex: 0, blobHashHex });
    const book = new DocumentOfferBook();
    book.ingestInventoryResponse({
      origin: 'seller:1',
      items: [{
        id: 'd',
        rateSats: 50,
        contentHash: 'cd'.repeat(32),
        merkleRootHex: 'ef'.repeat(32),
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

  it('completes legacy whole-body frames without pending state', function () {
    const book = new DocumentBlobTransferBook();
    const frame = parseFileSendObject({
      name: 'legacy-doc',
      body: Buffer.from('whole-file').toString('base64')
    });
    assert.strictEqual(frame.legacy, true);
    const out = book.ingest(frame);
    assert.strictEqual(out.status, 'complete');
    assert.strictEqual(out.legacy, true);
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
      legacy: false,
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
    const row = book._pending.get(`old|${'aa'.repeat(32)}`);
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
      legacy: false,
      documentId: 'ghost',
      bytes: Buffer.alloc(4),
      blobIndex: 0,
      blobTotal: 2,
      blobHashHex: require('crypto').createHash('sha256').update(Buffer.alloc(4)).digest('hex'),
      merkleRootHex: 'cc'.repeat(32)
    });
    assert.ok(stale.status === 'need_more' || stale.status === 'reject');
  });
});
