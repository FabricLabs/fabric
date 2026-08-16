'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  InvalidContributionError,
  ValueError,
  musig2IsNOfN,
  individualPk,
  keySort,
  keyAgg,
  getXonlyPk,
  keyAggAndTweak,
  nonceGenInternal,
  nonceAgg,
  sessionContext,
  sign,
  partialSigVerify,
  partialSigVerifyInternal,
  partialSigAgg,
  deterministicSign,
  aggregateXonly,
  verifyAggregatedSchnorr
} = require('../functions/musig2');

const VEC = path.join(__dirname, 'vectors', 'bip327');

function load (name) {
  return JSON.parse(fs.readFileSync(path.join(VEC, name), 'utf8'));
}

function hx (hex) {
  return Buffer.from(String(hex), 'hex');
}

function pick (arr, indices) {
  return indices.map((i) => arr[i]);
}

function expectError (fn, spec) {
  let err;
  try {
    fn();
  } catch (e) {
    err = e;
  }
  assert.ok(err, 'expected exception: ' + JSON.stringify(spec));
  if (spec.type === 'invalid_contribution') {
    assert.ok(err instanceof InvalidContributionError, err.message);
    if (Object.prototype.hasOwnProperty.call(spec, 'signer')) {
      assert.strictEqual(err.signer, spec.signer);
    }
    if (spec.contrib) assert.strictEqual(err.contrib, spec.contrib);
  } else if (spec.type === 'value') {
    assert.ok(err instanceof ValueError, err.name + ': ' + err.message);
    assert.strictEqual(err.message, spec.message);
  } else {
    throw new Error('unknown error type ' + spec.type);
  }
}

describe('@fabric/core/functions/musig2 BIP-327', function () {
  it('treats MuSig2 as n-of-n only', function () {
    assert.strictEqual(musig2IsNOfN(2, 2), true);
    assert.strictEqual(musig2IsNOfN(2, 3), false);
    assert.strictEqual(musig2IsNOfN(1, 1), false);
  });

  it('matches key_sort_vectors.json', function () {
    const data = load('key_sort_vectors.json');
    const sorted = keySort(data.pubkeys.map(hx));
    assert.deepStrictEqual(
      sorted.map((b) => b.toString('hex').toUpperCase()),
      data.sorted_pubkeys.map((s) => s.toUpperCase())
    );
  });

  it('matches key_agg_vectors.json', function () {
    const data = load('key_agg_vectors.json');
    const X = data.pubkeys.map(hx);
    const T = data.tweaks.map(hx);
    for (const tc of data.valid_test_cases) {
      const pubkeys = pick(X, tc.key_indices);
      const got = getXonlyPk(keyAgg(pubkeys));
      assert.strictEqual(got.toString('hex').toUpperCase(), tc.expected.toUpperCase());
    }
    for (const tc of data.error_test_cases) {
      expectError(() => {
        keyAggAndTweak(pick(X, tc.key_indices), pick(T, tc.tweak_indices), tc.is_xonly);
      }, tc.error);
    }
  });

  it('matches nonce_gen_vectors.json', function () {
    const data = load('nonce_gen_vectors.json');
    for (const tc of data.test_cases) {
      const maybe = (key) => (tc[key] == null ? null : hx(tc[key]));
      const { secnonce, pubnonce } = nonceGenInternal(
        hx(tc.rand_),
        maybe('sk'),
        hx(tc.pk),
        maybe('aggpk'),
        maybe('msg'),
        maybe('extra_in')
      );
      assert.strictEqual(secnonce.toString('hex').toUpperCase(), tc.expected_secnonce.toUpperCase());
      assert.strictEqual(pubnonce.toString('hex').toUpperCase(), tc.expected_pubnonce.toUpperCase());
    }
  });

  it('matches nonce_agg_vectors.json', function () {
    const data = load('nonce_agg_vectors.json');
    const pnonce = data.pnonces.map(hx);
    for (const tc of data.valid_test_cases) {
      const got = nonceAgg(pick(pnonce, tc.pnonce_indices));
      assert.strictEqual(got.toString('hex').toUpperCase(), tc.expected.toUpperCase());
    }
    for (const tc of data.error_test_cases) {
      expectError(() => nonceAgg(pick(pnonce, tc.pnonce_indices)), tc.error);
    }
  });

  it('matches sign_verify_vectors.json', function () {
    const data = load('sign_verify_vectors.json');
    const sk = hx(data.sk);
    const X = data.pubkeys.map(hx);
    assert.deepStrictEqual(individualPk(sk), X[0]);
    const secnonces = data.secnonces.map(hx);
    const pnonce = data.pnonces.map(hx);
    const aggnonces = data.aggnonces.map(hx);
    const msgs = data.msgs.map(hx);

    for (const tc of data.valid_test_cases) {
      const pubkeys = pick(X, tc.key_indices);
      const pubnonces = pick(pnonce, tc.nonce_indices);
      const aggnonce = aggnonces[tc.aggnonce_index];
      assert.deepStrictEqual(nonceAgg(pubnonces), aggnonce);
      const msg = msgs[tc.msg_index];
      const sessionCtx = sessionContext(aggnonce, pubkeys, [], [], msg);
      const secnonceTmp = Buffer.from(secnonces[0]);
      const psig = sign(secnonceTmp, sk, sessionCtx);
      assert.strictEqual(psig.toString('hex').toUpperCase(), tc.expected.toUpperCase());
      assert.ok(partialSigVerify(psig, pubnonces, pubkeys, [], [], msg, tc.signer_index));
      assert.ok(secnonceTmp.subarray(0, 64).equals(Buffer.alloc(64)));
    }

    for (const tc of data.sign_error_test_cases) {
      const pubkeys = pick(X, tc.key_indices);
      const aggnonce = aggnonces[tc.aggnonce_index];
      const msg = msgs[tc.msg_index];
      const sessionCtx = sessionContext(aggnonce, pubkeys, [], [], msg);
      const secnonce = Buffer.from(secnonces[tc.secnonce_index]);
      expectError(() => sign(secnonce, sk, sessionCtx), tc.error);
    }

    for (const tc of data.verify_fail_test_cases) {
      const pubkeys = pick(X, tc.key_indices);
      const pubnonces = pick(pnonce, tc.nonce_indices);
      const msg = msgs[tc.msg_index];
      assert.strictEqual(
        partialSigVerify(hx(tc.sig), pubnonces, pubkeys, [], [], msg, tc.signer_index),
        false
      );
    }

    for (const tc of data.verify_error_test_cases) {
      const pubkeys = pick(X, tc.key_indices);
      const pubnonces = pick(pnonce, tc.nonce_indices);
      const msg = msgs[tc.msg_index];
      expectError(() => {
        partialSigVerify(hx(tc.sig), pubnonces, pubkeys, [], [], msg, tc.signer_index);
      }, tc.error);
    }
  });

  it('matches tweak_vectors.json', function () {
    const data = load('tweak_vectors.json');
    const sk = hx(data.sk);
    const X = data.pubkeys.map(hx);
    const pnonce = data.pnonces.map(hx);
    const aggnonce = hx(data.aggnonce);
    const tweaks = data.tweaks.map(hx);
    const msg = hx(data.msg);
    const secnonce = hx(data.secnonce);

    for (const tc of data.valid_test_cases) {
      const pubkeys = pick(X, tc.key_indices);
      const pubnonces = pick(pnonce, tc.nonce_indices);
      const tw = pick(tweaks, tc.tweak_indices);
      const sessionCtx = sessionContext(aggnonce, pubkeys, tw, tc.is_xonly, msg);
      const secnonceTmp = Buffer.from(secnonce);
      const psig = sign(secnonceTmp, sk, sessionCtx);
      assert.strictEqual(psig.toString('hex').toUpperCase(), tc.expected.toUpperCase());
      assert.ok(partialSigVerify(psig, pubnonces, pubkeys, tw, tc.is_xonly, msg, tc.signer_index));
    }

    for (const tc of data.error_test_cases) {
      const pubkeys = pick(X, tc.key_indices);
      const tw = pick(tweaks, tc.tweak_indices);
      const sessionCtx = sessionContext(aggnonce, pubkeys, tw, tc.is_xonly, msg);
      expectError(() => sign(Buffer.from(secnonce), sk, sessionCtx), tc.error);
    }
  });

  it('matches det_sign_vectors.json', function () {
    const data = load('det_sign_vectors.json');
    const sk = hx(data.sk);
    const X = data.pubkeys.map(hx);
    const msgs = data.msgs.map(hx);
    for (const tc of data.valid_test_cases) {
      const pubkeys = pick(X, tc.key_indices);
      const tweaks = (tc.tweaks || []).map(hx);
      const msg = msgs[tc.msg_index];
      const rand = tc.rand != null ? hx(tc.rand) : null;
      const { pubnonce, psig } = deterministicSign(
        sk,
        hx(tc.aggothernonce),
        pubkeys,
        tweaks,
        tc.is_xonly,
        msg,
        rand
      );
      assert.strictEqual(pubnonce.toString('hex').toUpperCase(), tc.expected[0].toUpperCase());
      assert.strictEqual(psig.toString('hex').toUpperCase(), tc.expected[1].toUpperCase());
      const aggnonce = nonceAgg([hx(tc.aggothernonce), pubnonce]);
      const sessionCtx = sessionContext(aggnonce, pubkeys, tweaks, tc.is_xonly, msg);
      assert.ok(partialSigVerifyInternal(psig, pubnonce, pubkeys[tc.signer_index], sessionCtx));
    }
    for (const tc of data.error_test_cases) {
      const pubkeys = pick(X, tc.key_indices);
      const tweaks = (tc.tweaks || []).map(hx);
      const msg = msgs[tc.msg_index];
      const rand = tc.rand != null ? hx(tc.rand) : null;
      expectError(() => {
        deterministicSign(sk, hx(tc.aggothernonce), pubkeys, tweaks, tc.is_xonly, msg, rand);
      }, tc.error);
    }
  });

  it('matches sig_agg_vectors.json', function () {
    const data = load('sig_agg_vectors.json');
    const X = data.pubkeys.map(hx);
    const pnonce = data.pnonces.map(hx);
    const tweaks = data.tweaks.map(hx);
    const psigs = data.psigs.map(hx);
    const msg = hx(data.msg);
    for (const tc of data.valid_test_cases) {
      const pubkeys = pick(X, tc.key_indices);
      const pubnonces = pick(pnonce, tc.nonce_indices);
      const tw = pick(tweaks, tc.tweak_indices || []);
      const aggnonce = hx(tc.aggnonce);
      assert.deepStrictEqual(nonceAgg(pubnonces), aggnonce);
      const sessionCtx = sessionContext(aggnonce, pubkeys, tw, tc.is_xonly || [], msg);
      const sig = partialSigAgg(pick(psigs, tc.psig_indices), sessionCtx);
      assert.strictEqual(sig.toString('hex').toUpperCase(), tc.expected.toUpperCase());
    }
    for (const tc of data.error_test_cases || []) {
      const pubkeys = pick(X, tc.key_indices);
      const tw = pick(tweaks, tc.tweak_indices || []);
      const aggnonce = hx(tc.aggnonce);
      const sessionCtx = sessionContext(aggnonce, pubkeys, tw, tc.is_xonly || [], msg);
      expectError(() => partialSigAgg(pick(psigs, tc.psig_indices), sessionCtx), tc.error);
    }
  });

  it('rejects a caller-supplied aggregate that does not match keyAgg', function () {
    const data = load('key_agg_vectors.json');
    const keys = pick(data.pubkeys.map(hx), data.valid_test_cases[0].key_indices);
    const xonly = aggregateXonly(keys);
    assert.ok(!verifyAggregatedSchnorr(
      Buffer.alloc(32),
      Buffer.alloc(64),
      keys,
      Buffer.concat([Buffer.from([0x02]), Buffer.alloc(32, 1)])
    ));
    assert.ok(xonly.length === 32);
  });
});
