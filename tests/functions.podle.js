'use strict';

const assert = require('assert');
const crypto = require('crypto');
const ecc = require('../types/ecc');
const podle = require('../functions/podle');

function randomPriv () {
  let priv;
  do {
    priv = crypto.randomBytes(32);
  } while (!ecc.isPrivate(priv));
  return priv;
}

function xOnly (priv) {
  return Buffer.from(ecc.pointFromScalar(priv, true)).subarray(1).toString('hex');
}

const UTXO = { txid: 'ab'.repeat(32), vout: 1 };

describe('functions/podle', function () {
  it('derives three distinct generators, none equal to G', function () {
    const seen = new Set();
    for (let i = 0; i < podle.PODLE_MAX_INDEX; i++) {
      const hex = Buffer.from(podle.generatorJ(i).toBytes(true)).toString('hex');
      assert.notStrictEqual(hex, Buffer.from(ecc.pointFromScalar(Buffer.from('00'.repeat(31) + '01', 'hex'), true)).toString('hex'));
      seen.add(hex);
    }
    assert.strictEqual(seen.size, podle.PODLE_MAX_INDEX);
    assert.throws(() => podle.generatorJ(podle.PODLE_MAX_INDEX), /index/);
  });

  it('round-trips a commitment and its reveal', function () {
    const priv = randomPriv();
    const { commitment, reveal } = podle.generatePodle({ privateKey: priv, utxo: UTXO, index: 1 });
    assert.strictEqual(commitment, podle.commitmentOf(reveal.P2));
    assert.strictEqual(reveal.P.slice(2), xOnly(priv));
    assert.deepStrictEqual(podle.verifyPodle({ commitment, reveal }), { ok: true, reason: null });
  });

  it('gives different commitments per index and the same P', function () {
    const priv = randomPriv();
    const a = podle.generatePodle({ privateKey: priv, utxo: UTXO, index: 0 });
    const b = podle.generatePodle({ privateKey: priv, utxo: UTXO, index: 2 });
    assert.notStrictEqual(a.commitment, b.commitment);
    assert.strictEqual(a.reveal.P, b.reveal.P);
    // Commitments are deterministic per (key, index): retries cannot dodge the blacklist.
    assert.strictEqual(podle.generatePodle({ privateKey: priv, utxo: UTXO, index: 0 }).commitment, a.commitment);
  });

  it('rejects tampered reveals', function () {
    const priv = randomPriv();
    const { commitment, reveal } = podle.generatePodle({ privateKey: priv, utxo: UTXO });
    const other = podle.generatePodle({ privateKey: randomPriv(), utxo: UTXO });
    const cases = [
      [{ commitment: other.commitment, reveal }, /commitment/],
      [{ commitment, reveal: Object.assign({}, reveal, { P: other.reveal.P }) }, /DLEQ/],
      [{ commitment, reveal: Object.assign({}, reveal, { vout: 2 }) }, /DLEQ/],
      [{ commitment, reveal: Object.assign({}, reveal, { txid: 'cd'.repeat(32) }) }, /DLEQ/],
      [{ commitment, reveal: Object.assign({}, reveal, { index: 1 }) }, /DLEQ/],
      [{ commitment, reveal: Object.assign({}, reveal, { s: reveal.e }) }, /DLEQ/],
      [{ commitment, reveal: Object.assign({}, reveal, { e: '00'.repeat(32) }) }, /range/],
      [{ commitment, reveal: Object.assign({}, reveal, { index: 3 }) }, /index/]
    ];
    for (const [input, reason] of cases) {
      const v = podle.verifyPodle(input);
      assert.strictEqual(v.ok, false);
      assert.match(v.reason, reason);
    }
  });

  it('refuses a P2 forged without the key (different discrete log)', function () {
    const priv = randomPriv();
    const forged = podle.generatePodle({ privateKey: priv, utxo: UTXO });
    // Swap in P2 from another key: the commitment then names P2' but the proof binds P.
    const other = podle.generatePodle({ privateKey: randomPriv(), utxo: UTXO });
    const reveal = Object.assign({}, forged.reveal, { P2: other.reveal.P2 });
    const v = podle.verifyPodle({ commitment: podle.commitmentOf(reveal.P2), reveal });
    assert.strictEqual(v.ok, false);
  });

  it('checks the revealed UTXO against the chain', function () {
    const priv = randomPriv();
    const { reveal } = podle.generatePodle({ privateKey: priv, utxo: UTXO });
    const utxo = { scriptPubKeyHex: `5120${xOnly(priv)}`, valueSats: 50000, confirmations: 10 };
    assert.strictEqual(podle.checkPodleUtxo({ reveal, utxo, amountSats: 100000 }).ok, true);
    assert.match(podle.checkPodleUtxo({ reveal, utxo: null, amountSats: 100000 }).reason, /spent/);
    assert.match(podle.checkPodleUtxo({ reveal, utxo: Object.assign({}, utxo, { scriptPubKeyHex: `5120${'11'.repeat(32)}` }), amountSats: 100000 }).reason, /P2TR/);
    assert.match(podle.checkPodleUtxo({ reveal, utxo: Object.assign({}, utxo, { confirmations: 2 }), amountSats: 100000 }).reason, /confirmations/);
    assert.match(podle.checkPodleUtxo({ reveal, utxo, amountSats: 1000000 }).reason, /20%/);
  });

  it('tracks the next unused index', function () {
    assert.strictEqual(podle.nextIndex([]), 0);
    assert.strictEqual(podle.nextIndex([0, 2]), 1);
    assert.strictEqual(podle.nextIndex([0, 1, 2]), null);
  });

  it('remembers used commitments in a bounded blacklist', function () {
    const list = new podle.PodleBlacklist({ max: 2 });
    const [a, b, c] = ['aa', 'bb', 'cc'].map((x) => x.repeat(32));
    assert.strictEqual(list.add(a), true);
    assert.strictEqual(list.add(a), false);
    list.add(b);
    list.add(c);
    assert.strictEqual(list.size, 2);
    assert.strictEqual(list.has(a), false);
    assert.strictEqual(list.has(c), true);
    const restored = new podle.PodleBlacklist({ commitments: list.toJSON() });
    assert.deepStrictEqual(restored.toJSON(), [b, c]);
  });
});
