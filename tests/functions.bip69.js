'use strict';

const assert = require('assert');
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
