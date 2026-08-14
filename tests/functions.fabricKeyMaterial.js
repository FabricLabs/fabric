'use strict';

const assert = require('assert');
const bip39 = require('../functions/bip39');
const {
  parseRawSeedHex,
  classifyFabricKeyMaterial,
  keySettingsFromEnv,
  MIN_SEED_BYTES,
  MAX_SEED_BYTES
} = require('../functions/fabricKeyMaterial');

const SAMPLE_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

describe('@fabric/core/functions/fabricKeyMaterial', function () {
  it('parses raw BIP32 seed hex (optional 0x) within 16–64 bytes', function () {
    const hex = 'aa'.repeat(32);
    const a = parseRawSeedHex(hex);
    const b = parseRawSeedHex('0x' + hex);
    assert.ok(Buffer.isBuffer(a));
    assert.strictEqual(a.length, 32);
    assert.deepStrictEqual(a, b);
    assert.strictEqual(parseRawSeedHex('aa'.repeat(MIN_SEED_BYTES - 1)), null);
    assert.strictEqual(parseRawSeedHex('aa'.repeat(MAX_SEED_BYTES + 1)), null);
    assert.strictEqual(parseRawSeedHex('not-hex'), null);
  });

  it('classifies xprv, seed hex, and mnemonic', function () {
    assert.strictEqual(classifyFabricKeyMaterial('xprv1example').kind, 'xprv');
    assert.strictEqual(classifyFabricKeyMaterial('aa'.repeat(32)).kind, 'seedHex');
    assert.strictEqual(classifyFabricKeyMaterial(SAMPLE_MNEMONIC).kind, 'mnemonic');
    assert.strictEqual(classifyFabricKeyMaterial('???').kind, 'unknown');
  });

  it('keySettingsFromEnv prefers FABRIC_XPRV then FABRIC_SEED then FABRIC_MNEMONIC', function () {
    const seedHex = bip39.mnemonicToSeedSync(SAMPLE_MNEMONIC).toString('hex');
    assert.deepStrictEqual(keySettingsFromEnv({
      FABRIC_XPRV: 'xprv1example',
      FABRIC_SEED: seedHex,
      FABRIC_MNEMONIC: SAMPLE_MNEMONIC
    }), { xprv: 'xprv1example' });
    assert.deepStrictEqual(keySettingsFromEnv({
      FABRIC_SEED: seedHex,
      FABRIC_MNEMONIC: SAMPLE_MNEMONIC
    }), { seed: seedHex });
    assert.deepStrictEqual(keySettingsFromEnv({
      FABRIC_MNEMONIC: SAMPLE_MNEMONIC
    }), { mnemonic: SAMPLE_MNEMONIC });
    assert.strictEqual(keySettingsFromEnv({}), null);
  });
});
