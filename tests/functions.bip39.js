'use strict';

const assert = require('assert');
const crypto = require('crypto');
const {
  mnemonicToSeed,
  mnemonicToSeedSync,
  entropyToMnemonic,
  mnemonicToEntropy,
  generateMnemonic,
  validateMnemonic,
  defaultWordlist
} = require('../functions/bip39');

describe('@fabric/core/functions/bip39', function () {
  const VALID_12 = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

  it('mnemonicToSeed (async) matches mnemonicToSeedSync', async function () {
    const pass = 'TREZOR';
    const a = await mnemonicToSeed(VALID_12, pass);
    const b = mnemonicToSeedSync(VALID_12, pass);
    assert.ok(a.equals(b));
  });

  it('passphrase uses NFKD only (case and spacing preserved per BIP-39)', async function () {
    const upper = await mnemonicToSeed(VALID_12, 'My Pass');
    const lower = await mnemonicToSeed(VALID_12, 'my pass');
    assert.ok(!upper.equals(lower));
  });

  it('entropyToMnemonic accepts Uint8Array entropy', function () {
    const ent = crypto.randomBytes(16);
    const fromBuf = entropyToMnemonic(ent);
    const fromU8 = entropyToMnemonic(new Uint8Array(ent));
    assert.strictEqual(fromBuf, fromU8);
  });

  it('generateMnemonic rejects invalid strength', function () {
    assert.throws(() => generateMnemonic(127), /128–256/);
    assert.throws(() => generateMnemonic(129), /128–256/);
    assert.throws(() => generateMnemonic(257), /128–256/);
  });

  it('validateMnemonic returns false on checksum failure', function () {
    const words = VALID_12.split(' ');
    const baseline = words[words.length - 1];
    const idx = defaultWordlist.indexOf(baseline);
    const replacement = defaultWordlist[(idx + 1) % defaultWordlist.length];
    words[words.length - 1] = replacement;
    const mutated = words.join(' ');
    assert.strictEqual(validateMnemonic(mutated), false);
  });

  it('rejects mnemonic lengths other than 12/15/18/21/24 words', function () {
    const thirteen = `${VALID_12} abandon`;
    assert.strictEqual(validateMnemonic(thirteen), false);
    assert.throws(() => mnemonicToEntropy(thirteen), /12, 15, 18, 21, or 24/);
  });

  it('rejects custom wordlists that are not 2048 unique non-empty strings', function () {
    const ent = crypto.randomBytes(16);
    assert.throws(() => entropyToMnemonic(ent, []), /2048/);
    const dup = defaultWordlist.slice();
    dup[200] = dup[0];
    assert.throws(() => entropyToMnemonic(ent, dup), /duplicate/);
  });

  it('rejects wordlist entries that contain whitespace', function () {
    const ent = crypto.randomBytes(16);
    const bad = defaultWordlist.slice();
    bad[10] = 'two words';
    assert.throws(() => entropyToMnemonic(ent, bad), /whitespace/);
  });

  it('rejects wordlist entries that are empty strings', function () {
    const ent = crypto.randomBytes(16);
    const bad = defaultWordlist.slice();
    bad[11] = '';
    assert.throws(() => entropyToMnemonic(ent, bad), /non-empty string/);
  });

  it('generateMnemonic(160) succeeds and returns 15 words', function () {
    const m = generateMnemonic(160);
    assert.strictEqual(m.split(' ').length, 15);
  });

  it('entropyToMnemonic rejects invalid entropy byte lengths', function () {
    assert.throws(() => entropyToMnemonic(crypto.randomBytes(15)), /Entropy length/);
  });

  it('mnemonicToEntropy throws on checksum mismatch', function () {
    const words = VALID_12.split(' ');
    const baseline = words[words.length - 1];
    const idx = defaultWordlist.indexOf(baseline);
    const replacement = defaultWordlist[(idx + 1) % defaultWordlist.length];
    words[words.length - 1] = replacement;
    const mutated = words.join(' ');
    assert.throws(() => mnemonicToEntropy(mutated), /Invalid checksum/);
  });
});
