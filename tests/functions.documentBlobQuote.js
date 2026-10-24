'use strict';

const assert = require('assert');
const crypto = require('crypto');
const {
  BLOB_QUOTE_TYPE,
  wrapBlobKey,
  unwrapBlobKey,
  createBlobQuote,
  isWellFormedBlobQuote,
  checkBlobQuote,
  paymentHashHexFromKey,
  advertiseSealedDocument,
  prepareSealedSale
} = require('../functions/documentSealedExchange');

const rand = () => crypto.randomBytes(32).toString('hex');

describe('functions/documentSealedExchange (per-buyer blob quotes)', function () {
  const base = { documentId: 'doc', merkleRootHex: 'ab'.repeat(32), blobIndex: 2 };

  it('wrap / unwrap round-trips and is bound to document, root, and index', function () {
    const keyHex = rand();
    const secretHex = rand();
    const wrappedKeyHex = wrapBlobKey(Object.assign({ keyHex, secretHex }, base));
    assert.notStrictEqual(wrappedKeyHex, keyHex);
    const out = unwrapBlobKey(Object.assign({ wrappedKeyHex, secretHex, keyHashHex: paymentHashHexFromKey(keyHex) }, base));
    assert.deepStrictEqual(out, { ok: true, keyHex });
    for (const over of [{ documentId: 'other' }, { merkleRootHex: 'cd'.repeat(32) }, { blobIndex: 3 }, { secretHex: rand() }]) {
      const wrong = unwrapBlobKey(Object.assign({ wrappedKeyHex, secretHex, keyHashHex: paymentHashHexFromKey(keyHex) }, base, over));
      assert.strictEqual(wrong.ok, false, JSON.stringify(over));
    }
    assert.strictEqual(unwrapBlobKey(Object.assign({ wrappedKeyHex: 'zz', secretHex }, base)).ok, false);
  });

  it('createBlobQuote commits SHA256(K_i) and pays to SHA256(s)', function () {
    const keyHex = rand();
    const { quote, secretHex } = createBlobQuote(Object.assign({ keyHex, amountSats: 716, expiresAt: 123 }, base));
    assert.strictEqual(quote.type, BLOB_QUOTE_TYPE);
    assert.strictEqual(quote.keyHashHex, paymentHashHexFromKey(keyHex));
    assert.strictEqual(quote.paymentHashHex, paymentHashHexFromKey(secretHex));
    assert.strictEqual(quote.amountSats, 716);
    assert.strictEqual(quote.expiresAt, 123);
    assert.ok(!JSON.stringify(quote).includes(keyHex));
    assert.ok(!JSON.stringify(quote).includes(secretHex));
    assert.ok(isWellFormedBlobQuote(quote));
    const again = createBlobQuote(Object.assign({ keyHex }, base));
    assert.notStrictEqual(again.quote.paymentHashHex, quote.paymentHashHex, 'a fresh secret per quote');
  });

  it('isWellFormedBlobQuote refuses quotes that would pay to SHA256(K_i)', function () {
    const { quote } = createBlobQuote(Object.assign({ keyHex: rand() }, base));
    assert.strictEqual(isWellFormedBlobQuote(Object.assign({}, quote, { paymentHashHex: quote.keyHashHex })), false);
    assert.strictEqual(isWellFormedBlobQuote(Object.assign({}, quote, { blobIndex: -1 })), false);
    assert.strictEqual(isWellFormedBlobQuote(Object.assign({}, quote, { documentId: '' })), false);
    assert.strictEqual(isWellFormedBlobQuote(Object.assign({}, quote, { wrappedKeyHex: 'nope' })), false);
    assert.strictEqual(isWellFormedBlobQuote(null), false);
  });

  it('checkBlobQuote unwraps K_i with the HTLC preimage', function () {
    const keyHex = rand();
    const { quote, secretHex } = createBlobQuote(Object.assign({ keyHex }, base));
    assert.deepStrictEqual(checkBlobQuote({ quote, preimageHex: secretHex }), { ok: true, keyHex });
    assert.deepStrictEqual(checkBlobQuote({ quote, preimageHex: secretHex, keyHashHex: quote.keyHashHex }), { ok: true, keyHex });
    const wrongPre = checkBlobQuote({ quote, preimageHex: rand() });
    assert.strictEqual(wrongPre.ok, false);
    assert.ok(!wrongPre.fraud, 'a wrong preimage is not the seller\'s fault');
  });

  it('checkBlobQuote reports fraud: a lying wrap, or a key hash the document does not commit', function () {
    const keyHex = rand();
    const { quote, secretHex } = createBlobQuote(Object.assign({ keyHex }, base));
    const lie = Object.assign({}, quote, { wrappedKeyHex: rand() });
    const bad = checkBlobQuote({ quote: lie, preimageHex: secretHex });
    assert.strictEqual(bad.ok, false);
    assert.strictEqual(bad.fraud, true);
    const committed = paymentHashHexFromKey(rand());
    const swapped = checkBlobQuote({ quote, preimageHex: secretHex, keyHashHex: committed });
    assert.strictEqual(swapped.ok, false);
    assert.strictEqual(swapped.fraud, true);
  });

  it('advertiseSealedDocument no longer publishes plaintextSha256', function () {
    const sale = prepareSealedSale(Buffer.alloc(3000, 4));
    const adv = advertiseSealedDocument(sale, { documentId: 'd', rateSats: 10, chunkBytes: 1000 });
    assert.ok(!('plaintextSha256' in adv));
    for (const b of adv.itemBlobs) assert.ok(!('plaintextSha256' in b));
  });
});
