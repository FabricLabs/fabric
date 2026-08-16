'use strict';

const assert = require('assert');
const {
  BITCOIN_KEY_DERIVATION_PATH,
  bitcoinReceiveDerivationPath,
  bitcoinChangeDerivationPath,
  bitcoinBip49ReceiveDerivationPath,
  bitcoinBip49ChangeDerivationPath,
  bitcoinBip84ReceiveDerivationPath,
  bitcoinBip84ChangeDerivationPath,
  bitcoinBip86ReceiveDerivationPath,
  bitcoinBip86ChangeDerivationPath,
  bitcoinBip48P2shP2wshReceiveDerivationPath,
  bitcoinBip48P2shP2wshChangeDerivationPath,
  bitcoinBip48P2wshReceiveDerivationPath,
  bitcoinBip48P2wshChangeDerivationPath
} = require('../constants');

describe('@fabric/core Bitcoin derivation path templates', function () {
  it('keeps default funds path on BIP-44', function () {
    assert.strictEqual(BITCOIN_KEY_DERIVATION_PATH, "m/44'/0'/0'/0/0");
    assert.strictEqual(bitcoinReceiveDerivationPath(0, 0), "m/44'/0'/0'/0/0");
    assert.strictEqual(bitcoinChangeDerivationPath(1, 7), "m/44'/0'/1'/1/7");
  });

  it('names BIP-49 wrapped-SegWit paths without making them the default', function () {
    assert.strictEqual(bitcoinBip49ReceiveDerivationPath(), "m/49'/0'/0'/0/0");
    assert.strictEqual(bitcoinBip49ChangeDerivationPath(2, 1), "m/49'/0'/2'/1/1");
  });

  it('names BIP-84 native SegWit paths', function () {
    assert.strictEqual(bitcoinBip84ReceiveDerivationPath(0, 0), "m/84'/0'/0'/0/0");
    assert.strictEqual(bitcoinBip84ChangeDerivationPath(0, 3), "m/84'/0'/0'/1/3");
  });

  it('names BIP-86 Taproot paths', function () {
    assert.strictEqual(bitcoinBip86ReceiveDerivationPath(), "m/86'/0'/0'/0/0");
    assert.strictEqual(bitcoinBip86ChangeDerivationPath(1, 0), "m/86'/0'/1'/1/0");
  });

  it('names BIP-48 multisig paths without switching group vaults', function () {
    assert.strictEqual(bitcoinBip48P2shP2wshReceiveDerivationPath(), "m/48'/0'/0'/1'/0/0");
    assert.strictEqual(bitcoinBip48P2wshReceiveDerivationPath(), "m/48'/0'/0'/2'/0/0");
    assert.strictEqual(bitcoinBip48P2wshChangeDerivationPath(0, 1), "m/48'/0'/0'/2'/1/1");
    assert.strictEqual(bitcoinBip48P2shP2wshChangeDerivationPath(1, 0), "m/48'/0'/1'/1'/1/0");
  });

  it('rejects out-of-range account or index', function () {
    assert.throws(() => bitcoinReceiveDerivationPath(-1, 0), /account/);
    assert.throws(() => bitcoinBip84ReceiveDerivationPath(0, 0x80000000), /index/);
    assert.throws(() => bitcoinBip86ChangeDerivationPath(1.5, 0), /account/);
  });
});
