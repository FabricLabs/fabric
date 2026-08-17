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

  it('entropyToMnemonic rejects string entropy (use Buffer.from explicitly)', function () {
    assert.throws(() => entropyToMnemonic('deadbeef'), /Buffer or Uint8Array/);
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

  it('generateMnemonic falls back to Web Crypto when randomBytes is missing', function () {
    const orig = crypto.randomBytes;
    crypto.randomBytes = undefined;
    try {
      const mnemonic = generateMnemonic(128);
      assert.strictEqual(mnemonic.split(/\s+/).length, 12);
      assert.ok(validateMnemonic(mnemonic));
    } finally {
      crypto.randomBytes = orig;
    }
  });
});

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

const {
  sortInputs,
  sortOutputs,
  sortTransaction,
  compareInputs,
  prevoutHashDisplay
} = require('../functions/bip69');

/** BIP-69 example tx 0a6a357e… — display-order prevouts. */
const EXAMPLE_1_INPUTS = [
  ['0e53ec5dfb2cb8a71fec32dc9a634a35b7e24799295ddd5278217822e0b31f57', 0],
  ['26aa6e6d8b9e49bb0630aac301db6757c02e3619feb4ee0eea81eb1672947024', 1],
  ['28e0fdd185542f2c6ea19030b0796051e7772b6026dd5ddccd7a2f93b73e6fc2', 0],
  ['381de9b9ae1a94d9c17f6a08ef9d341a5ce29e2e60c36a52d333ff6203e58d5d', 1],
  ['3b8b2f8efceb60ba78ca8bba206a137f14cb5ea4035e761ee204302d46b98de2', 0],
  ['402b2c02411720bf409eff60d05adad684f135838962823f3614cc657dd7bc0a', 1],
  ['54ffff182965ed0957dba1239c27164ace5a73c9b62a660c74b7b7f15ff61e7a', 1],
  ['643e5f4e66373a57251fb173151e838ccd27d279aca882997e005016bb53d5aa', 0],
  ['6c1d56f31b2de4bfc6aaea28396b333102b1f600da9c6d6149e96ca43f1102b1', 1],
  ['7a1de137cbafb5c70405455c49c5104ca3057a1f1243e6563bb9245c9c88c191', 0],
  ['7d037ceb2ee0dc03e82f17be7935d238b35d1deabf953a892a4507bfbeeb3ba4', 1],
  ['a5e899dddb28776ea9ddac0a502316d53a4a3fca607c72f66c470e0412e34086', 0],
  ['b4112b8f900a7ca0c8b0e7c4dfad35c6be5f6be46b3458974988e1cdb2fa61b8', 0],
  ['bafd65e3c7f3f9fdfdc1ddb026131b278c3be1af90a4a6ffa78c4658f9ec0c85', 0],
  ['de0411a1e97484a2804ff1dbde260ac19de841bebad1880c782941aca883b4e9', 1],
  ['f0a130a84912d03c1d284974f563c5949ac13f8342b8112edff52971599e6a45', 0],
  ['f320832a9d2e2452af63154bc687493484a0e7745ebd3aaf9ca19eb80834ad60', 0]
];

describe('@fabric/core/functions/bip69', function () {
  it('sorts BIP-69 example 1 inputs (display txid then vout)', function () {
    const shuffled = EXAMPLE_1_INPUTS.slice().reverse().map(([txid, vout]) => ({ txid, vout }));
    const sorted = sortInputs(shuffled);
    assert.strictEqual(sorted.length, EXAMPLE_1_INPUTS.length);
    for (let i = 0; i < EXAMPLE_1_INPUTS.length; i++) {
      assert.strictEqual(sorted[i].txid, EXAMPLE_1_INPUTS[i][0]);
      assert.strictEqual(sorted[i].vout, EXAMPLE_1_INPUTS[i][1]);
    }
  });

  it('sorts same-txid inputs by vout (BIP-69 example 2)', function () {
    const txid = '35288d269cee1941eaebb2ea85e32b42cdb2b04284a56d8b14dcc3f5c65d6055';
    const sorted = sortInputs([{ txid, vout: 1 }, { txid, vout: 0 }]);
    assert.strictEqual(sorted[0].vout, 0);
    assert.strictEqual(sorted[1].vout, 1);
  });

  it('sorts outputs by amount then scriptPubKey (BIP-69 example 1)', function () {
    const a = {
      value: 40000000000,
      script: Buffer.from('76a9145be32612930b8323add2212a4ec03c1562084f8488ac', 'hex')
    };
    const b = {
      value: 400057456,
      script: Buffer.from('76a9144a5fba237213a062f6f57978f796390bdcf8d01588ac', 'hex')
    };
    const sorted = sortOutputs([a, b]);
    assert.strictEqual(sorted[0].value, 400057456);
    assert.strictEqual(sorted[1].value, 40000000000);
  });

  it('breaks output ties on scriptPubKey bytes', function () {
    const scriptA = Buffer.from('76a91400', 'hex');
    const scriptB = Buffer.from('76a914ff', 'hex');
    const sorted = sortOutputs([
      { value: 1000, script: scriptB },
      { value: 1000, script: scriptA }
    ]);
    assert.ok(sorted[0].script.equals(scriptA));
    assert.ok(sorted[1].script.equals(scriptB));
  });

  it('treats bitcoinjs wire hashes as reversed display txids', function () {
    const txid = EXAMPLE_1_INPUTS[3][0];
    const wire = Buffer.from(txid, 'hex').reverse();
    const display = prevoutHashDisplay({ hash: wire });
    assert.strictEqual(display.toString('hex'), txid);
    const a = { hash: Buffer.from(EXAMPLE_1_INPUTS[1][0], 'hex').reverse(), index: 1 };
    const b = { hash: Buffer.from(EXAMPLE_1_INPUTS[0][0], 'hex').reverse(), index: 0 };
    assert.ok(compareInputs(a, b) > 0);
  });

  it('does not mutate the caller array', function () {
    const ins = [
      { txid: EXAMPLE_1_INPUTS[5][0], vout: 1 },
      { txid: EXAMPLE_1_INPUTS[0][0], vout: 0 }
    ];
    const copy = ins.slice();
    sortInputs(ins);
    assert.strictEqual(ins[0].txid, copy[0].txid);
  });

  it('sorts BIP-69 example 2 outputs by amount', function () {
    const high = {
      value: 2400000000,
      scriptPubKey: Buffer.from('41044a656f065871a353f216ca26cef8dde2f03e8c16202d2e8ad769f02032cb86a5eb5e56842e92e19141d60a01928f8dd2c875a390f67c1f6c94cfc617c0ea45afac', 'hex')
    };
    const low = {
      amount: 100000000n,
      script: Buffer.from('41046a0765b5865641ce08dd39690aade26dfbf5511430ca428a3089261361cef170e3929a68aee3d8d4848b0c5111b0a37b82b86ad559fd2a745b44d8e8d9dfdc0cac', 'hex')
    };
    const sorted = sortOutputs([high, low]);
    assert.strictEqual(Number(sorted[0].amount), 100000000);
    assert.strictEqual(sorted[1].value, 2400000000);
  });

  it('sortTransaction copies ins/outs and accepts bitcoinjs-style hashIsDisplay', function () {
    const txid = EXAMPLE_1_INPUTS[0][0];
    const got = sortTransaction({
      ins: [
        { txid: EXAMPLE_1_INPUTS[1][0], vout: 1 },
        { hash: Buffer.from(txid, 'hex'), hashIsDisplay: true, index: 0 }
      ],
      outputs: [
        { value: 2, script: Buffer.from('51', 'hex') },
        { value: 1, script: Buffer.from('00', 'hex') }
      ]
    });
    assert.strictEqual(got.ins[0].index, 0);
    assert.strictEqual(got.outs[0].value, 1);
    const empty = sortTransaction(null);
    assert.deepStrictEqual(empty, { ins: [], outs: [] });
  });

  it('rejects malformed prevouts', function () {
    assert.throws(() => sortInputs([{ txid: 'dead', vout: 0 }]), /32-byte hex/);
    assert.throws(() => sortInputs([{ txid: EXAMPLE_1_INPUTS[0][0], vout: -1 }]), /uint32/);
    assert.throws(() => sortOutputs([{ value: 1 }]), /script/);
    assert.throws(() => sortInputs('nope'), /array/);
    assert.deepStrictEqual(sortInputs([]), []);
    assert.deepStrictEqual(sortOutputs([]), []);
  });
});

const { sortPubkeysBip67, comparePubkeysBip67 } = require('../functions/bip67');
const { parseCompressedPubkeysSorted } = require('../functions/contractTaproot');

const KEY_LOW = '02' + '11'.repeat(32);
const KEY_HIGH = '03' + '11'.repeat(32);

describe('@fabric/core/functions/bip67', function () {
  it('sorts compressed pubkeys lexicographically', function () {
    const sorted = sortPubkeysBip67([KEY_HIGH, KEY_LOW]);
    assert.strictEqual(sorted[0].toString('hex'), KEY_LOW);
    assert.strictEqual(sorted[1].toString('hex'), KEY_HIGH);
    assert.ok(comparePubkeysBip67(KEY_LOW, KEY_HIGH) < 0);
  });

  it('accepts Buffer keys and does not mutate the input array', function () {
    const a = Buffer.from(KEY_HIGH, 'hex');
    const b = Buffer.from(KEY_LOW, 'hex');
    const input = [a, b];
    const sorted = sortPubkeysBip67(input);
    assert.strictEqual(input[0], a);
    assert.ok(sorted[0].equals(b));
  });

  it('is the sort used by contractTaproot.parseCompressedPubkeysSorted', function () {
    const keys = [KEY_HIGH, KEY_LOW, KEY_HIGH];
    const parsed = parseCompressedPubkeysSorted(keys);
    assert.strictEqual(parsed.length, 2);
    assert.strictEqual(parsed[0].toString('hex'), KEY_LOW);
    assert.strictEqual(parsed[1].toString('hex'), KEY_HIGH);
  });

  it('rejects uncompressed or truncated keys', function () {
    assert.throws(() => sortPubkeysBip67(['04' + '11'.repeat(64)]), /compressed/);
    assert.throws(() => sortPubkeysBip67(['02aabb']), /compressed/);
    assert.throws(() => sortPubkeysBip67(null), /array/);
    assert.throws(() => sortPubkeysBip67([1]), /Buffer, Uint8Array, or hex/);
  });

  it('accepts 0x-prefixed hex and Uint8Array keys', function () {
    const u8 = Uint8Array.from(Buffer.from(KEY_HIGH, 'hex'));
    const sorted = sortPubkeysBip67(['0x' + KEY_LOW, u8]);
    assert.strictEqual(sorted[0].toString('hex'), KEY_LOW);
    assert.strictEqual(sorted[1].toString('hex'), KEY_HIGH);
  });
});

const bitcoin = require('bitcoinjs-lib');
const { networks } = bitcoin;
const bip32Module = require('../functions/bip32');
const BIP32 = bip32Module.default;
const ecc = require('../types/ecc');
const {
  BITCOIN_KEY_DERIVATION_PATH,
  bitcoinBip49ReceiveDerivationPath
} = require('../constants');
const { p2shP2wpkhAddress, p2shP2wpkhPayment } = require('../functions/bip69');

describe('@fabric/core/functions/bip49', function () {
  it('keeps default funds path on BIP-44', function () {
    assert.strictEqual(BITCOIN_KEY_DERIVATION_PATH, "m/44'/0'/0'/0/0");
    assert.notStrictEqual(bitcoinBip49ReceiveDerivationPath(), BITCOIN_KEY_DERIVATION_PATH);
  });

  it('matches the published BIP-49 testnet vector (m/49\'/1\'/0\'/0/0)', function () {
    const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const seed = mnemonicToSeedSync(mnemonic);
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
    const pay = p2shP2wpkhPayment({ pubkey, network: networks.bitcoin });
    assert.ok(pay.output && pay.output.length === 23);
  });

  it('rejects uncompressed pubkeys', function () {
    assert.throws(
      () => p2shP2wpkhAddress({ pubkey: Buffer.alloc(65, 4) }),
      /compressed/
    );
  });
});
