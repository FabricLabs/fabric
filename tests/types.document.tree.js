'use strict';

const assert = require('assert');
const crypto = require('crypto');
const { MAX_MESSAGE_SIZE } = require('../constants');
const Document = require('../types/document');
const DocumentBlobTransferBook = require('../types/documentBlobTransferBook');

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

describe('Document blob tree', function () {
  it('defaults chunk size under AMP body budget', function () {
    assert.ok(Document.CHUNK_BYTES < MAX_MESSAGE_SIZE);
    assert.ok(Document.CHUNK_BYTES <= Math.floor(MAX_MESSAGE_SIZE * 0.75));
    assert.strictEqual(Document.CHUNK_BYTES, Document.CHUNK_BYTES);
  });

  it('always emits an index — single blob for small files', function () {
    const data = Buffer.from('hello fabric');
    const split = Document.split(data, Document.CHUNK_BYTES, 'doc/small');
    assert.strictEqual(split.blobs.length, 1);
    assert.ok(split.index);
    assert.strictEqual(split.index['@type'], Document.BLOB_INDEX_TYPE);
    assert.strictEqual(split.index.schemaVersion, undefined);
    assert.strictEqual(split.index.merkle, 'DocumentTree');
    assert.strictEqual(split.index.blobs.length, 1);
    assert.strictEqual(split.index.total, 1);
    assert.ok(Document.verifyBlob(split.blobs[0].bytes, split.blobs[0].blobHashHex));
    assert.strictEqual(Document.verifyBlobIndex(split.index).ok, true);
  });

  it('lists many blobs for content larger than the chunk limit', function () {
    const chunk = 1000;
    const data = Buffer.alloc(3500, 9);
    const split = Document.split(data, chunk, 'doc/big');
    assert.strictEqual(split.blobs.length, 4);
    assert.strictEqual(split.index.blobs.length, 4);
    assert.strictEqual(split.index.total, 4);
    const map = new Map(split.blobs.map((b) => [b.index, b.bytes]));
    const out = Document.reassemble(map, 4, split.merkleRootHex);
    assert.strictEqual(out.ok, true);
    assert.ok(out.buffer.equals(data));
  });

  it('split root is the document tree over the blob hashes', function () {
    const data = Buffer.alloc(5000, 3);
    const split = Document.split(data, 1200);
    const fromHashes = Document.rootHexFromBlobHashes(split.blobs.map((b) => b.blobHashHex));
    assert.strictEqual(fromHashes, split.merkleRootHex);
    assert.strictEqual(Document.rootHex(split.blobs.map((b) => ({ blobHashHex: b.blobHashHex }))), split.merkleRootHex);
  });

  it('empty content is one empty blob with a document root', function () {
    const split = Document.split(Buffer.alloc(0), 64, 'empty');
    assert.strictEqual(split.blobs.length, 1);
    assert.strictEqual(split.blobs[0].size, 0);
    assert.ok(/^[0-9a-f]{64}$/.test(split.merkleRootHex));
    assert.strictEqual(Document.verifyBlobIndex(split.index).ok, true);
  });

  it('caps a document at the FAT16 and FAT32 file size', function () {
    const {
      MAX_DOCUMENT_BYTES,
      MAX_DOCUMENT_BLOBS,
      DOCUMENT_SEALED_PLAINTEXT_BYTES,
      DOCUMENT_SEALED_FRAME_OVERHEAD
    } = require('../constants');
    assert.strictEqual(MAX_DOCUMENT_BYTES, 0xFFFFFFFF);
    assert.strictEqual(Document.MAX_BYTES, MAX_DOCUMENT_BYTES);
    assert.ok(DOCUMENT_SEALED_PLAINTEXT_BYTES < Document.CHUNK_BYTES);
    assert.strictEqual(MAX_DOCUMENT_BLOBS, Math.ceil(MAX_DOCUMENT_BYTES / DOCUMENT_SEALED_PLAINTEXT_BYTES));
    assert.ok(Math.ceil(MAX_DOCUMENT_BYTES / Document.CHUNK_BYTES) <= MAX_DOCUMENT_BLOBS);
    Document.checkFileSize(MAX_DOCUMENT_BYTES);
    assert.throws(() => Document.checkFileSize(MAX_DOCUMENT_BYTES + 1), /4294967295/);

    const layers = [MAX_DOCUMENT_BLOBS];
    let width = MAX_DOCUMENT_BLOBS;
    while (width > 1) {
      width = Math.ceil(width / 2);
      layers.push(width);
    }
    let proofLen = 0;
    for (let i = 0; i < MAX_DOCUMENT_BLOBS; i++) {
      let idx = i;
      let len = 0;
      for (let level = 0; level < layers.length - 1; level++) {
        const sibling = idx % 2 ? idx - 1 : idx + 1;
        if (sibling < layers[level]) len++;
        idx = idx >> 1;
      }
      if (len > proofLen) proofLen = len;
    }
    const body = 'A'.repeat(Math.ceil(Document.SEALED_CHUNK_BYTES / 3) * 4);
    const frame = {
      name: 'ab'.repeat(32),
      body,
      blobIndex: MAX_DOCUMENT_BLOBS - 1,
      blobTotal: MAX_DOCUMENT_BLOBS,
      blobHashHex: 'ab'.repeat(32),
      merkleRootHex: 'cd'.repeat(32),
      chunkBytes: Document.SEALED_CHUNK_BYTES,
      sealed: true,
      perBlob: true,
      paymentHashHex: 'ef'.repeat(32),
      iv: Buffer.alloc(12).toString('base64'),
      scheme: 'aes-256-gcm-convergent',
      convergence: 'public',
      proof: Array.from({ length: proofLen }, () => '12'.repeat(32))
    };
    const json = JSON.stringify(frame);
    assert.ok(Buffer.byteLength(json) <= MAX_MESSAGE_SIZE);
    assert.ok(Buffer.byteLength(json) - body.length <= DOCUMENT_SEALED_FRAME_OVERHEAD);
  });

  it('refuses to split into more than MAX_DOCUMENT_BLOBS blobs before hashing any', function () {
    const { MAX_DOCUMENT_BLOBS } = require('../constants');
    const data = Buffer.alloc(MAX_DOCUMENT_BLOBS + 1, 1);
    assert.throws(() => Document.split(data, 1), new RegExp(`${MAX_DOCUMENT_BLOBS + 1} blobs`));
    assert.strictEqual(Document.split(data.subarray(0, MAX_DOCUMENT_BLOBS), 1).blobs.length, MAX_DOCUMENT_BLOBS);
  });

  it('verifyBlobIndex reports too many leaves and a malformed payment hash instead of throwing', function () {
    const { MAX_DOCUMENT_BLOBS } = require('../constants');
    const leaf = sha('leaf');
    const many = new Array(MAX_DOCUMENT_BLOBS + 1).fill(leaf);
    const tooMany = Document.verifyBlobIndex({ merkleRootHex: '' }, many);
    assert.strictEqual(tooMany.ok, false);
    assert.ok(/blobs/.test(tooMany.error));
    const badHash = Document.verifyBlobIndex({ merkleRootHex: '' }, [leaf], { paymentHashHex: 'zz' });
    assert.strictEqual(badHash.ok, false);
    assert.ok(/paymentHashHex/.test(badHash.error));
  });

  it('Document.compactBlobIndex drops leaves when over budget', function () {
    const many = [];
    // Enough leaves (~120 B each) to exceed the 32 KiB body cap.
    const LEAVES = 400;
    for (let i = 0; i < LEAVES; i++) {
      many.push({
        index: i,
        total: LEAVES,
        blobHashHex: crypto.createHash('sha256').update(String(i)).digest('hex'),
        size: Document.CHUNK_BYTES
      });
    }
    const root = Document.rootHexFromBlobHashes(many.map((b) => b.blobHashHex));
    const full = Document.blobIndex({
      documentId: 'huge',
      merkleRootHex: root,
      contentSha256: crypto.createHash('sha256').update('x').digest('hex'),
      chunkBytes: Document.CHUNK_BYTES,
      blobs: many
    });
    assert.ok(Buffer.byteLength(JSON.stringify(full), 'utf8') > MAX_MESSAGE_SIZE);
    const compact = Document.compactBlobIndex(full, MAX_MESSAGE_SIZE);
    assert.strictEqual(compact.leavesInline, false);
    assert.deepStrictEqual(compact.blobs, []);
    assert.ok(Buffer.byteLength(JSON.stringify(compact), 'utf8') <= MAX_MESSAGE_SIZE);
    assert.strictEqual(Document.verifyBlobIndex(compact, many.map((b) => b.blobHashHex)).ok, true);
  });

  it('Document.advertise always attaches index + payment hashes', function () {
    const adv = Document.advertise(Buffer.from('paid'), {
      documentId: 'd1',
      rateSats: 100,
      chunkBytes: 64
    });
    assert.ok(adv.index);
    assert.ok(adv.itemBlobs.length >= 1);
    assert.ok(adv.itemBlobs[0].contentHash);
    assert.strictEqual(
      adv.itemBlobs[0].contentHash,
      Document.blobPaymentHash({
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
    assert.strictEqual(Document.rootHex(doc.blobs), doc.hash);
    assert.notStrictEqual(Document.rootHexFromBlobHashes(leaves), doc.hash);
    const offer = doc.blobs.map((b) => ({ blobHashHex: b.blobHashHex, paymentHashHex: b.paymentHashHex, iv: b.iv }));
    assert.deepStrictEqual(
      Document.verifyOfferLeaves({ merkleRootHex: doc.merkleRootHex, blobTotal: doc.blobTotal, blobs: offer }),
      { ok: true, indexes: [0, 1, 2] }
    );
    for (const leaf of doc.blobs) {
      assert.strictEqual(Document.verifyBlob(doc.bytesFor(leaf.index), leaf.blobHashHex), true);
      // Sealed payment hash is SHA256(K_i), not the plain-blob derivation.
      assert.notStrictEqual(leaf.paymentHashHex, Document.blobPaymentHash({
        documentId: 'sealed',
        blobIndex: leaf.index,
        blobHashHex: leaf.blobHashHex
      }));
    }
    // A plain-blob tree over the same plaintext has a different root (ciphertext leaves).
    const plain = Document.fromPlain(Buffer.alloc(5000, 7), { chunkBytes: 2048 });
    assert.notStrictEqual(plain.merkleRootHex, doc.merkleRootHex);
    assert.strictEqual(plain.merkleRootHex, Document.rootHexFromBlobHashes(
      Document.split(Buffer.alloc(5000, 7), 2048).blobs.map((b) => b.blobHashHex)
    ));
  });

  describe('CVE-2012-2459 (duplicated last leaf)', function () {
    const a = sha('a');
    const b = sha('b');
    const c = sha('c');

    it('a mutated list has its own root and never verifies against the original', function () {
      const root = Document.rootHexFromBlobHashes([a, b, c]);
      assert.notStrictEqual(root, Document.rootHexFromBlobHashes([a, b, c, c]));
      assert.strictEqual(Document.verifyBlobIndex({ merkleRootHex: root, total: 3 }, [a, b, c]).ok, true);
      assert.strictEqual(Document.verifyBlobIndex({ merkleRootHex: root }, [a, b, c, c]).error, 'merkle/root mismatch');
      assert.strictEqual(Document.verifyOfferLeaves({ merkleRootHex: root, blobTotal: 4, blobs: [a, b, c, c].map((h) => ({ blobHashHex: h })) }).ok, false);
      const parts = ['x', 'y', 'z', 'z'].map((s) => Buffer.from(s));
      const threeRoot = Document.rootHexFromBlobHashes(parts.slice(0, 3).map((p) => sha(p)));
      assert.strictEqual(Document.reassemble(parts, 4, threeRoot).error, 'merkle/root mismatch');
    });

    it('repeated content is committed by the count-bound root, end to end', function () {
      const twin = [a, b, c, c];
      const root = Document.rootHex(twin.map((h) => ({ blobHashHex: h })));
      assert.strictEqual(Document.rootHexFromBlobHashes(twin), root);
      assert.strictEqual(Document.verifyBlobIndex({ merkleRootHex: root, total: 4 }, twin).ok, true);
      // A zero-filled file: four identical chunks.
      const zeros = Buffer.alloc(4 * 1024);
      const split = Document.split(zeros, 1024, 'zeros');
      assert.strictEqual(Document.verifyBlobIndex(split.index).ok, true);
      const book = new DocumentBlobTransferBook();
      book.expectTransfer({ documentId: 'zeros', merkleRootHex: split.merkleRootHex, total: 4 });
      let done = null;
      for (const blob of split.blobs) {
        const res = book.ingest(DocumentBlobTransferBook.parseFrame({
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
      assert.notStrictEqual(Document.rootHex(three), Document.rootHex(four));
      const root = Document.rootHex(three);
      assert.strictEqual(Document.verifyOfferLeaves({ merkleRootHex: root, blobTotal: 3, blobs: three }).ok, true);
      assert.strictEqual(Document.verifyOfferLeaves({ merkleRootHex: root, blobTotal: 4, blobs: four }).ok, false);
      // Repeated content is fine anywhere (the count disambiguates).
      const dup = Document.rootHex(four);
      assert.strictEqual(Document.verifyOfferLeaves({ merkleRootHex: dup, blobTotal: 4, blobs: four }).ok, true);
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
        const root = Document.rootHex(blobs);
        const proofs = Document.inclusionProofs(blobs);
        for (let i = 0; i < n; i++) {
          assert.deepStrictEqual(proofs[i], Document.inclusionProof(blobs, i));
          assert.strictEqual(Document.verifyInclusion(Object.assign({ merkleRootHex: root, blobTotal: n, blobIndex: i, proof: proofs[i] }, blobs[i])), true, `n=${n} i=${i}`);
        }
      }
    });

    it('proofs fail on a wrong index, count, payment hash, IV, or extra node', function () {
      const blobs = blobsOf(5);
      const root = Document.rootHex(blobs);
      const proof = Document.inclusionProof(blobs, 2);
      const base = Object.assign({ merkleRootHex: root, blobTotal: 5, blobIndex: 2, proof }, blobs[2]);
      assert.strictEqual(Document.verifyInclusion(base), true);
      assert.strictEqual(Document.verifyInclusion(Object.assign({}, base, { blobIndex: 3 })), false);
      assert.strictEqual(Document.verifyInclusion(Object.assign({}, base, { blobTotal: 6 })), false);
      assert.strictEqual(Document.verifyInclusion(Object.assign({}, base, { paymentHashHex: sha('other') })), false);
      assert.strictEqual(Document.verifyInclusion(Object.assign({}, base, { iv: Buffer.alloc(12).toString('base64') })), false);
      assert.strictEqual(Document.verifyInclusion(Object.assign({}, base, { iv: 'ab'.repeat(12) })), false);
      assert.strictEqual(Document.verifyInclusion(Object.assign({}, base, { proof: proof.concat([sha('x')]) })), false);
      assert.strictEqual(Document.verifyInclusion(Object.assign({}, base, { proof: proof.slice(1) })), false);
    });

    it('compares IVs as decoded bytes, accepting only canonical 12-byte base64', function () {
      const blobs = blobsOf(3);
      const root = Document.rootHex(blobs);
      const raw = Buffer.from(blobs[1].iv, 'base64');
      assert.strictEqual(Document.sameIv(blobs[1].iv, raw), true);
      assert.strictEqual(Document.sameIv(blobs[1].iv, blobs[2].iv), false);
      assert.strictEqual(Document.sameIv(blobs[1].iv, `${blobs[1].iv}\n`), true);
      assert.strictEqual(Document.sameIv('ab'.repeat(12), 'ab'.repeat(12)), false);
      assert.strictEqual(Document.sameIv(null, null), false);
      assert.strictEqual(Document.verifyInclusion(Object.assign({}, blobs[1], {
        iv: raw, merkleRootHex: root, blobTotal: 3, blobIndex: 1, proof: Document.inclusionProof(blobs, 1)
      })), true);
    });

    it('Document.verifyOfferLeaves checks a partial offer only through per-blob proofs', function () {
      const blobs = blobsOf(6);
      const root = Document.rootHex(blobs);
      const subset = [1, 4].map((i) => Object.assign({ index: i, proof: Document.inclusionProof(blobs, i) }, blobs[i]));
      assert.deepStrictEqual(
        Document.verifyOfferLeaves({ merkleRootHex: root, blobTotal: 6, blobs: subset }),
        { ok: true, indexes: [1, 4] }
      );
      const noProof = subset.map((b) => Object.assign({}, b, { proof: undefined }));
      assert.strictEqual(Document.verifyOfferLeaves({ merkleRootHex: root, blobTotal: 6, blobs: noProof }).ok, false);
      const swapped = [Object.assign({}, subset[0], { paymentHashHex: sha('swap') }), subset[1]];
      const out = Document.verifyOfferLeaves({ merkleRootHex: root, blobTotal: 6, blobs: swapped });
      assert.strictEqual(out.ok, false);
      assert.strictEqual(out.index, 1);
      // contentHashHex is accepted as the payment-hash alias (offer-book rows).
      const alias = subset.map((b) => Object.assign({}, b, { paymentHashHex: undefined, contentHashHex: b.paymentHashHex }));
      assert.strictEqual(Document.verifyOfferLeaves({ merkleRootHex: root, blobTotal: 6, blobs: alias }).ok, true);
    });

    it('Document.verifyOfferLeaves rejects a root that does not commit the payment hashes', function () {
      const blobs = blobsOf(3);
      const bare = Document.rootHexFromBlobHashes(blobs.map((b) => b.blobHashHex));
      assert.strictEqual(Document.verifyOfferLeaves({ merkleRootHex: bare, blobTotal: 3, blobs }).ok, false);
      assert.strictEqual(Document.verifyOfferLeaves({ merkleRootHex: Document.rootHex(blobs), blobTotal: 3, blobs: [blobs[0], blobs[0]].map((b) => Object.assign({ index: 0 }, b)) }).error, 'duplicate blob index');
    });

    it('DocumentBlobTransferBook.verifySealedFrame checks a free ciphertext frame before payment', function () {
      const Document = require('../types/document');
      const doc = Document.seal(crypto.randomBytes(50000), { documentId: 'frames' });
      const frames = doc.fileSendObjects();
      assert.strictEqual(frames.length, doc.blobTotal);
      const expected = { merkleRootHex: doc.merkleRootHex, blobTotal: doc.blobTotal };
      for (const f of frames) {
        const out = DocumentBlobTransferBook.verifySealedFrame(f, expected);
        assert.strictEqual(out.ok, true, out.error);
        assert.strictEqual(out.blobIndex, f.blobIndex);
        assert.strictEqual(out.paymentHashHex, doc.paymentHashFor(f.blobIndex));
      }
      const forged = Object.assign({}, frames[0], { paymentHashHex: sha('attacker') });
      assert.strictEqual(DocumentBlobTransferBook.verifySealedFrame(forged, expected).error, 'inclusion proof does not open to merkleRootHex');
      const noProof = Object.assign({}, frames[0], { proof: undefined });
      assert.strictEqual(DocumentBlobTransferBook.verifySealedFrame(noProof, expected).error, 'missing inclusion proof');
      // A frame without its proof cannot plant an uncommitted payment hash.
      const downgraded = Object.assign({}, frames[0], { proof: undefined, paymentHashHex: sha('attacker') });
      const pinned = Object.assign({ blobHashHex: frames[0].blobHashHex }, expected);
      assert.strictEqual(DocumentBlobTransferBook.verifySealedFrame(downgraded, pinned).error, 'missing inclusion proof');
      assert.strictEqual(DocumentBlobTransferBook.verifySealedFrame(frames[0], Object.assign({}, expected, { blobTotal: doc.blobTotal + 1 })).error, 'blobTotal mismatch');
      assert.strictEqual(DocumentBlobTransferBook.verifySealedFrame(frames[1], Object.assign({}, expected, { blobIndex: 0 })).error, 'blobIndex mismatch');
      const tampered = Object.assign({}, frames[0], { body: Buffer.from('nope').toString('base64') });
      assert.strictEqual(DocumentBlobTransferBook.verifySealedFrame(tampered, expected).ok, false);
    });

    it('DocumentBlobTransferBook.verifySealedFrame opens a whole-document frame whose IV is not in the tree', function () {
      const bodies = [crypto.randomBytes(100), crypto.randomBytes(100)];
      const paymentHashHex = sha('whole document');
      const blobs = bodies.map((b) => ({ blobHashHex: crypto.createHash('sha256').update(b).digest('hex'), paymentHashHex }));
      const merkleRootHex = Document.rootHex(blobs);
      const frame = {
        documentId: 'whole',
        sealed: true,
        blobIndex: 1,
        blobTotal: 2,
        blobHashHex: blobs[1].blobHashHex,
        merkleRootHex,
        paymentHashHex,
        iv: crypto.randomBytes(12).toString('hex'),
        proof: Document.inclusionProof(blobs, 1),
        body: bodies[1].toString('base64')
      };
      const out = DocumentBlobTransferBook.verifySealedFrame(frame, { merkleRootHex, blobTotal: 2 });
      assert.strictEqual(out.ok, true, out.error);
      assert.strictEqual(out.iv, frame.iv);
      // A per-blob frame commits its IV: the same proof no longer opens.
      assert.strictEqual(DocumentBlobTransferBook.verifySealedFrame(Object.assign({}, frame, { perBlob: true }), { merkleRootHex, blobTotal: 2 }).error, 'inclusion proof does not open to merkleRootHex');
    });

    it('reassemble accepts a whole-content hash as the root only without leaf metadata', function () {
      const parts = [crypto.randomBytes(64), crypto.randomBytes(64)];
      const full = crypto.createHash('sha256').update(Buffer.concat(parts)).digest('hex');
      assert.strictEqual(Document.reassemble(parts, 2, full).ok, true);
      const leaves = [{ paymentHashHex: sha('a') }, { paymentHashHex: sha('a') }];
      assert.strictEqual(Document.reassemble(parts, 2, full, { leaves }).error, 'merkle/root mismatch');
    });

    it('a worst-case sealed frame fits one AMP message', function () {
      const Document = require('../types/document');
      const doc = Document.seal(crypto.randomBytes(Document.SEALED_CHUNK_BYTES * 4100 + 1), { documentId: 'x'.repeat(200) });
      assert.ok(doc.blobTotal > 4096, 'needs a 13-node proof');
      const frame = doc.fileSendObjects({ indexes: [0] })[0];
      assert.strictEqual(frame.proof.length, 13);
      const bytes = Buffer.byteLength(JSON.stringify(frame));
      assert.ok(bytes <= MAX_MESSAGE_SIZE, `${bytes} > ${MAX_MESSAGE_SIZE}`);
      assert.ok(Math.ceil(Document.SEALED_CHUNK_BYTES / 3) * 4 + Document.SEALED_FRAME_OVERHEAD <= MAX_MESSAGE_SIZE);
    });
  });
});
