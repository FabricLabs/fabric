'use strict';

const assert = require('assert');
const {
  normalizeContentHashHex,
  contentHashHexFromObject,
  resolveDocumentContentHashHex,
  purchaseContentHashHex,
  paymentHashHexFromKey
} = require('../functions/documentPaymentHash');
const { prepareSealedSale } = require('../functions/documentSealedExchange');
const { blobPaymentHashHex } = require('../functions/documentBlobManifest');

describe('functions/documentPaymentHash', function () {
  const docId = 'pay-hash-doc';
  const parsed = {
    id: docId,
    contentBase64: Buffer.from('hello-payment-hash', 'utf8').toString('base64'),
    created: 1,
    edited: 1,
    lineage: docId,
    mime: 'text/plain',
    name: 'pay',
    parent: null,
    revision: 1,
    sha256: 'aa'.repeat(32),
    size: 18
  };

  it('normalizes aliases to one contentHashHex', function () {
    const hex = purchaseContentHashHex(docId, parsed);
    assert.strictEqual(contentHashHexFromObject({ contentHash: hex }), hex);
    assert.strictEqual(contentHashHexFromObject({ paymentHashHex: hex.toUpperCase() }), hex);
    assert.strictEqual(contentHashHexFromObject({ purchaseContentHashHex: hex }), hex);
    assert.strictEqual(normalizeContentHashHex('not-a-hash'), null);
  });

  it('resolves envelope binding via purchaseContentHashHex', function () {
    const resolved = resolveDocumentContentHashHex({ documentId: docId, parsed });
    assert.strictEqual(resolved.binding, 'envelope');
    assert.strictEqual(resolved.contentHashHex, purchaseContentHashHex(docId, parsed));
  });

  it('resolves sealed binding from content key (preferred over envelope)', function () {
    const sale = prepareSealedSale(Buffer.from('secret'));
    const resolved = resolveDocumentContentHashHex({
      documentId: docId,
      parsed,
      contentKey: sale.key
    });
    assert.strictEqual(resolved.binding, 'sealed');
    assert.strictEqual(resolved.contentHashHex, paymentHashHexFromKey(sale.key));
    assert.notStrictEqual(resolved.contentHashHex, purchaseContentHashHex(docId, parsed));
  });

  it('resolves sealed binding from sealedMeta.paymentHashHex', function () {
    const pay = 'ab'.repeat(32);
    const resolved = resolveDocumentContentHashHex({
      documentId: docId,
      parsed,
      sealedMeta: { paymentHashHex: pay }
    });
    assert.strictEqual(resolved.binding, 'sealed');
    assert.strictEqual(resolved.contentHashHex, pay);
  });

  it('resolves blob binding for unsealed multi-blob settles', function () {
    const blobHashHex = 'cd'.repeat(32);
    const resolved = resolveDocumentContentHashHex({
      documentId: docId,
      parsed,
      blob: { index: 0, blobHashHex }
    });
    assert.strictEqual(resolved.binding, 'blob');
    assert.strictEqual(resolved.contentHashHex, blobPaymentHashHex({
      documentId: docId,
      blobIndex: 0,
      blobHashHex
    }));
  });
});
