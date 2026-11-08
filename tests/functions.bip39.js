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
const { fromSeed } = require('../functions/bip32');
const VECTORS = require('./vectors/bip39.json');
const Htlc = require('../types/htlc');
const { encodeBitcoinUri, parseBitcoinUri } = require('../functions/bip21');
const { payments, script, crypto: bcrypto } = require('bitcoinjs-lib');
const { sortPubkeysBip67, comparePubkeysBip67, asCompressedPubkey } = require('../functions/bip67');
const { parseCompressedPubkeysSorted } = require('../types/policy');
const { sortInputs, sortOutputs, sortTransaction, compareInputs, prevoutHashDisplay } = require('../functions/bip69');
const { fromBase58 } = require('../functions/bip32');
const { BIP85_PURPOSE, bip85Path, entropyFromPrivateKey, truncateEntropy, deriveBip85Entropy, deriveBip85Mnemonic, deriveBip85Hex, deriveBip85Xprv, deriveBip85Wif } = require('../functions/bip85');
const { BIP125_SEQUENCE_FINAL, BIP125_SEQUENCE_LOCKTIME_ONLY, BIP125_SEQUENCE_RBF, sequenceSignalsOptInRbf, transactionSignalsOptInRbf } = require('../functions/bip125');
const { sealPlaintext, openCiphertext, paymentHashHexFromKey } = require('../functions/documentSealedExchange');
const { documentPublishEnvelopeBuffer, inventoryHtlcPreimage32, purchaseContentHashHex } = require('../functions/publishedDocumentEnvelope');
const Document = require('../types/document');

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

describe('@fabric/core/functions/bip39 official test vectors (English, passphrase TREZOR)', function () {
  for (const { entropy, mnemonic, seed, xprv } of VECTORS.english) {
    it(`round-trips ${entropy.length * 4}-bit entropy ${entropy.slice(0, 8)}…`, function () {
      const bytes = Buffer.from(entropy, 'hex');
      assert.strictEqual(entropyToMnemonic(bytes), mnemonic);
      assert.ok(mnemonicToEntropy(mnemonic).equals(bytes));
      assert.ok(validateMnemonic(mnemonic));
      const derived = mnemonicToSeedSync(mnemonic, VECTORS.passphrase);
      assert.strictEqual(derived.toString('hex'), seed);
      assert.strictEqual(fromSeed(derived).toBase58(), xprv);
    });
  }
});

describe('@fabric/core/functions/bip21', function () {
  it('encodes amount and label like inventory HTLC funding hints', function () {
    const uri = encodeBitcoinUri({
      address: 'bcrt1pv25g0waah5e7rhkdcrmnanexxsng93uew5xe8tzzpuq5ckkwzltsalzjxr',
      amount: '0.00100000',
      label: 'Test doc'
    });
    assert.ok(uri.startsWith('bitcoin:bcrt1'));
    assert.ok(uri.includes('amount=0.00100000'));
    const parsed = parseBitcoinUri(uri);
    assert.strictEqual(parsed.address, 'bcrt1pv25g0waah5e7rhkdcrmnanexxsng93uew5xe8tzzpuq5ckkwzltsalzjxr');
    assert.strictEqual(parsed.amount, '0.00100000');
    assert.strictEqual(parsed.label, 'Test doc');
  });

  it('round-trips opaque BIP-321 extras (lightning, pj)', function () {
    const uri = encodeBitcoinUri({
      address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
      extras: { lightning: 'lnbc1qq', pj: 'https://example.test/pj' }
    });
    const parsed = parseBitcoinUri(uri);
    assert.strictEqual(parsed.extras.lightning, 'lnbc1qq');
    assert.strictEqual(parsed.extras.pj, 'https://example.test/pj');
  });

  it('is used by Htlc.fundingHints', function () {
    const h = Htlc.fundingHints({
      paymentAddress: 'bcrt1pv25g0waah5e7rhkdcrmnanexxsng93uew5xe8tzzpuq5ckkwzltsalzjxr',
      amountSats: 100000,
      label: 'Test doc'
    });
    const parsed = parseBitcoinUri(h.bitcoinUri);
    assert.strictEqual(parsed.amount, '0.00100000');
    assert.strictEqual(parsed.label, 'Test doc');
  });

  it('parses official BIP-21 examples (address, amount, label, message)', function () {
    const addr = '175tWpb8K1S7NmH4Zx6rewF9WQrcZv245W';
    const bare = parseBitcoinUri(`bitcoin:${addr}`);
    assert.strictEqual(bare.address, addr);
    assert.strictEqual(bare.amount, null);
    const paid = parseBitcoinUri(`bitcoin:${addr}?amount=20.3&label=Luke-Jr`);
    assert.strictEqual(paid.amount, '20.3');
    assert.strictEqual(paid.label, 'Luke-Jr');
    const msg = parseBitcoinUri(
      `bitcoin:${addr}?amount=50&label=Luke-Jr&message=Donation%20for%20project%20xyz`
    );
    assert.strictEqual(msg.message, 'Donation for project xyz');
    const upper = parseBitcoinUri(`BITCOIN:${addr}`);
    assert.strictEqual(upper.address, addr);
    const slash = parseBitcoinUri(`bitcoin://${addr}?amount=1`);
    assert.strictEqual(slash.address, addr);
    assert.strictEqual(slash.amount, '1');
  });

  it('encodes message and address-only URIs; extras cannot override amount', function () {
    const uri = encodeBitcoinUri({
      address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
      amount: 1,
      extras: { amount: '9', lightning: 'lnbc1qq', unused: '' }
    });
    const parsed = parseBitcoinUri(uri);
    assert.strictEqual(parsed.amount, '1.00000000');
    assert.strictEqual(parsed.extras.lightning, 'lnbc1qq');
    assert.ok(!Object.prototype.hasOwnProperty.call(parsed.extras, 'unused'));
    assert.strictEqual(
      encodeBitcoinUri({ address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4' }),
      'bitcoin:bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'
    );
    const withMsg = encodeBitcoinUri({
      address: '175tWpb8K1S7NmH4Zx6rewF9WQrcZv245W',
      message: 'Donation for project xyz'
    });
    assert.strictEqual(parseBitcoinUri(withMsg).message, 'Donation for project xyz');
  });

  it('percent-encodes per RFC 3986: space is %20 and + is a literal plus', function () {
    const addr = '175tWpb8K1S7NmH4Zx6rewF9WQrcZv245W';
    assert.strictEqual(
      encodeBitcoinUri({ address: addr, amount: '50', label: 'Luke-Jr', message: 'Donation for project xyz' }),
      `bitcoin:${addr}?amount=50&label=Luke-Jr&message=Donation%20for%20project%20xyz`
    );
    assert.strictEqual(parseBitcoinUri(`bitcoin:${addr}?label=a+b`).label, 'a+b');
    const plus = encodeBitcoinUri({ address: addr, label: 'C++ & co = 100%' });
    assert.ok(plus.endsWith('label=C%2B%2B%20%26%20co%20%3D%20100%25'));
    assert.strictEqual(parseBitcoinUri(plus).label, 'C++ & co = 100%');
    assert.throws(() => parseBitcoinUri(`bitcoin:${addr}?label=%E0%A4%A`), /percent-encoding/);
  });

  it('parses the BIP-321 examples (case-insensitive keys, repeated and empty-address forms)', function () {
    const upper = parseBitcoinUri('BITCOIN:BC1QUFGY354J3KMVUCH987XE4S40836X3H0LG8F5NQ?BC=BC1P5SWKUGEZN97763TL0YTY6556856UUG0Q6JFLLJVEP9M4P7339X5QZYRH4Q');
    assert.strictEqual(upper.address, 'BC1QUFGY354J3KMVUCH987XE4S40836X3H0LG8F5NQ');
    assert.strictEqual(upper.extras.bc, 'BC1P5SWKUGEZN97763TL0YTY6556856UUG0Q6JFLLJVEP9M4P7339X5QZYRH4Q');
    const two = parseBitcoinUri('bitcoin:?bc=bc1qufgy354j3kmvuch987xe4s40836x3h0lg8f5nq&bc=bc1p5swkugezn97763tl0yty6556856uug0q6jflljvep9m4p7339x5qzyrh4q');
    assert.strictEqual(two.address, '');
    assert.deepStrictEqual(two.extras.bc, [
      'bc1qufgy354j3kmvuch987xe4s40836x3h0lg8f5nq',
      'bc1p5swkugezn97763tl0yty6556856uug0q6jflljvep9m4p7339x5qzyrh4q'
    ]);
    assert.strictEqual(parseBitcoinUri('bitcoin:?lightning=lnbc420bogusinvoice').extras.lightning, 'lnbc420bogusinvoice');
    const offers = parseBitcoinUri('bitcoin:?lno=lno1bogusoffer&sp=sp1qsilentpayment');
    assert.strictEqual(offers.extras.lno, 'lno1bogusoffer');
    assert.strictEqual(offers.extras.sp, 'sp1qsilentpayment');
    const shouted = parseBitcoinUri('bitcoin:175tWpb8K1S7NmH4Zx6rewF9WQrcZv245W?AMOUNT=20.3&Label=Luke-Jr');
    assert.strictEqual(shouted.amount, '20.3');
    assert.strictEqual(shouted.label, 'Luke-Jr');
    const unknown = parseBitcoinUri('bitcoin:175tWpb8K1S7NmH4Zx6rewF9WQrcZv245W?somethingyoudontunderstand=50&somethingelseyoudontget=999');
    assert.strictEqual(unknown.extras.somethingyoudontunderstand, '50');
  });

  it('rejects the BIP-321 invalid URIs', function () {
    const addr = '175tWpb8K1S7NmH4Zx6rewF9WQrcZv245W';
    assert.throws(() => parseBitcoinUri(`bitcoin:${addr}?label=Luke-Jr&label=Matt`), /twice: label/);
    assert.throws(() => parseBitcoinUri(`bitcoin:${addr}?amount=42&amount=10`), /twice: amount/);
    assert.throws(() => parseBitcoinUri(`bitcoin:${addr}?amount=42&amount=42`), /twice: amount/);
    assert.throws(() => parseBitcoinUri(`bitcoin:${addr}?pop=callback%3a&req-pop=callback%3a`), /req-pop/);
    assert.throws(() => parseBitcoinUri(`bitcoin:${addr}?req-pop=https%3aevilwebsite.com`), /req-pop/);
    assert.throws(
      () => parseBitcoinUri(`bitcoin:${addr}?req-somethingyoudontunderstand=50&req-somethingelseyoudontget=999`),
      /unsupported required/
    );
    assert.throws(() => parseBitcoinUri(`bitcoin:${addr}?pj=https://a.test/pj&pj=https://b.test/pj`), /twice: pj/);
    assert.throws(() => parseBitcoinUri('bitcoin:'), /address or a payment instruction/);
    assert.throws(() => parseBitcoinUri('bitcoin:?label=nobody'), /address or a payment instruction/);
  });

  it('repeats array extras and keeps __proto__ a plain key', function () {
    const uri = encodeBitcoinUri({
      address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
      extras: { bc: ['bc1qa', 'bc1pb'], LABEL: 'ignored' }
    });
    assert.strictEqual(uri, 'bitcoin:bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4?bc=bc1qa&bc=bc1pb');
    const parsed = parseBitcoinUri('bitcoin:bc1qxx?__proto__=x');
    assert.strictEqual(parsed.extras.__proto__, 'x');
    assert.strictEqual(Object.getPrototypeOf(parsed.extras), Object.prototype);
  });

  it('rejects amounts finer than one satoshi', function () {
    assert.throws(() => encodeBitcoinUri({ address: 'bc1qxx', amount: '0.000000001' }), /decimal BTC/);
    assert.throws(() => parseBitcoinUri('bitcoin:bc1qxx?amount=0.000000001'), /amount is invalid/);
    assert.strictEqual(parseBitcoinUri('bitcoin:bc1qxx?amount=0.00000001').amount, '0.00000001');
  });

  it('rejects missing address and invalid amounts', function () {
    assert.throws(() => encodeBitcoinUri({}), /address/);
    assert.throws(() => encodeBitcoinUri({ address: 'bc1qxx', amount: -1 }), /non-negative/);
    assert.throws(() => encodeBitcoinUri({ address: 'bc1q?bad' }), /\? or #/);
    assert.throws(() => encodeBitcoinUri({ address: 'bc1qxx', amount: '1btc' }), /decimal BTC/);
    assert.throws(
      () => encodeBitcoinUri({ address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', amount: 0.000000009 }),
      /non-negative BTC/
    );
    assert.throws(
      () => encodeBitcoinUri({ address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', amount: 0.000000004 }),
      /non-negative BTC/
    );
    assert.throws(() => parseBitcoinUri('https://example.test'), /bitcoin:/);
    assert.throws(() => parseBitcoinUri('bitcoin:addr?amount=-1'), /amount is invalid/);
    assert.throws(
      () => parseBitcoinUri('bitcoin:addr?req-something=1'),
      /unsupported required BIP21 parameter/
    );
    assert.throws(
      () => parseBitcoinUri('bitcoin:addr?REQ-exp=1'),
      /unsupported required BIP21 parameter/
    );
  });
});

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

  it('asCompressedPubkey is the shared compressed-key parser', function () {
    assert.ok(asCompressedPubkey(KEY_LOW).equals(Buffer.from(KEY_LOW, 'hex')));
    assert.throws(() => asCompressedPubkey(Buffer.alloc(33, 4)), /compressed/);
  });
});

/** BIP-67 test vectors: 2-of-n bare multisig redeem script and P2SH address. */
const BIP67_VECTORS = [
  {
    list: [
      '02ff12471208c14bd580709cb2358d98975247d8765f92bc25eab3b2763ed605f8',
      '02fe6f0a5a297eb38c391581c4413e084773ea23954d93f7753db7dc0adc188b2f'
    ],
    script: '522102fe6f0a5a297eb38c391581c4413e084773ea23954d93f7753db7dc0adc188b2f2102ff12471208c14bd580709cb2358d98975247d8765f92bc25eab3b2763ed605f852ae',
    address: '39bgKC7RFbpoCRbtD5KEdkYKtNyhpsNa3Z'
  },
  {
    list: [
      '02632b12f4ac5b1d1b72b2a3b508c19172de44f6f46bcee50ba33f3f9291e47ed0',
      '027735a29bae7780a9755fae7a1c4374c656ac6a69ea9f3697fda61bb99a4f3e77',
      '02e2cc6bd5f45edd43bebe7cb9b675f0ce9ed3efe613b177588290ad188d11b404'
    ],
    script: '522102632b12f4ac5b1d1b72b2a3b508c19172de44f6f46bcee50ba33f3f9291e47ed021027735a29bae7780a9755fae7a1c4374c656ac6a69ea9f3697fda61bb99a4f3e772102e2cc6bd5f45edd43bebe7cb9b675f0ce9ed3efe613b177588290ad188d11b40453ae',
    address: '3CKHTjBKxCARLzwABMu9yD85kvtm7WnMfH'
  },
  {
    list: [
      '030000000000000000000000000000000000004141414141414141414141414141',
      '020000000000000000000000000000000000004141414141414141414141414141',
      '020000000000000000000000000000000000004141414141414141414141414140',
      '030000000000000000000000000000000000004141414141414141414141414140'
    ],
    script: '522102000000000000000000000000000000000000414141414141414141414141414021020000000000000000000000000000000000004141414141414141414141414141210300000000000000000000000000000000000041414141414141414141414141402103000000000000000000000000000000000000414141414141414141414141414154ae',
    address: '32V85igBri9zcfBRVupVvwK18NFtS37FuD'
  },
  {
    list: [
      '022df8750480ad5b26950b25c7ba79d3e37d75f640f8e5d9bcd5b150a0f85014da',
      '03e3818b65bcc73a7d64064106a859cc1a5a728c4345ff0b641209fba0d90de6e9',
      '021f2f6e1e50cb6a953935c3601284925decd3fd21bc445712576873fb8c6ebc18'
    ],
    script: '5221021f2f6e1e50cb6a953935c3601284925decd3fd21bc445712576873fb8c6ebc1821022df8750480ad5b26950b25c7ba79d3e37d75f640f8e5d9bcd5b150a0f85014da2103e3818b65bcc73a7d64064106a859cc1a5a728c4345ff0b641209fba0d90de6e953ae',
    address: '3Q4sF6tv9wsdqu2NtARzNCpQgwifm2rAba'
  }
];

describe('@fabric/core/functions/bip67 official test vectors', function () {
  for (const [n, vector] of BIP67_VECTORS.entries()) {
    it(`matches test vector ${n + 1}`, function () {
      const keys = sortPubkeysBip67(vector.list);
      const redeem = script.compile([
        script.number.encode(2),
        ...keys,
        script.number.encode(keys.length),
        script.OPS.OP_CHECKMULTISIG
      ]);
      assert.strictEqual(Buffer.from(redeem).toString('hex'), vector.script);
      assert.strictEqual(payments.p2sh({ hash: bcrypto.hash160(redeem) }).address, vector.address);
    });
  }
});

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

  it('sorts BIP-69 example 1 inputs from any starting order', function () {
    const ins = EXAMPLE_1_INPUTS.map(([txid, vout]) => ({ txid, vout }));
    for (let seed = 1; seed <= 5; seed++) {
      const shuffled = ins.slice();
      let s = seed;
      for (let i = shuffled.length - 1; i > 0; i--) {
        s = (s * 1103515245 + 12345) % 2147483648;
        const j = s % (i + 1);
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      assert.deepStrictEqual(sortInputs(shuffled), ins);
    }
  });

  it('compares output amounts as uint64, beyond 2^53', function () {
    const script = Buffer.from('51', 'hex');
    const big = { value: (2n ** 53n) + 1n, script };
    const bigger = { value: (2n ** 53n) + 2n, script };
    const max = { value: 0xffffffffffffffffn, script };
    const sorted = sortOutputs([max, bigger, big]);
    assert.deepStrictEqual(sorted, [big, bigger, max]);
    assert.throws(() => sortOutputs([{ value: 2n ** 64n, script }]), /uint64/);
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

describe('@fabric/core/functions/bip125', function () {
  it('treats MAX-2 as opt-in RBF and MAX-1 as locktime-only', function () {
    assert.strictEqual(BIP125_SEQUENCE_FINAL, (2 ** 32) - 1);
    assert.strictEqual(BIP125_SEQUENCE_LOCKTIME_ONLY, (2 ** 32) - 2);
    assert.strictEqual(BIP125_SEQUENCE_RBF, (2 ** 32) - 3);
    assert.strictEqual(sequenceSignalsOptInRbf(BIP125_SEQUENCE_FINAL), false);
    assert.strictEqual(sequenceSignalsOptInRbf(BIP125_SEQUENCE_LOCKTIME_ONLY), false);
    assert.strictEqual(sequenceSignalsOptInRbf(BIP125_SEQUENCE_RBF), true);
    assert.strictEqual(sequenceSignalsOptInRbf(0), true);
  });

  it('opts the transaction in when any input signals RBF', function () {
    assert.strictEqual(transactionSignalsOptInRbf([
      { sequence: BIP125_SEQUENCE_LOCKTIME_ONLY },
      { nSequence: BIP125_SEQUENCE_RBF }
    ]), true);
    assert.strictEqual(transactionSignalsOptInRbf([
      { sequence: BIP125_SEQUENCE_LOCKTIME_ONLY }
    ]), false);
    assert.strictEqual(transactionSignalsOptInRbf([]), false);
    assert.strictEqual(transactionSignalsOptInRbf(null), false);
    assert.strictEqual(sequenceSignalsOptInRbf(undefined), false);
    assert.strictEqual(sequenceSignalsOptInRbf(Number.NaN), false);
    assert.strictEqual(sequenceSignalsOptInRbf(0.5), false);
    assert.strictEqual(sequenceSignalsOptInRbf(4294967296), false);
  });
});

describe('BIP: content-addressed file exchange (test vectors)', function () {
  const VECTORS = require('./vectors/bip-fabric-file-exchange.json');

  function sha256 (buf) {
    return crypto.createHash('sha256').update(buf).digest();
  }

  function taggedHash (tag, msg) {
    const t = sha256(Buffer.from(tag, 'utf8'));
    return sha256(Buffer.concat([t, t, msg]));
  }

  describe('convergent sealing', function () {
    for (const v of VECTORS.convergent) {
      it(`matches the spec for ${v.plaintextHex.length / 2}-byte plaintext${v.secret ? ' (scoped)' : ''}`, function () {
        const plain = Buffer.from(v.plaintextHex, 'hex');
        const head = v.secret
          ? Buffer.concat([Buffer.from([1]), sha256(Buffer.from(v.secret, 'utf8'))])
          : Buffer.from([0]);
        const key = taggedHash('Fabric/DocumentConvergentKey', Buffer.concat([head, plain]));
        const iv = taggedHash('Fabric/DocumentConvergentIv', key).subarray(0, 12);
        assert.strictEqual(key.toString('hex'), v.keyHex);
        assert.strictEqual(iv.toString('hex'), v.ivHex);
        assert.strictEqual(sha256(key).toString('hex'), v.paymentHashHex);
        assert.strictEqual(sha256(Buffer.from(v.ciphertextHex, 'hex')).toString('hex'), v.chunkIdHex);

        const sealed = sealPlaintext(plain, { convergent: true, secret: v.secret || undefined });
        assert.strictEqual(sealed.key.toString('hex'), v.keyHex);
        assert.strictEqual(sealed.ciphertext.toString('hex'), v.ciphertextHex);
        assert.strictEqual(sealed.contentSha256, v.chunkIdHex);
        assert.strictEqual(paymentHashHexFromKey(sealed.key), v.paymentHashHex);
        assert.ok(openCiphertext(sealed.ciphertext, key, iv).equals(plain));
      });
    }
  });

  describe('document tree', function () {
    for (const v of VECTORS.tree) {
      it(`root over ${v.blobs.length} blob(s) matches the spec`, function () {
        const leaves = v.blobs.map((b) => sha256(Buffer.concat([
          Buffer.from([0x00]),
          Buffer.from(b.blobHashHex, 'hex'),
          Buffer.from(b.paymentHashHex, 'hex'),
          Buffer.from(b.ivHex, 'hex')
        ])));
        assert.deepStrictEqual(leaves.map((l) => l.toString('hex')), v.leavesHex);
        let nodes = leaves;
        while (nodes.length > 1) {
          const next = [];
          for (let i = 0; i < nodes.length; i += 2) {
            next.push(i + 1 < nodes.length
              ? sha256(Buffer.concat([Buffer.from([0x01]), nodes[i], nodes[i + 1]]))
              : nodes[i]);
          }
          nodes = next;
        }
        const count = Buffer.alloc(4);
        count.writeUInt32BE(v.blobs.length, 0);
        const root = sha256(Buffer.concat([Buffer.from([0x02]), count, nodes[0]]));
        assert.strictEqual(root.toString('hex'), v.rootHex);

        const blobs = v.blobs.map((b) => ({
          blobHashHex: b.blobHashHex,
          paymentHashHex: b.paymentHashHex,
          iv: Buffer.from(b.ivHex, 'hex').toString('base64')
        }));
        assert.deepStrictEqual(blobs.map((b) => Document.leafHex(b)), v.leavesHex);
        assert.strictEqual(Document.rootHex(blobs), v.rootHex);
      });
    }

    it('a blob list without payment hashes or IVs uses zero fields', function () {
      const v = VECTORS.tree[2];
      const hashes = v.blobs.map((b) => b.blobHashHex);
      assert.strictEqual(Document.rootHexFromBlobHashes(hashes), Document.rootHex(hashes.map((blobHashHex) => ({ blobHashHex }))));
      assert.notStrictEqual(Document.rootHexFromBlobHashes(hashes), v.rootHex);
    });
  });

  describe('envelope commitment', function () {
    for (const v of VECTORS.envelope) {
      it('preimage = SHA256(envelope), commitment = SHA256(preimage)', function () {
        const buf = documentPublishEnvelopeBuffer(v.documentId, v.document);
        assert.strictEqual(buf.toString('hex'), v.envelopeHex);
        assert.strictEqual(sha256(buf).toString('hex'), v.preimageHex);
        assert.strictEqual(inventoryHtlcPreimage32(v.documentId, v.document).toString('hex'), v.preimageHex);
        assert.strictEqual(sha256(Buffer.from(v.preimageHex, 'hex')).toString('hex'), v.contentHashHex);
        assert.strictEqual(purchaseContentHashHex(v.documentId, v.document), v.contentHashHex);
      });

      it('envelope bytes match the spec layout', function () {
        const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
        const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b; };
        const bytes = (b) => Buffer.concat([u32(b.length), b]);
        const str = (s) => bytes(Buffer.from(s, 'utf8'));
        const d = v.document;
        const body = Buffer.concat([
          u32(0x7f),
          bytes(Buffer.from(d.contentBase64, 'base64')),
          str(v.documentId),
          str(d.mime),
          str(d.name),
          u32(d.revision),
          str(d.sha256),
          u64(d.size),
          str('')
        ]);
        const envelope = Buffer.concat([
          Buffer.from('c0d3f33d', 'hex'),
          u32(1),
          Buffer.alloc(32),
          Buffer.alloc(32),
          u32(0x3e6),
          u32(body.length),
          sha256(sha256(body)),
          Buffer.alloc(32),
          Buffer.alloc(64),
          body
        ]);
        assert.strictEqual(envelope.toString('hex'), v.envelopeHex);
      });
    }
  });

  describe('unsealed per-blob binding', function () {
    for (const v of VECTORS.blobPayment) {
      it(`blob ${v.blobIndex} matches the spec`, function () {
        const payload = Buffer.concat([
          Buffer.from('Fabric/DocumentBlob', 'utf8'),
          Buffer.from(v.documentId, 'utf8'),
          Buffer.from([0]),
          Buffer.from(String(v.blobIndex), 'utf8'),
          Buffer.from([0]),
          Buffer.from(v.blobHashHex, 'utf8')
        ]);
        assert.strictEqual(sha256(payload).toString('hex'), v.contentHashHex);
        assert.strictEqual(Document.blobPaymentHash(v), v.contentHashHex);
      });
    }
  });

  describe('P2TR HTLC template', function () {
    for (const v of VECTORS.htlc) {
      it(`${v.network} output from fixed keys`, function () {
        const xClaim = v.claimPubkeyHex.slice(2);
        const xRefund = v.refundPubkeyHex.slice(2);
        assert.strictEqual(v.claimScriptHex, `a820${v.paymentHashHex}8820${xClaim}ac`);
        assert.ok(v.refundScriptHex.endsWith(`b17520${xRefund}ac`));

        const htlc = new Htlc({
          network: v.network,
          claimPubkey: v.claimPubkeyHex,
          refundPubkey: v.refundPubkeyHex,
          paymentHash: v.paymentHashHex,
          refundLocktime: v.refundLocktime
        });
        assert.strictEqual(htlc.claimScript.toString('hex'), v.claimScriptHex);
        assert.strictEqual(htlc.refundScript.toString('hex'), v.refundScriptHex);
        assert.strictEqual(htlc.merkleRootHex, v.merkleRootHex);
        assert.strictEqual(htlc.controlBlock('claim').toString('hex'), v.claimControlBlockHex);
        assert.strictEqual(htlc.controlBlock('refund').toString('hex'), v.refundControlBlockHex);
        assert.strictEqual(htlc.output.toString('hex'), v.outputHex);
        assert.strictEqual(htlc.address, v.address);
      });
    }
  });
});
