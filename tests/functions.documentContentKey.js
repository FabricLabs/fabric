'use strict';

const assert = require('assert');
const documentContentKey = require('../functions/documentSealedExchange');

describe('functions/documentSealedExchange (content key)', function () {
  it('seal and open round-trip', function () {
    const plain = Buffer.from('secret document bytes', 'utf8');
    const sealed = documentContentKey.sealPlaintext(plain);
    assert.strictEqual(sealed.key.length, 32);
    assert.ok(documentContentKey.isSealedDocument({ encryption: sealed.encryption }));
    const opened = documentContentKey.openCiphertext(sealed.ciphertext, sealed.key, sealed.iv);
    assert.ok(opened.equals(plain));
    assert.strictEqual(
      documentContentKey.paymentHashHexFromKey(sealed.key).length,
      64
    );
  });

  it('contentKeyStorePath is stable', function () {
    assert.strictEqual(
      documentContentKey.contentKeyStorePath('abc'),
      'documents/abc.content-key'
    );
  });
});
