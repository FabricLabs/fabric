'use strict';

const assert = require('assert');
const crypto = require('crypto');
const {
  mnemonicToSeed,
  mnemonicToSeedSync,
  entropyToMnemonic,
  generateMnemonic,
  validateMnemonic,
  defaultWordlist
} = require('../functions/bip39');

describe('@fabric/core/functions/bip39', function () {
  it('mnemonicToSeed (async) matches mnemonicToSeedSync', async function () {
    const m = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const pass = 'TREZOR';
    const a = await mnemonicToSeed(m, pass);
    const b = mnemonicToSeedSync(m, pass);
    assert.ok(a.equals(b));
  });

  it('entropyToMnemonic accepts Uint8Array entropy', function () {
    const ent = crypto.randomBytes(16);
    const fromBuf = entropyToMnemonic(ent);
    const fromU8 = entropyToMnemonic(new Uint8Array(ent));
    assert.strictEqual(fromBuf, fromU8);
  });

  it('generateMnemonic rejects invalid strength', function () {
    assert.throws(() => generateMnemonic(127), /128–256/);
    assert.throws(() => generateMnemonic(384), /128–256/);
  });

  it('validateMnemonic returns false on checksum failure', function () {
    const words = defaultWordlist.slice(0, 12).join(' ');
    assert.strictEqual(validateMnemonic(words), false);
  });
});
