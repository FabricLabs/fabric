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
} = require('../functions/documentBlobTransfer');
const { DocumentOfferBook } = require('../functions/documentOfferBook');
const {
  createDocumentPurchaseSession,
  isDuplicateSettlement,
  rememberSettlement
} = require('../functions/documentPurchaseSession');

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
});
