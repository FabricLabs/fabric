'use strict';

const assert = require('assert');
const {
  sealJson,
  openSealedJson,
  isSealedEnvelope,
  isPasswordProtectedDocument,
  SEAL_SCHEME,
  PASSWORD_MIN_LENGTH
} = require('../functions/sealedBlob');

describe('@fabric/core/functions/sealedBlob', function () {
  const password = 'test-pass-ok!';
  const secret = { seed: 'abandon abandon', xprv: 'xprv-test', note: 'keep me' };

  it('round-trips JSON through AES-256-GCM', function () {
    const envelope = sealJson(secret, password);
    assert.strictEqual(envelope.type, 'FabricSealedBlob');
    assert.strictEqual(envelope.encryption, SEAL_SCHEME);
    assert.ok(envelope.ciphertext);
    assert.ok(envelope.iv);
    assert.ok(envelope.kdf && envelope.kdf.salt);
    assert.strictEqual(envelope.kdf.iterations, 210000);
    const opened = openSealedJson(envelope, password);
    assert.deepStrictEqual(opened, secret);
  });

  it('opens a nested seal field (wallet document shape)', function () {
    const envelope = sealJson(secret, password);
    const document = {
      type: 'FabricWallet',
      format: SEAL_SCHEME,
      passwordProtected: true,
      object: { id: 'public', xpub: 'xpub1' },
      seal: envelope
    };
    assert.strictEqual(isPasswordProtectedDocument(document), true);
    assert.deepStrictEqual(openSealedJson(document, password), secret);
  });

  it('opens a Hub backup v2-shaped envelope (ciphertext + kdf + iv)', function () {
    const core = sealJson(secret, password);
    const hubShaped = {
      format: SEAL_SCHEME,
      kdf: core.kdf,
      iv: core.iv,
      ciphertext: core.ciphertext
    };
    assert.strictEqual(isSealedEnvelope(hubShaped), true);
    assert.deepStrictEqual(openSealedJson(hubShaped, password), secret);
  });

  it('rejects a short password and a wrong password', function () {
    assert.throws(() => sealJson(secret, 'short'), (err) => err.code === 'FABRIC_PASSWORD_POLICY');
    const envelope = sealJson(secret, password);
    assert.throws(() => openSealedJson(envelope, 'wrong-pass-ok!'), (err) => err.code === 'FABRIC_SEAL_DECRYPT');
  });

  it('does not treat plaintext wallets as sealed', function () {
    assert.strictEqual(PASSWORD_MIN_LENGTH, 8);
    assert.strictEqual(isPasswordProtectedDocument({
      type: 'FabricWallet',
      format: 'plaintext',
      object: { xprv: 'xprv1', seed: 'words' }
    }), false);
    assert.strictEqual(isSealedEnvelope({ object: { xprv: 'xprv1' } }), false);
  });
});
