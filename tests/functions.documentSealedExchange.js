'use strict';

const assert = require('assert');
const {
  prepareSealedSale,
  advertiseSealedDocument,
  buildKeyRevealMessage,
  openSealedDelivery,
  requestUnlocksContentKey,
  paymentHashHexFromKey
} = require('../functions/documentSealedExchange');

describe('functions/documentSealedExchange', function () {
  it('prepareSealedSale + openSealedDelivery round-trip', function () {
    const plain = Buffer.from('atomic secret payload', 'utf8');
    const sale = prepareSealedSale(plain);
    assert.strictEqual(sale.paymentHashHex, paymentHashHexFromKey(sale.key));
    const opened = openSealedDelivery({
      keyHex: sale.keyHex,
      paymentHashHex: sale.paymentHashHex,
      iv: sale.encryption.iv,
      plaintextSha256: sale.plaintextSha256
    }, sale.ciphertext);
    assert.strictEqual(opened.ok, true);
    assert.ok(opened.plaintext.equals(plain));
  });

  it('rejects wrong key / withhold leaves ciphertext useless', function () {
    const sale = prepareSealedSale(Buffer.from('x'));
    const bad = openSealedDelivery({
      keyHex: '11'.repeat(32),
      paymentHashHex: sale.paymentHashHex,
      iv: sale.encryption.iv
    }, sale.ciphertext);
    assert.strictEqual(bad.ok, false);
  });

  it('requestUnlocksContentKey gates reveal on payment hash', function () {
    const sale = prepareSealedSale(Buffer.from('y'));
    assert.ok(!requestUnlocksContentKey({}, sale.paymentHashHex));
    assert.ok(!requestUnlocksContentKey({ contentHashHex: 'aa'.repeat(32) }, sale.paymentHashHex));
    assert.ok(requestUnlocksContentKey({ contentHashHex: sale.paymentHashHex }, sale.paymentHashHex));
  });

  it('advertiseSealedDocument uses SHA256(K) as contentHash on item and every blob', function () {
    const sale = prepareSealedSale(Buffer.alloc(4000, 2));
    const adv = advertiseSealedDocument(sale, { documentId: 'd', rateSats: 50, chunkBytes: 1000 });
    assert.strictEqual(adv.sealed, true);
    assert.strictEqual(adv.contentHash, sale.paymentHashHex);
    assert.strictEqual(adv.contentHashHex, sale.paymentHashHex);
    assert.ok(adv.itemBlobs.length > 1);
    for (const b of adv.itemBlobs) {
      assert.strictEqual(b.contentHash, sale.paymentHashHex);
      assert.strictEqual(b.contentHashHex, sale.paymentHashHex);
    }
    const reveal = buildKeyRevealMessage({
      documentId: 'd',
      keyHex: sale.keyHex,
      paymentHashHex: sale.paymentHashHex,
      iv: sale.encryption.iv
    });
    assert.strictEqual(reveal.type, 'DocumentContentKeyReveal');
    assert.strictEqual(reveal.object.keyHex, sale.keyHex);
  });

  it('openWithClaimPreimage opens using HTLC claim preimage', function () {
    const {
      openWithClaimPreimage
    } = require('../functions/documentSealedExchange');
    const plain = Buffer.from('claim-open', 'utf8');
    const sale = prepareSealedSale(plain);
    const opened = openWithClaimPreimage({
      ciphertext: sale.ciphertext,
      preimageHex: sale.keyHex,
      paymentHashHex: sale.paymentHashHex,
      iv: sale.encryption.iv,
      plaintextSha256: sale.plaintextSha256
    });
    assert.strictEqual(opened.ok, true);
    assert.ok(opened.plaintext.equals(plain));
    const bad = openWithClaimPreimage({
      ciphertext: sale.ciphertext,
      preimageHex: '22'.repeat(32),
      paymentHashHex: sale.paymentHashHex,
      iv: sale.encryption.iv
    });
    assert.strictEqual(bad.ok, false);
  });
});
