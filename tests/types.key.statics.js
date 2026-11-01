'use strict';

const assert = require('assert');
const Key = require('../types/key');

describe('@fabric/core/types/key statics', function () {
  it('expose the modules the functions/ shims re-export', function () {
    assert.strictEqual(require('../functions/bip32'), Key.BIP32);
    assert.strictEqual(require('../functions/bip49'), Key.BIP49);
    assert.strictEqual(require('../functions/bip85'), Key.BIP85);
    assert.strictEqual(require('../functions/base58'), Key.Base58);
    assert.strictEqual(require('../functions/fabricKeyMaterial'), Key.Material);
    assert.strictEqual(require('../functions/signingTags'), Key.TAGS);
    assert.strictEqual(require('../functions/keyHasPrivateSigningMaterial'), Key.hasPrivateSigningMaterial);
    const pubkey = require('../functions/pubkey');
    assert.strictEqual(pubkey.pubkeyXOnly, Key.pubkeyXOnly);
    assert.strictEqual(pubkey.normalizePeerPubkeyHex, Key.normalizePeerPubkeyHex);
    const bip39 = require('../functions/bip39');
    assert.strictEqual(bip39.validateMnemonic, Key.Mnemonic.validate);
    assert.strictEqual(bip39.mnemonicToSeedSync, Key.Mnemonic.toSeedSync);
    assert.strictEqual(Key.HDNode, Key.BIP32.HDNode);
    assert.strictEqual(Key.SIGN_TAG, Key.TAGS.SIGN);
  });

  it('Key.Mnemonic carries BIP-39 (Trezor vector)', function () {
    const phrase = Key.Mnemonic.fromEntropy(Buffer.alloc(16));
    assert.strictEqual(phrase, 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');
    assert.strictEqual(Key.Mnemonic.validate(phrase), true);
    assert.strictEqual(Buffer.from(Key.Mnemonic.toEntropy(phrase)).toString('hex'), '00000000000000000000000000000000');
    assert.strictEqual(
      Buffer.from(Key.Mnemonic.toSeedSync(phrase, 'TREZOR')).toString('hex'),
      'c55257c360c07c72029aebc1b53c05ed0362ada38ead3e3e9efa3708e53495531f09a6987599d18264c1e1c92f2cf141630c7a3c4ab7c81b2f001698e7463b04'
    );
    assert.deepStrictEqual(Key.Mnemonic.WORD_COUNTS, [12, 15, 18, 21, 24]);
    assert.strictEqual(Key.Mnemonic.wordlist.length, 2048);
    assert.strictEqual(Key.Mnemonic.generate().split(' ').length, 12);
  });

  it('Key.Mnemonic(entropy) still makes a key from that phrase', function () {
    const key = Key.Mnemonic(Buffer.alloc(16));
    assert.strictEqual(key.seed.split(' ').pop(), 'about');
    assert.ok(key.private);
  });

  it('Key.TAGS is frozen', function () {
    assert.ok(Object.isFrozen(Key.TAGS));
  });
});
