'use strict';

const assert = require('assert');
const crypto = require('crypto');
const { MAX_MESSAGE_SIZE } = require('../constants');
const Tree = require('../types/tree');
const {
  DEFAULT_BLOB_CHUNK_BYTES,
  DEFAULT_CHUNK_BYTES,
  BLOB_INDEX_TYPE,
  BLOB_INDEX_SCHEMA_VERSION,
  splitBlobs,
  buildBlobIndex,
  compactBlobIndexForWire,
  advertiseDocumentBlobs,
  verifyBlobIndex,
  merkleRootHexFromBlobHashes,
  accumulateBlobLeaf,
  createBlobMerkleTree,
  verifyBlob,
  reassemble,
  blobPaymentHashHex
} = require('../functions/documentBlobManifest');

describe('functions/documentBlobManifest', function () {
  it('defaults chunk size under AMP body budget', function () {
    assert.ok(DEFAULT_BLOB_CHUNK_BYTES < MAX_MESSAGE_SIZE);
    assert.ok(DEFAULT_BLOB_CHUNK_BYTES <= Math.floor(MAX_MESSAGE_SIZE * 0.75));
    assert.strictEqual(DEFAULT_CHUNK_BYTES, DEFAULT_BLOB_CHUNK_BYTES);
  });

  it('always emits an index — single blob for small files', function () {
    const data = Buffer.from('hello fabric');
    const split = splitBlobs(data, DEFAULT_BLOB_CHUNK_BYTES, 'doc/small');
    assert.strictEqual(split.blobs.length, 1);
    assert.ok(split.index);
    assert.strictEqual(split.index['@type'], BLOB_INDEX_TYPE);
    assert.strictEqual(split.index.schemaVersion, BLOB_INDEX_SCHEMA_VERSION);
    assert.strictEqual(split.index.merkle, 'Tree');
    assert.strictEqual(split.index.blobs.length, 1);
    assert.strictEqual(split.index.total, 1);
    assert.ok(verifyBlob(split.blobs[0].bytes, split.blobs[0].blobHashHex));
    assert.strictEqual(verifyBlobIndex(split.index).ok, true);
  });

  it('lists many blobs for content larger than the chunk limit', function () {
    const chunk = 1000;
    const data = Buffer.alloc(3500, 9);
    const split = splitBlobs(data, chunk, 'doc/big');
    assert.strictEqual(split.blobs.length, 4);
    assert.strictEqual(split.index.blobs.length, 4);
    assert.strictEqual(split.index.total, 4);
    const map = new Map(split.blobs.map((b) => [b.index, b.bytes]));
    const out = reassemble(map, 4, split.merkleRootHex);
    assert.strictEqual(out.ok, true);
    assert.ok(out.buffer.equals(data));
  });

  it('Tree root matches merkleRootHexFromBlobHashes / accumulateBlobLeaf', function () {
    const data = Buffer.alloc(5000, 3);
    const split = splitBlobs(data, 1200);
    const fromHashes = merkleRootHexFromBlobHashes(split.blobs.map((b) => b.blobHashHex));
    assert.strictEqual(fromHashes, split.merkleRootHex);

    let tree = new Tree({ leaves: [] });
    for (const b of split.blobs) {
      tree = accumulateBlobLeaf(tree, b.blobHashHex);
    }
    assert.strictEqual(tree.rootHex, split.merkleRootHex);
    assert.strictEqual(tree.settings.leaves.length, split.blobs.length);

    const direct = createBlobMerkleTree(split.blobs.map((b) => b.blobHashHex));
    assert.strictEqual(direct.rootHex, split.merkleRootHex);
  });

  it('empty content is one empty blob with a Tree root', function () {
    const split = splitBlobs(Buffer.alloc(0), 64, 'empty');
    assert.strictEqual(split.blobs.length, 1);
    assert.strictEqual(split.blobs[0].size, 0);
    assert.ok(/^[0-9a-f]{64}$/.test(split.merkleRootHex));
    assert.strictEqual(verifyBlobIndex(split.index).ok, true);
  });

  it('compactBlobIndexForWire drops leaves when over budget', function () {
    const many = [];
    for (let i = 0; i < 80; i++) {
      many.push({
        index: i,
        total: 80,
        blobHashHex: crypto.createHash('sha256').update(String(i)).digest('hex'),
        size: DEFAULT_BLOB_CHUNK_BYTES
      });
    }
    const root = merkleRootHexFromBlobHashes(many.map((b) => b.blobHashHex));
    const full = buildBlobIndex({
      documentId: 'huge',
      merkleRootHex: root,
      contentSha256: crypto.createHash('sha256').update('x').digest('hex'),
      chunkBytes: DEFAULT_BLOB_CHUNK_BYTES,
      blobs: many
    });
    assert.ok(Buffer.byteLength(JSON.stringify(full), 'utf8') > MAX_MESSAGE_SIZE);
    const compact = compactBlobIndexForWire(full, MAX_MESSAGE_SIZE);
    assert.strictEqual(compact.leavesInline, false);
    assert.deepStrictEqual(compact.blobs, []);
    assert.ok(Buffer.byteLength(JSON.stringify(compact), 'utf8') <= MAX_MESSAGE_SIZE);
    assert.strictEqual(verifyBlobIndex(compact, many.map((b) => b.blobHashHex)).ok, true);
  });

  it('advertiseDocumentBlobs always attaches index + payment hashes', function () {
    const adv = advertiseDocumentBlobs(Buffer.from('paid'), {
      documentId: 'd1',
      rateSats: 100,
      chunkBytes: 64
    });
    assert.ok(adv.index);
    assert.ok(adv.itemBlobs.length >= 1);
    assert.ok(adv.itemBlobs[0].contentHash);
    assert.strictEqual(
      adv.itemBlobs[0].contentHash,
      blobPaymentHashHex({
        documentId: 'd1',
        blobIndex: 0,
        blobHashHex: adv.itemBlobs[0].blobHashHex
      })
    );
  });
});
