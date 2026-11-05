'use strict';

const assert = require('assert');
const { payments, script, crypto } = require('bitcoinjs-lib');
const { sortPubkeysBip67, comparePubkeysBip67, asCompressedPubkey } = require('../functions/bip67');
const { parseCompressedPubkeysSorted } = require('../types/policy');

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
      assert.strictEqual(payments.p2sh({ hash: crypto.hash160(redeem) }).address, vector.address);
    });
  }
});
