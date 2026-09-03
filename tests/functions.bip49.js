'use strict';

const assert = require('assert');
const bitcoin = require('bitcoinjs-lib');
const { networks } = bitcoin;
const bip39 = require('../functions/bip39');
const bip32Module = require('../functions/bip32');
const BIP32 = bip32Module.default;
const ecc = require('../types/ecc');
const {
  BITCOIN_KEY_DERIVATION_PATH,
  bitcoinBip49ReceiveDerivationPath
} = require('../constants');
const { p2shP2wpkhAddress, p2shP2wpkhPayment } = require('../functions/bip49');

describe('@fabric/core/functions/bip49', function () {
  it('keeps default funds path on BIP-44', function () {
    assert.strictEqual(BITCOIN_KEY_DERIVATION_PATH, "m/44'/0'/0'/0/0");
    assert.notStrictEqual(bitcoinBip49ReceiveDerivationPath(), BITCOIN_KEY_DERIVATION_PATH);
  });

  it('builds a mainnet 3… nested-SegWit address from a compressed pubkey', function () {
    const pubkey = Buffer.from(
      '0223cffd5e94da3c8915c6b868f06d15183c1aeffad8ddf58fcb35a428e3158e71',
      'hex'
    );
    const addr = p2shP2wpkhAddress({ pubkey, network: networks.bitcoin });
    assert.match(addr, /^3[1-9A-HJ-NP-Za-km-z]{25,34}$/);
    const pay = p2shP2wpkhPayment({ pubkey, network: networks.bitcoin });
    assert.ok(pay.redeem && pay.redeem.output);
    assert.ok(pay.output && pay.output.length === 23);
  });

  it('matches the published BIP-49 testnet vector (m/49\'/1\'/0\'/0/0)', function () {
    const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const seed = bip39.mnemonicToSeedSync(mnemonic);
    const root = new BIP32(ecc).fromSeed(seed);
    const child = root.derivePath("m/49'/1'/0'/0/0");
    const pubkey = Buffer.from(child.publicKey);
    assert.strictEqual(
      pubkey.toString('hex'),
      '03a1af804ac108a8a51782198c2d034b28bf90c8803f5a53f76276fa69a4eae77f'
    );
    const addr = p2shP2wpkhAddress({
      pubkey,
      network: networks.testnet
    });
    assert.strictEqual(addr, '2Mww8dCYPUpKHofjgcXcBCEGmniw9CoaiD2');
    assert.strictEqual(
      p2shP2wpkhAddress({
        pubkey: '03a1af804ac108a8a51782198c2d034b28bf90c8803f5a53f76276fa69a4eae77f',
        network: networks.testnet
      }),
      addr
    );
  });

  it('rejects uncompressed pubkeys', function () {
    assert.throws(
      () => p2shP2wpkhAddress({ pubkey: Buffer.alloc(65, 4) }),
      /compressed/
    );
  });
});
