'use strict';

const assert = require('assert');
const crypto = require('crypto');
const Document = require('../types/document');
const Market = require('../services/market');
const { DOCUMENT_L1_BATCH_BLOBS, MAX_DOCUMENT_BLOBS } = require('../constants');
const { createBlobBatch, openBlobBatch } = require('../functions/documentSealedExchange');

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

  it('packs a maximum file into 1458 batches of 128', function () {
    const batches = Math.ceil(MAX_DOCUMENT_BLOBS / DOCUMENT_L1_BATCH_BLOBS);
    assert.strictEqual(DOCUMENT_L1_BATCH_BLOBS, 128);
    assert.strictEqual(batches, 1458);
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

  it('asks for quotes on mainnet and batches consecutive blobs', function () {
    const market = new Market({ budgetSats: 1, tickMs: 0, network: 'mainnet' });
    assert.strictEqual(market.settings.quotes, true);
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
