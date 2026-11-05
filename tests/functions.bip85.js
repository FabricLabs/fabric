'use strict';

const assert = require('assert');
const { fromBase58 } = require('../functions/bip32');
const {
  BIP85_PURPOSE,
  bip85Path,
  entropyFromPrivateKey,
  truncateEntropy,
  deriveBip85Entropy,
  deriveBip85Mnemonic,
  deriveBip85Hex,
  deriveBip85Xprv,
  deriveBip85Wif
} = require('../functions/bip85');

const MASTER_XPRV = 'xprv9s21ZrQH143K2LBWUUQRFXhucrQqBpKdRRxNVq2zBqsx8HVqFk2uYo8kmbaLLHRdqtQpUm98uKfu3vca1LqdGhUtyoFnCNkfmXRyPXLjbKb';

describe('@fabric/core/functions/bip85', function () {
  it('uses purpose 83696968 for BIP-85 paths', function () {
    assert.strictEqual(BIP85_PURPOSE, 83696968);
    assert.strictEqual(bip85Path(0, [0]), "m/83696968'/0'/0'");
  });

  it('matches BIP-85 test case 1 (path m/83696968\'/0\'/0\')', function () {
    const got = deriveBip85Entropy(MASTER_XPRV, "m/83696968'/0'/0'");
    assert.strictEqual(
      got.derivedKeyHex,
      'cca20ccb0e9a90feb0912870c3323b24874b0ca3d8018c4b96d0b97c0e82ded0'
    );
    assert.strictEqual(
      got.entropy.toString('hex'),
      'efecfbccffea313214232d29e71563d941229afb4338c21f9517c41aaa0d16f00b83d2a09ef747e7a64e8e2bd5a14869e693da66ce94ac2da570ab7ee48618f7'
    );
  });

  it('matches BIP-85 test case 2 (path m/83696968\'/0\'/1\')', function () {
    const got = deriveBip85Entropy(MASTER_XPRV, "m/83696968'/0'/1'");
    assert.strictEqual(
      got.derivedKeyHex,
      '503776919131758bb7de7beb6c0ae24894f4ec042c26032890c29359216e21ba'
    );
    assert.strictEqual(
      got.entropy.toString('hex'),
      '70c6e3e8ebee8dc4c0dbba66076819bb8c09672527c4277ca8729532ad711872218f826919f6b67218adde99018a6df9095ab2b58d803b5b93ec9802085a690e'
    );
  });

  it('derives the BIP-39 12-word English mnemonic vector', function () {
    const got = deriveBip85Mnemonic(MASTER_XPRV, { language: 0, words: 12, index: 0 });
    assert.strictEqual(got.path, "m/83696968'/39'/0'/12'/0'");
    assert.strictEqual(got.entropy.toString('hex'), '6250b68daf746d12a24d58b4787a714b');
    assert.strictEqual(
      got.mnemonic,
      'girl mad pet galaxy egg matter matrix prison refuse sense ordinary nose'
    );
  });

  it('derives the BIP-39 18-word English mnemonic vector', function () {
    const got = deriveBip85Mnemonic(MASTER_XPRV, { words: 18, index: 0 });
    assert.strictEqual(got.entropy.toString('hex'), '938033ed8b12698449d4bbca3c853c66b293ea1b1ce9d9dc');
    assert.strictEqual(
      got.mnemonic,
      'near account window bike charge season chef number sketch tomorrow excuse sniff circle vital hockey outdoor supply token'
    );
  });

  it('derives the BIP-39 24-word English mnemonic vector', function () {
    const got = deriveBip85Mnemonic(MASTER_XPRV, { words: 24, index: 0 });
    assert.strictEqual(
      got.entropy.toString('hex'),
      'ae131e2312cdc61331542efe0d1077bac5ea803adf24b313a4f0e48e9c51f37f'
    );
    assert.strictEqual(
      got.mnemonic,
      'puppy ocean match cereal symbol another shed magic wrap hammer bulb intact gadget divorce twin tonight reason outdoor destroy simple truth cigar social volcano'
    );
  });

  it('derives the HD-seed WIF vector', function () {
    const got = deriveBip85Wif(MASTER_XPRV, { index: 0 });
    assert.strictEqual(got.path, "m/83696968'/2'/0'");
    assert.strictEqual(
      got.entropy.toString('hex'),
      '7040bb53104f27367f317558e78a994ada7296c6fde36a364e5baf206e502bb1'
    );
    assert.strictEqual(got.wif, 'Kzyv4uF39d4Jrw2W7UryTHwZr1zQVNk4dAFyqE6BuMrMh1Za7uhp');
  });

  it('derives the XPRV application vector', function () {
    const got = deriveBip85Xprv(MASTER_XPRV, { index: 0 });
    assert.strictEqual(got.path, "m/83696968'/32'/0'");
    assert.strictEqual(
      got.xprv,
      'xprv9s21ZrQH143K2srSbCSg4m4kLvPMzcWydgmKEnMmoZUurYuBuYG46c6P71UGXMzmriLzCCBvKQWBUv3vPB3m1SATMhp3uEjXHJ42jFg7myX'
    );
  });

  it('derives the HEX 64-byte application vector', function () {
    const got = deriveBip85Hex(MASTER_XPRV, { numBytes: 64, index: 0 });
    assert.strictEqual(got.path, "m/83696968'/128169'/64'/0'");
    assert.strictEqual(
      got.entropy.toString('hex'),
      '492db4698cf3b73a5a24998aa3e9d7fa96275d85724a91e71aa2d645442f878555d078fd1f1f67e368976f04137b1f7a0d19232136ca50c44614af72b5582a5c'
    );
  });

  it('rejects non-mnemonic word counts', function () {
    assert.throws(() => deriveBip85Mnemonic(MASTER_XPRV, { words: 13 }), /12, 15, 18, 21, or 24/);
  });

  it('accepts an HDNode root and rejects xpub / bad paths', function () {
    const root = fromBase58(MASTER_XPRV);
    const fromNode = deriveBip85Mnemonic(root, { words: 12, index: 0 });
    const fromXprv = deriveBip85Mnemonic(MASTER_XPRV, { words: 12, index: 0 });
    assert.strictEqual(fromNode.mnemonic, fromXprv.mnemonic);
    assert.throws(() => deriveBip85Entropy(root.neutered(), "m/83696968'/0'/0'"), /private/);
    assert.throws(() => deriveBip85Entropy(MASTER_XPRV, "83696968'/0'/0'"), /absolute/);
    assert.throws(() => deriveBip85Entropy(null, "m/83696968'/0'/0'"), /HDNode or xprv/);
  });

  it('enforces HEX length and private-key / truncate bounds', function () {
    const hex16 = deriveBip85Hex(MASTER_XPRV, { numBytes: 16, index: 0 });
    assert.strictEqual(hex16.path, "m/83696968'/128169'/16'/0'");
    assert.strictEqual(hex16.entropy.length, 16);
    assert.throws(() => deriveBip85Hex(MASTER_XPRV, { numBytes: 15 }), /16–64/);
    assert.throws(() => entropyFromPrivateKey(Buffer.alloc(31)), /32 bytes/);
    assert.throws(() => truncateEntropy(Buffer.alloc(64), 0), /1–64/);
    const full = deriveBip85Entropy(MASTER_XPRV, "m/83696968'/0'/0'");
    assert.ok(truncateEntropy(full.entropy, 16).equals(full.entropy.subarray(0, 16)));
  });
});
