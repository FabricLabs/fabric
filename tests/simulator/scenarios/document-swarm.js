'use strict';

const assert = require('assert');
const { composeUseCases } = require('../usecases');
const { splitBlobs } = require('../../../functions/documentBlobManifest');
const {
  DocumentBlobTransferBook,
  parseFileSendObject
} = require('../../../functions/documentBlobTransfer');
const { DocumentOfferBook } = require('../../../functions/documentOfferBook');
const { blobPaymentHashHex } = require('../../../functions/documentBlobManifest');

const packs = composeUseCases(['document-market', 'gossip']);

module.exports = {
  name: 'document-swarm',
  peerCount: 4,
  topology: 'star',
  steps: 24,
  seed: 77,
  weightMaps: packs.weightMaps,
  setup: packs.setup,
  assert (ctx) {
    const dm = ctx.state && ctx.state.documentMarket;
    if (!dm || dm.sellerCount < 2) {
      throw new Error('expected multiple sellers seeded with sim/large');
    }
    const holders = (ctx.network.peers || []).filter((p) => {
      const docs = p && p._state && p._state.content && p._state.content.documents;
      return docs && Object.prototype.hasOwnProperty.call(docs, 'sim/large');
    });
    if (holders.length < 2) throw new Error('expected sim/large on multiple peers');

    // Fund-safety probe: honest multi-blob path reassembles; tampered bytes rejected.
    const seller = holders[0];
    const buyer = (ctx.network.peers || []).find((p) => p !== seller) || holders[1];
    const body = seller._state.content.documents['sim/large'];
    const chunkBytes = Math.max(256, Number(seller.settings.inventoryBlobChunkBytes) || 1000);
    // Force multi-blob even for 1200-byte seed when chunk is small.
    const split = splitBlobs(Buffer.from(String(body), 'utf8'), Math.min(chunkBytes, 400), 'sim/large');
    assert.ok(split.blobs.length >= 1);

    const book = new DocumentBlobTransferBook();
    book.expectTransfer({
      documentId: 'sim/large',
      merkleRootHex: split.merkleRootHex,
      total: split.blobs.length,
      blobHashHexes: split.blobs.map((b) => b.blobHashHex),
      contentSha256: split.contentSha256
    });
    let last = null;
    for (const b of split.blobs) {
      last = book.ingest(parseFileSendObject({
        name: 'sim/large',
        body: b.bytes.toString('base64'),
        blobIndex: b.index,
        blobTotal: b.total,
        blobHashHex: b.blobHashHex,
        merkleRootHex: split.merkleRootHex,
        contentSha256: split.contentSha256
      }));
    }
    if (!last || last.status !== 'complete' || !last.verified) {
      throw new Error('expected verified reassembly of sim/large blobs');
    }
    if (last.buffer.toString('utf8') !== String(body)) {
      throw new Error('reassembled sim/large does not match seller body');
    }

    const tampered = parseFileSendObject({
      name: 'sim/large',
      body: Buffer.alloc(split.blobs[0].size || 16, 0xff).toString('base64'),
      blobIndex: 0,
      blobTotal: split.blobs.length,
      blobHashHex: split.blobs[0].blobHashHex,
      merkleRootHex: split.merkleRootHex
    });
    if (tampered.ok) {
      throw new Error('expected tampered blob frame to fail hash check');
    }

    // Live Peer path: sealed ciphertext → key reveal → plaintext.
    const liveBuyer = buyer;
    const frames = [];
    let received = null;
    let ciphertextOk = null;
    let rejected = 0;
    const onRecv = (ev) => { received = ev; };
    const onCipher = (ev) => { ciphertextOk = ev; };
    const onRej = () => { rejected += 1; };
    liveBuyer.on('documentReceived', onRecv);
    liveBuyer.on('documentCiphertextReceived', onCipher);
    liveBuyer.on('documentBlobRejected', onRej);
    try {
      const peerKey = 'sim-buyer-link';
      seller.connections[peerKey] = {
        _writeFabric: (buf) => {
          frames.push(buf);
          liveBuyer._handleFabricMessage(buf, { name: 'sim-seller' }, null);
        }
      };
      seller.settings.inventoryBlobChunkBytes = Math.min(chunkBytes, 400);
      // Without payment hash: ciphertext only (no plaintext leak).
      assert.ok(seller._sendP2pFileSendToPeer('sim/large', peerKey, { revealKey: false }));
      assert.ok(frames.length >= 1);
      assert.ok(ciphertextOk && ciphertextOk.verified, 'buyer must verify sealed ciphertext');
      assert.ok(!received, 'plaintext must not appear before content-key reveal');

      const sealedMeta = seller._getDocumentSealedMeta('sim/large');
      assert.ok(sealedMeta && sealedMeta.paymentHashHex, 'priced sim/large must be sealed');
      assert.ok(seller._sendDocumentContentKeyReveal('sim/large', peerKey));
      assert.ok(received && received.verified && received.opened, 'open after key reveal');
      assert.strictEqual(received.buffer.toString('utf8'), String(body));
    } finally {
      liveBuyer.removeListener('documentReceived', onRecv);
      liveBuyer.removeListener('documentCiphertextReceived', onCipher);
      liveBuyer.removeListener('documentBlobRejected', onRej);
      delete seller.connections['sim-buyer-link'];
    }

    // Offer book payment binding: sealed inventory uses SHA256(K) as contentHash.
    const offers = new DocumentOfferBook();
    const sealedMeta = seller._getDocumentSealedMeta('sim/large');
    const blobHashHex = split.blobs[0].blobHashHex;
    const pay = sealedMeta
      ? sealedMeta.paymentHashHex
      : blobPaymentHashHex({
        documentId: 'sim/large',
        blobIndex: 0,
        blobHashHex
      });
    offers.ingestInventoryResponse({
      origin: 'seller-a',
      items: [{
        id: 'sim/large',
        rateSats: 100,
        contentHash: pay,
        sealed: !!sealedMeta,
        merkleRootHex: split.merkleRootHex,
        blobs: [{
          index: 0,
          total: split.blobs.length,
          blobHashHex,
          contentHash: pay,
          rateSats: 100,
          size: split.blobs[0].size
        }]
      }]
    });
    const best = offers.pickBest('sim/large');
    if (!best || best.contentHashHex !== pay) {
      throw new Error('offer book must bind to sealed payment hash / blobPaymentHashHex');
    }

    dm.metrics = Object.assign({}, dm.metrics, {
      blobFrames: frames.length,
      blobVerified: 1,
      sealedUntilClaim: 1,
      blobRejectedProbe: rejected,
      paymentHashBound: 1
    });
  }
};
