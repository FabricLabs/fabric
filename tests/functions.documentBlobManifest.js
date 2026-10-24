'use strict';

const assert = require('assert');
const crypto = require('crypto');
const { MAX_MESSAGE_SIZE } = require('../constants');
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
  verifyBlob,
  reassemble,
  blobPaymentHashHex,
  SEALED_BLOB_CHUNK_BYTES,
  SEALED_FRAME_JSON_OVERHEAD,
  sameIv,
  documentMerkleRootHex,
  documentInclusionProof,
  documentInclusionProofs,
  verifyDocumentInclusion,
  verifyOfferLeaves,
  verifySealedBlobFrame
} = require('../functions/documentBlobManifest');

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

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
    assert.strictEqual(split.index.merkle, 'DocumentTree');
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

  it('split root is the document tree over the blob hashes', function () {
    const data = Buffer.alloc(5000, 3);
    const split = splitBlobs(data, 1200);
    const fromHashes = merkleRootHexFromBlobHashes(split.blobs.map((b) => b.blobHashHex));
    assert.strictEqual(fromHashes, split.merkleRootHex);
    assert.strictEqual(documentMerkleRootHex(split.blobs.map((b) => ({ blobHashHex: b.blobHashHex }))), split.merkleRootHex);
  });

  it('empty content is one empty blob with a document root', function () {
    const split = splitBlobs(Buffer.alloc(0), 64, 'empty');
    assert.strictEqual(split.blobs.length, 1);
    assert.strictEqual(split.blobs[0].size, 0);
    assert.ok(/^[0-9a-f]{64}$/.test(split.merkleRootHex));
    assert.strictEqual(verifyBlobIndex(split.index).ok, true);
  });

  it('compactBlobIndexForWire drops leaves when over budget', function () {
    const many = [];
    // Enough leaves (~120 B each) to exceed the 32 KiB body cap.
    const LEAVES = 400;
    for (let i = 0; i < LEAVES; i++) {
      many.push({
        index: i,
        total: LEAVES,
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

  it('sealed Document roots commit blob hash, payment hash, IV and count', function () {
    const Document = require('../types/document');
    const doc = Document.seal(Buffer.alloc(5000, 7), { chunkBytes: 2048, documentId: 'sealed' });
    const leaves = doc.blobs.map((b) => b.blobHashHex);
    assert.strictEqual(documentMerkleRootHex(doc.blobs), doc.hash);
    assert.notStrictEqual(merkleRootHexFromBlobHashes(leaves), doc.hash);
    const offer = doc.blobs.map((b) => ({ blobHashHex: b.blobHashHex, paymentHashHex: b.paymentHashHex, iv: b.iv }));
    assert.deepStrictEqual(
      verifyOfferLeaves({ merkleRootHex: doc.merkleRootHex, blobTotal: doc.blobTotal, blobs: offer }),
      { ok: true, indexes: [0, 1, 2] }
    );
    for (const leaf of doc.blobs) {
      assert.strictEqual(verifyBlob(doc.bytesFor(leaf.index), leaf.blobHashHex), true);
      // Sealed payment hash is SHA256(K_i), not the plain-blob derivation.
      assert.notStrictEqual(leaf.paymentHashHex, blobPaymentHashHex({
        documentId: 'sealed',
        blobIndex: leaf.index,
        blobHashHex: leaf.blobHashHex
      }));
    }
    // A plain-blob tree over the same plaintext has a different root (ciphertext leaves).
    const plain = Document.fromPlain(Buffer.alloc(5000, 7), { chunkBytes: 2048 });
    assert.notStrictEqual(plain.merkleRootHex, doc.merkleRootHex);
    assert.strictEqual(plain.merkleRootHex, merkleRootHexFromBlobHashes(
      splitBlobs(Buffer.alloc(5000, 7), 2048).blobs.map((b) => b.blobHashHex)
    ));
  });

  describe('CVE-2012-2459 (duplicated last leaf)', function () {
    const a = sha('a');
    const b = sha('b');
    const c = sha('c');

    it('a mutated list has its own root and never verifies against the original', function () {
      const root = merkleRootHexFromBlobHashes([a, b, c]);
      assert.notStrictEqual(root, merkleRootHexFromBlobHashes([a, b, c, c]));
      assert.strictEqual(verifyBlobIndex({ merkleRootHex: root, total: 3 }, [a, b, c]).ok, true);
      assert.strictEqual(verifyBlobIndex({ merkleRootHex: root }, [a, b, c, c]).error, 'merkle/root mismatch');
      assert.strictEqual(verifyOfferLeaves({ merkleRootHex: root, blobTotal: 4, blobs: [a, b, c, c].map((h) => ({ blobHashHex: h })) }).ok, false);
      const parts = ['x', 'y', 'z', 'z'].map((s) => Buffer.from(s));
      const threeRoot = merkleRootHexFromBlobHashes(parts.slice(0, 3).map((p) => sha(p)));
      assert.strictEqual(reassemble(parts, 4, threeRoot).error, 'merkle/root mismatch');
    });

    it('repeated content is committed by the count-bound root, end to end', function () {
      const { DocumentBlobTransferBook, parseFileSendObject } = require('../functions/documentBlobManifest');
      const twin = [a, b, c, c];
      const root = documentMerkleRootHex(twin.map((h) => ({ blobHashHex: h })));
      assert.strictEqual(merkleRootHexFromBlobHashes(twin), root);
      assert.strictEqual(verifyBlobIndex({ merkleRootHex: root, total: 4 }, twin).ok, true);
      // A zero-filled file: four identical chunks.
      const zeros = Buffer.alloc(4 * 1024);
      const split = splitBlobs(zeros, 1024, 'zeros');
      assert.strictEqual(verifyBlobIndex(split.index).ok, true);
      const book = new DocumentBlobTransferBook();
      book.expectTransfer({ documentId: 'zeros', merkleRootHex: split.merkleRootHex, total: 4 });
      let done = null;
      for (const blob of split.blobs) {
        const res = book.ingest(parseFileSendObject({
          name: 'zeros',
          body: blob.bytes.toString('base64'),
          blobIndex: blob.index,
          blobTotal: blob.total,
          blobHashHex: blob.blobHashHex,
          merkleRootHex: split.merkleRootHex,
          contentSha256: split.contentSha256,
          chunkBytes: split.chunkBytes
        }));
        assert.notStrictEqual(res.status, 'reject', res.error);
        if (res.status === 'complete') done = res;
      }
      assert.ok(done && done.buffer.equals(zeros), 'the buyer reassembles the zero-filled file');
    });

    it('roots bind the blob count, so the padded list has a different root', function () {
      const three = [a, b, c].map((h) => ({ blobHashHex: h }));
      const four = [a, b, c, c].map((h) => ({ blobHashHex: h }));
      assert.notStrictEqual(documentMerkleRootHex(three), documentMerkleRootHex(four));
      const root = documentMerkleRootHex(three);
      assert.strictEqual(verifyOfferLeaves({ merkleRootHex: root, blobTotal: 3, blobs: three }).ok, true);
      assert.strictEqual(verifyOfferLeaves({ merkleRootHex: root, blobTotal: 4, blobs: four }).ok, false);
      // Repeated content is fine anywhere (the count disambiguates).
      const dup = documentMerkleRootHex(four);
      assert.strictEqual(verifyOfferLeaves({ merkleRootHex: dup, blobTotal: 4, blobs: four }).ok, true);
    });
  });

  describe('document tree', function () {
    const blobsOf = (n) => Array.from({ length: n }, (_, i) => ({
      blobHashHex: sha(`blob${i}`),
      paymentHashHex: sha(`pay${i}`),
      iv: crypto.createHash('sha256').update(`iv${i}`).digest().subarray(0, 12).toString('base64')
    }));

    it('inclusion proofs open to the root for every index and size', function () {
      for (const n of [1, 2, 3, 4, 5, 7, 8, 9, 17, 33]) {
        const blobs = blobsOf(n);
        const root = documentMerkleRootHex(blobs);
        const proofs = documentInclusionProofs(blobs);
        for (let i = 0; i < n; i++) {
          assert.deepStrictEqual(proofs[i], documentInclusionProof(blobs, i));
          assert.strictEqual(verifyDocumentInclusion(Object.assign({ merkleRootHex: root, blobTotal: n, blobIndex: i, proof: proofs[i] }, blobs[i])), true, `n=${n} i=${i}`);
        }
      }
    });

    it('proofs fail on a wrong index, count, payment hash, IV, or extra node', function () {
      const blobs = blobsOf(5);
      const root = documentMerkleRootHex(blobs);
      const proof = documentInclusionProof(blobs, 2);
      const base = Object.assign({ merkleRootHex: root, blobTotal: 5, blobIndex: 2, proof }, blobs[2]);
      assert.strictEqual(verifyDocumentInclusion(base), true);
      assert.strictEqual(verifyDocumentInclusion(Object.assign({}, base, { blobIndex: 3 })), false);
      assert.strictEqual(verifyDocumentInclusion(Object.assign({}, base, { blobTotal: 6 })), false);
      assert.strictEqual(verifyDocumentInclusion(Object.assign({}, base, { paymentHashHex: sha('other') })), false);
      assert.strictEqual(verifyDocumentInclusion(Object.assign({}, base, { iv: Buffer.alloc(12).toString('base64') })), false);
      assert.strictEqual(verifyDocumentInclusion(Object.assign({}, base, { iv: 'ab'.repeat(12) })), false);
      assert.strictEqual(verifyDocumentInclusion(Object.assign({}, base, { proof: proof.concat([sha('x')]) })), false);
      assert.strictEqual(verifyDocumentInclusion(Object.assign({}, base, { proof: proof.slice(1) })), false);
    });

    it('compares IVs as decoded bytes, accepting only canonical 12-byte base64', function () {
      const blobs = blobsOf(3);
      const root = documentMerkleRootHex(blobs);
      const raw = Buffer.from(blobs[1].iv, 'base64');
      assert.strictEqual(sameIv(blobs[1].iv, raw), true);
      assert.strictEqual(sameIv(blobs[1].iv, blobs[2].iv), false);
      assert.strictEqual(sameIv(blobs[1].iv, `${blobs[1].iv}\n`), true);
      assert.strictEqual(sameIv('ab'.repeat(12), 'ab'.repeat(12)), false);
      assert.strictEqual(sameIv(null, null), false);
      assert.strictEqual(verifyDocumentInclusion(Object.assign({}, blobs[1], {
        iv: raw, merkleRootHex: root, blobTotal: 3, blobIndex: 1, proof: documentInclusionProof(blobs, 1)
      })), true);
    });

    it('verifyOfferLeaves checks a partial offer only through per-blob proofs', function () {
      const blobs = blobsOf(6);
      const root = documentMerkleRootHex(blobs);
      const subset = [1, 4].map((i) => Object.assign({ index: i, proof: documentInclusionProof(blobs, i) }, blobs[i]));
      assert.deepStrictEqual(
        verifyOfferLeaves({ merkleRootHex: root, blobTotal: 6, blobs: subset }),
        { ok: true, indexes: [1, 4] }
      );
      const noProof = subset.map((b) => Object.assign({}, b, { proof: undefined }));
      assert.strictEqual(verifyOfferLeaves({ merkleRootHex: root, blobTotal: 6, blobs: noProof }).ok, false);
      const swapped = [Object.assign({}, subset[0], { paymentHashHex: sha('swap') }), subset[1]];
      const out = verifyOfferLeaves({ merkleRootHex: root, blobTotal: 6, blobs: swapped });
      assert.strictEqual(out.ok, false);
      assert.strictEqual(out.index, 1);
      // contentHashHex is accepted as the payment-hash alias (offer-book rows).
      const alias = subset.map((b) => Object.assign({}, b, { paymentHashHex: undefined, contentHashHex: b.paymentHashHex }));
      assert.strictEqual(verifyOfferLeaves({ merkleRootHex: root, blobTotal: 6, blobs: alias }).ok, true);
    });

    it('verifyOfferLeaves rejects a root that does not commit the payment hashes', function () {
      const blobs = blobsOf(3);
      const bare = merkleRootHexFromBlobHashes(blobs.map((b) => b.blobHashHex));
      assert.strictEqual(verifyOfferLeaves({ merkleRootHex: bare, blobTotal: 3, blobs }).ok, false);
      assert.strictEqual(verifyOfferLeaves({ merkleRootHex: documentMerkleRootHex(blobs), blobTotal: 3, blobs: [blobs[0], blobs[0]].map((b) => Object.assign({ index: 0 }, b)) }).error, 'duplicate blob index');
    });

    it('verifySealedBlobFrame checks a free ciphertext frame before payment', function () {
      const Document = require('../types/document');
      const doc = Document.seal(crypto.randomBytes(50000), { documentId: 'frames' });
      const frames = doc.fileSendObjects();
      assert.strictEqual(frames.length, doc.blobTotal);
      const expected = { merkleRootHex: doc.merkleRootHex, blobTotal: doc.blobTotal };
      for (const f of frames) {
        const out = verifySealedBlobFrame(f, expected);
        assert.strictEqual(out.ok, true, out.error);
        assert.strictEqual(out.blobIndex, f.blobIndex);
        assert.strictEqual(out.paymentHashHex, doc.paymentHashFor(f.blobIndex));
      }
      const forged = Object.assign({}, frames[0], { paymentHashHex: sha('attacker') });
      assert.strictEqual(verifySealedBlobFrame(forged, expected).error, 'inclusion proof does not open to merkleRootHex');
      const noProof = Object.assign({}, frames[0], { proof: undefined });
      assert.strictEqual(verifySealedBlobFrame(noProof, expected).error, 'missing inclusion proof');
      // A frame without its proof cannot plant an uncommitted payment hash.
      const downgraded = Object.assign({}, frames[0], { proof: undefined, paymentHashHex: sha('attacker') });
      const pinned = Object.assign({ blobHashHex: frames[0].blobHashHex }, expected);
      assert.strictEqual(verifySealedBlobFrame(downgraded, pinned).error, 'missing inclusion proof');
      assert.strictEqual(verifySealedBlobFrame(frames[0], Object.assign({}, expected, { blobTotal: doc.blobTotal + 1 })).error, 'blobTotal mismatch');
      assert.strictEqual(verifySealedBlobFrame(frames[1], Object.assign({}, expected, { blobIndex: 0 })).error, 'blobIndex mismatch');
      const tampered = Object.assign({}, frames[0], { body: Buffer.from('nope').toString('base64') });
      assert.strictEqual(verifySealedBlobFrame(tampered, expected).ok, false);
    });

    it('a worst-case sealed frame fits one AMP message', function () {
      const Document = require('../types/document');
      const doc = Document.seal(crypto.randomBytes(SEALED_BLOB_CHUNK_BYTES * 4100 + 1), { documentId: 'x'.repeat(200) });
      assert.ok(doc.blobTotal > 4096, 'needs a 13-node proof');
      const frame = doc.fileSendObjects({ indexes: [0] })[0];
      assert.strictEqual(frame.proof.length, 13);
      const bytes = Buffer.byteLength(JSON.stringify(frame));
      assert.ok(bytes <= MAX_MESSAGE_SIZE, `${bytes} > ${MAX_MESSAGE_SIZE}`);
      assert.ok(Math.ceil(SEALED_BLOB_CHUNK_BYTES / 3) * 4 + SEALED_FRAME_JSON_OVERHEAD <= MAX_MESSAGE_SIZE);
    });
  });
});
