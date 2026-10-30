'use strict';

const assert = require('assert');
const crypto = require('crypto');
const { secp256k1, schnorr } = require('@noble/curves/secp256k1.js');

const Witness = require('../types/witness');
const VECTORS = require('./vectors/zkp-adaptor.json');

const { Adaptor, DLEQ, MuSig2 } = Witness;
const N = secp256k1.Point.Fn.ORDER;
const h = (hex) => Buffer.from(hex, 'hex');

function secret () {
  for (;;) {
    const sk = crypto.randomBytes(32);
    const x = BigInt('0x' + sk.toString('hex'));
    if (x > 0n && x < N) return sk;
  }
}

function adaptorPair () {
  const t = secret();
  return { t, T: Buffer.from(secp256k1.getPublicKey(t, true)) };
}

function addScalar (buf32, delta) {
  const x = (BigInt('0x' + buf32.toString('hex')) + delta) % N;
  return Buffer.from(x.toString(16).padStart(64, '0'), 'hex');
}

function verifies (sig, msg, pubkey) {
  try {
    return schnorr.verify(sig, msg, pubkey);
  } catch {
    return false;
  }
}

describe('@fabric/core/types/witness signatures', function () {
  it('carries MuSig2, its Session and Adaptor, BLS, Adaptor, and DLEQ', function () {
    assert.strictEqual(Witness.MuSig2.keyAgg, require('../functions/musig2').keyAgg);
    assert.strictEqual(Witness.MuSig2.Session, require('../functions/musig2Session'));
    assert.strictEqual(Witness.MuSig2.Adaptor, require('../types/witness/musig2Adaptor'));
    assert.strictEqual(Witness.BLS, require('../functions/bls'));
    assert.strictEqual(typeof Adaptor.preSign, 'function');
    assert.strictEqual(typeof DLEQ.prove, 'function');
    assert.ok(Object.isFrozen(Witness.MuSig2));
  });
});

describe('Witness.MuSig2.Adaptor against secp256k1-zkp', function () {
  const A = MuSig2.Adaptor;

  it('covers both nonce parities, tweaked keys, and three signers', function () {
    const parities = new Set(VECTORS.musig_adaptor.map((v) => v.nonce_parity));
    assert.deepStrictEqual([...parities].sort(), [0, 1]);
    assert.ok(VECTORS.musig_adaptor.some((v) => v.tweaked));
    assert.ok(VECTORS.musig_adaptor.some((v) => v.pubkeys.length === 3));
  });

  VECTORS.musig_adaptor.forEach((v, index) => {
    it(`reproduces vector ${index} (${v.pubkeys.length} signers, ${v.tweaked ? 'tweaked' : 'untweaked'}, parity ${v.nonce_parity})`, function () {
      const pubkeys = v.pubkeys.map(h);
      const tweaks = v.tweaked ? [h(v.tweak)] : [];
      const isXonly = v.tweaked ? [true] : [];
      const msg = h(v.msg);
      const aggpk = MuSig2.getXonlyPk(MuSig2.keyAggAndTweak(pubkeys, tweaks, isXonly));
      assert.strictEqual(aggpk.toString('hex'), v.aggpk);

      const nonces = v.seckeys.map((sk, i) => MuSig2.nonceGenInternal(h(v.rands[i]), h(sk), pubkeys[i], aggpk, msg, null));
      assert.deepStrictEqual(nonces.map((n) => n.pubnonce.toString('hex')), v.pubnonces);
      const aggnonce = MuSig2.nonceAgg(nonces.map((n) => n.pubnonce));
      assert.strictEqual(aggnonce.toString('hex'), v.aggnonce);

      const ctx = A.sessionContext(aggnonce, pubkeys, tweaks, isXonly, msg, h(v.adaptor));
      const psigs = nonces.map((n, i) => MuSig2.sign(n.secnonce, h(v.seckeys[i]), ctx));
      assert.deepStrictEqual(psigs.map((p) => p.toString('hex')), v.psigs);
      psigs.forEach((psig, i) => {
        assert.ok(A.partialSigVerify(psig, nonces.map((n) => n.pubnonce), pubkeys, tweaks, isXonly, msg, i, h(v.adaptor)));
        assert.ok(!MuSig2.partialSigVerify(psig, nonces.map((n) => n.pubnonce), pubkeys, tweaks, isXonly, msg, i));
      });

      const pre = A.preSignatureAgg(psigs, ctx);
      assert.strictEqual(pre.toString('hex'), v.pre_sig);
      assert.strictEqual(A.nonceParity(ctx), v.nonce_parity);
      assert.ok(A.preVerify(pre, ctx));
      assert.ok(!verifies(pre, msg, aggpk));

      const sig = A.adapt(pre, h(v.adaptor_secret), v.nonce_parity);
      assert.strictEqual(sig.toString('hex'), v.sig);
      assert.ok(verifies(sig, msg, aggpk));
      assert.strictEqual(A.extract(sig, pre, v.nonce_parity, h(v.adaptor)).toString('hex'), v.adaptor_secret);
    });
  });

  it('shares its adapt and extract arithmetic with the 65-byte single-signer form', function () {
    for (const v of VECTORS.musig_adaptor) {
      const pre65 = Buffer.concat([Buffer.from([v.nonce_parity ? 0x03 : 0x02]), h(v.pre_sig)]);
      assert.strictEqual(Adaptor.adapt(pre65, h(v.adaptor_secret)).toString('hex'), v.sig);
      assert.strictEqual(Adaptor.extract(h(v.sig), pre65, h(v.adaptor)).toString('hex'), v.adaptor_secret);
    }
  });

  it('extracts the wrong secret with the wrong parity, and refuses it against the adaptor point', function () {
    const v = VECTORS.musig_adaptor[0];
    const wrong = A.extract(h(v.sig), h(v.pre_sig), 1 - v.nonce_parity);
    assert.notStrictEqual(wrong.toString('hex'), v.adaptor_secret);
    assert.throws(() => A.extract(h(v.sig), h(v.pre_sig), 1 - v.nonce_parity, h(v.adaptor)), /does not match/);
  });

  it('refuses tampered pre-signatures and a session for another adaptor', function () {
    const v = VECTORS.musig_adaptor[1];
    const pubkeys = v.pubkeys.map(h);
    const tweaks = v.tweaked ? [h(v.tweak)] : [];
    const isXonly = v.tweaked ? [true] : [];
    const ctx = A.sessionContext(h(v.aggnonce), pubkeys, tweaks, isXonly, h(v.msg), h(v.adaptor));
    const pre = h(v.pre_sig);
    assert.ok(A.preVerify(pre, ctx));
    assert.ok(!A.preVerify(Buffer.concat([pre.subarray(0, 32), addScalar(pre.subarray(32), 1n)]), ctx));
    const other = A.sessionContext(h(v.aggnonce), pubkeys, tweaks, isXonly, h(v.msg), adaptorPair().T);
    assert.ok(!A.preVerify(pre, other));
    assert.throws(() => A.sessionContext(h(v.aggnonce), pubkeys, tweaks, isXonly, h(v.msg)), /adaptor point is required/);
  });

  it('lets the last signer sign statelessly into an adaptor session', function () {
    const sks = [secret(), secret()];
    const pubkeys = sks.map((sk) => MuSig2.individualPk(sk));
    const msg = crypto.randomBytes(32);
    const { t, T } = adaptorPair();
    const aggpk = MuSig2.getXonlyPk(MuSig2.keyAgg(pubkeys));
    const first = MuSig2.nonceGen(sks[0], pubkeys[0], aggpk, msg, null);
    const last = A.deterministicSign(sks[1], first.pubnonce, pubkeys, [], [], msg, null, T);
    const pubnonces = [first.pubnonce, last.pubnonce];
    assert.ok(A.partialSigVerify(last.psig, pubnonces, pubkeys, [], [], msg, 1, T));
    const ctx = A.sessionContext(MuSig2.nonceAgg(pubnonces), pubkeys, [], [], msg, T);
    const pre = A.preSignatureAgg([MuSig2.sign(first.secnonce, sks[0], ctx), last.psig], ctx);
    assert.ok(A.preVerify(pre, ctx));
    const sig = A.adapt(pre, t, A.nonceParity(ctx));
    assert.ok(verifies(sig, msg, aggpk));
    assert.ok(A.extract(sig, pre, A.nonceParity(ctx), T).equals(t));
  });

  it('gives the last signer a fresh nonce for every adaptor', function () {
    const sks = [secret(), secret()];
    const pubkeys = sks.map((sk) => MuSig2.individualPk(sk));
    const msg = crypto.randomBytes(32);
    const aggpk = MuSig2.getXonlyPk(MuSig2.keyAgg(pubkeys));
    const first = MuSig2.nonceGen(sks[0], pubkeys[0], aggpk, msg, null);
    const a = A.deterministicSign(sks[1], first.pubnonce, pubkeys, [], [], msg, null, adaptorPair().T);
    const b = A.deterministicSign(sks[1], first.pubnonce, pubkeys, [], [], msg, null, adaptorPair().T);
    const plain = MuSig2.deterministicSign(sks[1], first.pubnonce, pubkeys, [], [], msg, null);
    assert.ok(!a.pubnonce.equals(b.pubnonce));
    assert.ok(!a.pubnonce.equals(plain.pubnonce));
  });
});

describe('Witness.Adaptor (BIP-340)', function () {
  function fixture () {
    const sk = secret();
    const pubkey = Buffer.from(schnorr.getPublicKey(sk));
    const msg = crypto.randomBytes(32);
    return Object.assign({ sk, pubkey, msg }, adaptorPair());
  }

  it('pre-signs, pre-verifies, and adapts to a valid signature for either nonce parity', function () {
    const parities = new Set();
    for (let i = 0; i < 24; i++) {
      const { sk, pubkey, msg, t, T } = fixture();
      const pre = Adaptor.preSign(sk, msg, T);
      assert.strictEqual(pre.length, Adaptor.PRE_SIGNATURE_BYTES);
      parities.add(pre[0]);
      assert.ok(Adaptor.preVerify(pre, msg, pubkey, T));
      assert.ok(!verifies(pre.subarray(1), msg, pubkey));
      const sig = Adaptor.adapt(pre, t);
      assert.ok(verifies(sig, msg, pubkey));
      assert.ok(sig.subarray(0, 32).equals(pre.subarray(1, 33)));
    }
    assert.deepStrictEqual([...parities].sort(), [0x02, 0x03]);
  });

  it('pre-verify soundness: anything that pre-verifies completes with the adaptor secret, and tampering fails', function () {
    const { sk, pubkey, msg, T } = fixture();
    const pre = Adaptor.preSign(sk, msg, T);
    const flippedParity = Buffer.from(pre);
    flippedParity[0] ^= 0x01;
    const bumped = Buffer.concat([pre.subarray(0, 33), addScalar(pre.subarray(33), 1n)]);
    assert.ok(!Adaptor.preVerify(flippedParity, msg, pubkey, T));
    assert.ok(!Adaptor.preVerify(bumped, msg, pubkey, T));
    assert.ok(!Adaptor.preVerify(pre, crypto.randomBytes(32), pubkey, T));
    assert.ok(!Adaptor.preVerify(pre, msg, Buffer.from(schnorr.getPublicKey(secret())), T));
    assert.ok(!Adaptor.preVerify(pre, msg, pubkey, adaptorPair().T));
    assert.ok(!Adaptor.preVerify(pre.subarray(1), msg, pubkey, T));
    assert.ok(!Adaptor.preVerify(Buffer.concat([pre.subarray(0, 33), Buffer.alloc(32, 0xff)]), msg, pubkey, T));
  });

  it('extractability: the completed signature and the pre-signature yield the adaptor secret of T', function () {
    for (let i = 0; i < 8; i++) {
      const { sk, msg, t, T } = fixture();
      const pre = Adaptor.preSign(sk, msg, T);
      const sig = Adaptor.adapt(pre, t);
      assert.ok(Adaptor.extract(sig, pre, T).equals(t));
      assert.ok(Adaptor.extract(sig, pre).equals(t));
    }
  });

  it('unique extractability: no other signature on that nonce verifies, and other signatures yield nothing', function () {
    const { sk, pubkey, msg, t, T } = fixture();
    const pre = Adaptor.preSign(sk, msg, T);
    const sig = Adaptor.adapt(pre, t);
    const other = Buffer.concat([sig.subarray(0, 32), addScalar(sig.subarray(32), 1n)]);
    assert.ok(!verifies(other, msg, pubkey));
    assert.throws(() => Adaptor.extract(other, pre, T), /does not match/);
    const fresh = Buffer.from(schnorr.sign(msg, sk, crypto.randomBytes(32)));
    assert.throws(() => Adaptor.extract(fresh, pre, T), /nonces differ/);
  });

  it('adapting with any secret but the adaptor secret gives an invalid signature', function () {
    const { sk, pubkey, msg, T } = fixture();
    const pre = Adaptor.preSign(sk, msg, T);
    assert.ok(!verifies(Adaptor.adapt(pre, secret()), msg, pubkey));
  });

  it('binds the nonce to the adaptor point and is deterministic only with fixed aux', function () {
    const { sk, msg, T } = fixture();
    const aux = crypto.randomBytes(32);
    const a = Adaptor.preSign(sk, msg, T, { aux });
    assert.ok(a.equals(Adaptor.preSign(sk, msg, T, { aux })));
    assert.ok(!a.equals(Adaptor.preSign(sk, msg, T)));
    const T2 = adaptorPair().T;
    const b = Adaptor.preSign(sk, msg, T2, { aux });
    const nonce = (pre, adaptor) => {
      const R = secp256k1.Point.fromBytes(pre.subarray(0, 33)).subtract(secp256k1.Point.fromBytes(adaptor));
      return Buffer.from(R.toBytes(true)).subarray(1).toString('hex');
    };
    assert.notStrictEqual(nonce(a, T), nonce(b, T2));
  });

  it('accepts x-only and compressed public keys and refuses bad inputs', function () {
    const { sk, pubkey, msg, T } = fixture();
    const pre = Adaptor.preSign(sk, msg, T);
    assert.ok(Adaptor.preVerify(pre, msg, Buffer.from(secp256k1.getPublicKey(sk, true)), T));
    assert.ok(Adaptor.preVerify(pre, msg, pubkey, T));
    assert.throws(() => Adaptor.preSign(Buffer.alloc(32), msg, T), /1\.\.n-1/);
    assert.throws(() => Adaptor.preSign(sk, msg, T.subarray(1)), /33 bytes/);
    assert.throws(() => Adaptor.adapt(pre, Buffer.alloc(32)), /1\.\.n-1/);
    assert.throws(() => Adaptor.adapt(pre.subarray(1), secret()), /65 bytes/);
    assert.throws(() => Adaptor.extract(Adaptor.adapt(pre, secret()), Buffer.concat([Buffer.from([0x04]), pre.subarray(1)])), /compressed/);
  });
});

describe('Witness.DLEQ', function () {
  VECTORS.dleq.forEach((d, index) => {
    it(`reproduces secp256k1-zkp proof ${index} (${d.aux ? 'with' : 'without'} aux)`, function () {
      const proof = DLEQ.prove(h(d.secret), h(d.generator), { aux: d.aux ? h(d.aux) : null });
      assert.strictEqual(proof.p1.toString('hex'), d.p1);
      assert.strictEqual(proof.p2.toString('hex'), d.p2);
      assert.strictEqual(proof.e.toString('hex'), d.e);
      assert.strictEqual(proof.s.toString('hex'), d.s);
      assert.ok(DLEQ.verify(proof.proof, h(d.p1), h(d.generator), h(d.p2)));
    });
  });

  it('refuses tampered proofs and mismatched statements', function () {
    const d = VECTORS.dleq[0];
    const proof = Buffer.concat([h(d.e), h(d.s)]);
    const bumpS = Buffer.concat([h(d.e), addScalar(h(d.s), 1n)]);
    const bumpE = Buffer.concat([addScalar(h(d.e), 1n), h(d.s)]);
    const other = Buffer.from(secp256k1.getPublicKey(secret(), true));
    assert.ok(!DLEQ.verify(bumpS, h(d.p1), h(d.generator), h(d.p2)));
    assert.ok(!DLEQ.verify(bumpE, h(d.p1), h(d.generator), h(d.p2)));
    assert.ok(!DLEQ.verify(proof, h(d.p2), h(d.generator), h(d.p1)));
    assert.ok(!DLEQ.verify(proof, other, h(d.generator), h(d.p2)));
    assert.ok(!DLEQ.verify(proof, h(d.p1), other, h(d.p2)));
    assert.ok(!DLEQ.verify(proof, h(d.p1), h(d.generator), other));
    assert.ok(!DLEQ.verify(proof.subarray(1), h(d.p1), h(d.generator), h(d.p2)));
  });

  it('proves with fresh randomness by default', function () {
    const x = secret();
    const H = Buffer.from(secp256k1.getPublicKey(secret(), true));
    const a = DLEQ.prove(x, H);
    const b = DLEQ.prove(x, H);
    assert.ok(!a.proof.equals(b.proof));
    assert.ok(DLEQ.verify(a.proof, a.p1, H, a.p2));
    assert.ok(DLEQ.verify(b.proof, b.p1, H, b.p2));
  });

  it('cannot prove equality for points with different logarithms', function () {
    const H = Buffer.from(secp256k1.getPublicKey(secret(), true));
    const proof = DLEQ.prove(secret(), H);
    const unrelated = DLEQ.prove(secret(), H);
    assert.ok(!DLEQ.verify(proof.proof, proof.p1, H, unrelated.p2));
  });
});
