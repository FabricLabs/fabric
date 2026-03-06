'use strict';

// Shared noble-curves-based secp256k1 shim implementing the tiny-secp256k1-style interface
const { secp256k1, schnorr: schnorrModule } = require('@noble/curves/secp256k1');
const SecpPoint = secp256k1.ProjectivePoint || secp256k1.Point;

// noble-curves v1 exposes secp256k1.CURVE.n; v2 exposes secp256k1.Point.Fn.ORDER
const CURVE_N = (secp256k1.CURVE && secp256k1.CURVE.n) ||
  (secp256k1.Point && secp256k1.Point.Fn && secp256k1.Point.Fn.ORDER);

// Ensure we always hand noble Uint8Array instances (not Buffer) in browser bundles.
function toU8 (bytes) {
  if (bytes instanceof Uint8Array) return bytes;
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer && Buffer.isBuffer(bytes)) {
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  return Uint8Array.from(bytes);
}

function fromBytes (bytes) {
  if (!SecpPoint) throw new Error('Unsupported noble secp256k1 Point API');
  const u8 = toU8(bytes);
  if (typeof SecpPoint.fromBytes === 'function') return SecpPoint.fromBytes(u8);
  if (typeof SecpPoint.fromHex === 'function') {
    const hex = Buffer.from(u8).toString('hex');
    return SecpPoint.fromHex(hex);
  }
  throw new Error('Unsupported noble secp256k1 Point API');
}

function toRawBytes (P, compressed = true) {
  if (!P) throw new Error('Missing point');
  if (typeof P.toRawBytes === 'function') return P.toRawBytes(compressed);
  if (typeof P.toBytes === 'function') {
    // noble-curves v2: toBytes() always returns compressed SEC1 (33 bytes).
    if (compressed) return P.toBytes();
    const affine = (typeof P.toAffine === 'function') ? P.toAffine() : null;
    if (!affine || typeof affine.x !== 'bigint' || typeof affine.y !== 'bigint') {
      throw new Error('Point.toAffine() unavailable for uncompressed encoding');
    }
    const x = Buffer.from(affine.x.toString(16).padStart(64, '0'), 'hex');
    const y = Buffer.from(affine.y.toString(16).padStart(64, '0'), 'hex');
    return Buffer.concat([Buffer.from([0x04]), x, y]);
  }
  throw new Error('Unsupported point serialization');
}

function getYParity (P) {
  // noble-curves v1: point has `.y` bigint; v2: use `toAffine().y`
  const y = (P && typeof P.y === 'bigint')
    ? P.y
    : (P && typeof P.toAffine === 'function' ? P.toAffine().y : null);
  if (typeof y !== 'bigint') throw new Error('Unable to determine point y-parity');
  return (y & 1n) ? 1 : 0;
}

const ecc = {
  isPrivate (d) {
    if (!d) return false;
    const bytes = Buffer.isBuffer(d) ? d : Buffer.from(d);
    if (bytes.length !== 32) return false;
    try {
      if (secp256k1.utils && typeof secp256k1.utils.isValidPrivateKey === 'function') {
        return secp256k1.utils.isValidPrivateKey(bytes);
      }
      if (secp256k1.utils && typeof secp256k1.utils.isValidSecretKey === 'function') {
        return secp256k1.utils.isValidSecretKey(bytes);
      }
      // Fallback: check scalar range (1..n-1)
      if (!CURVE_N) return false;
      const k = BigInt('0x' + bytes.toString('hex'));
      return k > 0n && k < CURVE_N;
    } catch (e) {
      return false;
    }
  },

  isPoint (p) {
    if (!p) return false;
    const bytes = Buffer.isBuffer(p) ? p : Buffer.from(p);
    try {
      if (secp256k1.utils && typeof secp256k1.utils.isValidPublicKey === 'function') {
        return secp256k1.utils.isValidPublicKey(toU8(bytes));
      }
      fromBytes(bytes);
      return true;
    } catch (e) {
      return false;
    }
  },

  // bitcoinjs / bip32: scalar -> point
  pointFromScalar (d, compressed) {
    if (!d) return null;
    const bytes = Buffer.isBuffer(d) ? d : Buffer.from(d);
    try {
      const pub = secp256k1.getPublicKey(toU8(bytes), compressed);
      return Buffer.from(pub);
    } catch (e) {
      return null;
    }
  },

  // ecpair: point + scalar tweak
  pointAddScalar (p, tweak, compressed) {
    if (!p || !tweak) return null;
    const pBytes = Buffer.isBuffer(p) ? p : Buffer.from(p);
    const tBytes = Buffer.isBuffer(tweak) ? tweak : Buffer.from(tweak);
    try {
      if (!SecpPoint) return null;
      if (!CURVE_N) return null;
      const P = fromBytes(pBytes);
      const k = BigInt('0x' + tBytes.toString('hex'));
      if (k === 0n || k >= CURVE_N) return null;
      const T = SecpPoint.BASE.multiply(k);
      const R = P.add(T);
      return Buffer.from(toRawBytes(R, compressed));
    } catch (e) {
      return null;
    }
  },

  // ecpair / bitcoinjs: point compression / decompression
  pointCompress (p, compressed) {
    if (!p) return null;
    const bytes = Buffer.isBuffer(p) ? p : Buffer.from(p);
    try {
      if (!SecpPoint) return null;
      const P = fromBytes(bytes);
      return Buffer.from(toRawBytes(P, compressed));
    } catch (e) {
      return null;
    }
  },

  // x-only point check for bitcoinjs ecc_lib.verifyEcc (accepts both even- and odd-Y encodings)
  isXOnlyPoint (x) {
    if (!x) return false;
    const xBytes = Buffer.isBuffer(x) ? x : Buffer.from(x);
    if (xBytes.length !== 32) return false;
    try {
      // Try even-Y (0x02) then odd-Y (0x03); if either is on-curve, x is valid
      if (!SecpPoint) return false;
      fromBytes(Buffer.concat([Buffer.from([0x02]), xBytes]));
      return true;
    } catch (e) {
      try {
        fromBytes(Buffer.concat([Buffer.from([0x03]), xBytes]));
        return true;
      } catch (e2) {
        return false;
      }
    }
  },

  // BIP341-style x-only tweak, used by both bitcoinjs and ecpair tests
  xOnlyPointAddTweak (xOnlyPubkey, tweak) {
    const xBytes = Buffer.isBuffer(xOnlyPubkey) ? xOnlyPubkey : Buffer.from(xOnlyPubkey);
    const tBytes = Buffer.isBuffer(tweak) ? tweak : Buffer.from(tweak);
    if (xBytes.length !== 32 || tBytes.length !== 32) return null;
    try {
      if (!SecpPoint) return null;
      if (!CURVE_N) return null;
      const P = fromBytes(Buffer.concat([Buffer.from([0x02]), xBytes]));
      const k = BigInt('0x' + tBytes.toString('hex'));
      if (k === 0n || k >= CURVE_N) return null;
      const T = SecpPoint.BASE.multiply(k);
      const R = P.add(T);
      if (R.equals(SecpPoint.ZERO)) return null;
      const Rx = Buffer.from(toRawBytes(R, true)).slice(1);
      const parity = getYParity(R);
      return { xOnlyPubkey: Rx, parity };
    } catch (e) {
      return null;
    }
  },

  // Scalar addition modulo n, as required by ecpair tests
  privateAdd (d, tweak) {
    if (!d || !tweak) return null;
    const dBytes = Buffer.isBuffer(d) ? d : Buffer.from(d);
    const tBytes = Buffer.isBuffer(tweak) ? tweak : Buffer.from(tweak);
    if (dBytes.length !== 32 || tBytes.length !== 32) return null;
    if (!CURVE_N) return null;
    const x = BigInt('0x' + dBytes.toString('hex'));
    const t = BigInt('0x' + tBytes.toString('hex'));
    const res = (x + t) % CURVE_N;
    if (res === 0n) return null;
    const hex = res.toString(16).padStart(64, '0');
    return Buffer.from(hex, 'hex');
  },

  // Scalar negation modulo n, as required by ecpair tests
  privateNegate (d) {
    if (!d) return null;
    const dBytes = Buffer.isBuffer(d) ? d : Buffer.from(d);
    if (dBytes.length !== 32) return null;
    if (!CURVE_N) return null;
    const x = BigInt('0x' + dBytes.toString('hex'));
    if (x === 0n || x >= CURVE_N) return null;
    const res = (CURVE_N - x) % CURVE_N;
    const hex = res.toString(16).padStart(64, '0');
    return Buffer.from(hex, 'hex');
  },

  // ECDSA sign / verify with 32-byte message hashes, compact 64-byte signatures
  sign (msg, priv) {
    const m = Buffer.isBuffer(msg) ? msg : Buffer.from(msg);
    const d = Buffer.isBuffer(priv) ? priv : Buffer.from(priv);
    if (m.length !== 32 || d.length !== 32) {
      throw new Error('sign expects 32-byte message hash and private key');
    }
    // noble-curves v2 prehashes (sha256) by default; for tiny-secp compatibility we sign raw 32-byte hashes.
    const sig = secp256k1.sign(toU8(m), toU8(d), { prehash: false });
    // noble-curves v1 returns Signature; v2 returns Uint8Array(64)
    if (sig && typeof sig.toCompactRawBytes === 'function') {
      return Buffer.from(sig.toCompactRawBytes());
    }
    return Buffer.from(sig);
  },

  verify (msg, pubkey, sig) {
    const m = Buffer.isBuffer(msg) ? msg : Buffer.from(msg);
    const p = Buffer.isBuffer(pubkey) ? pubkey : Buffer.from(pubkey);
    const s = Buffer.isBuffer(sig) ? sig : Buffer.from(sig);
    if (m.length !== 32) return false;
    try {
      // noble-curves v2 prehashes (sha256) by default; verify raw 32-byte hashes.
      return secp256k1.verify(toU8(s), toU8(m), toU8(p), { prehash: false });
    } catch (e) {
      return false;
    }
  },

  // BIP340 Schnorr (for Federation.verifyMultiSignature and ecpair testEcc)
  signSchnorr (msgHash, privKey, auxRand) {
    const m = Buffer.isBuffer(msgHash) ? msgHash : Buffer.from(msgHash);
    const d = Buffer.isBuffer(privKey) ? privKey : Buffer.from(privKey);
    if (m.length !== 32 || d.length !== 32) throw new Error('signSchnorr expects 32-byte message hash and private key');
    const aux = (auxRand != null && (Buffer.isBuffer(auxRand) || auxRand.length === 32))
      ? (Buffer.isBuffer(auxRand) ? auxRand : Buffer.from(auxRand))
      : Buffer.alloc(32);
    return Buffer.from(schnorrModule.sign(toU8(m), toU8(d), toU8(aux)));
  },
  verifySchnorr (msgHash, xOnlyPubkey, sig) {
    const m = Buffer.isBuffer(msgHash) ? msgHash : Buffer.from(msgHash);
    const px = Buffer.isBuffer(xOnlyPubkey) ? xOnlyPubkey : Buffer.from(xOnlyPubkey);
    const s = Buffer.isBuffer(sig) ? sig : Buffer.from(sig);
    if (m.length !== 32 || px.length !== 32 || s.length !== 64) return false;
    try {
      return schnorrModule.verify(toU8(s), toU8(m), toU8(px));
    } catch (e) {
      return false;
    }
  }
};

// Development-only self-test to mirror bip32/src/testecc.js and pinpoint failures in-browser.
// Runs only in environments with a window global (i.e. browser bundles).
function debugEccSelfTest () {
  const h = (hex) => Buffer.from(hex, 'hex');
  const checks = [];
  const check = (name, cond) => {
    const ok = !!cond;
    checks.push({ name, ok });
    if (!ok) console.error('[fabric/ecc] self-test FAILED:', name);
  };

  try {
    check('isPoint(valid G)', ecc.isPoint(h('0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798')));
    check('isPoint(invalid)', !ecc.isPoint(h('030000000000000000000000000000000000000000000000000000000000000005')));
    check('isPrivate(sample)', ecc.isPrivate(h('79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798')));
    check('isPrivate(order-1)', ecc.isPrivate(h('fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364140')));
    check('isPrivate(0)', !ecc.isPrivate(h('0000000000000000000000000000000000000000000000000000000000000000')));
    check('isPrivate(order)', !ecc.isPrivate(h('fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141')));
    check('isPrivate(order+1)', !ecc.isPrivate(h('fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364142')));

    const pFromScalar = ecc.pointFromScalar(
      h('b1121e4088a66a28f5b6b0f5844943ecd9f610196d7bb83b25214b60452c09af'),
      true
    );
    check(
      'pointFromScalar',
      pFromScalar &&
        Buffer.from(pFromScalar).equals(
          h('02b07ba9dca9523b7ef4bd97703d43d20399eb698e194704791a25ce77a400df99')
        )
    );

    if (ecc.xOnlyPointAddTweak) {
      check(
        'xOnlyPointAddTweak(null result)',
        ecc.xOnlyPointAddTweak(
          h('79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'),
          h('fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364140')
        ) === null
      );

      let xOnlyRes = ecc.xOnlyPointAddTweak(
        h('1617d38ed8d8657da4d4761e8057bc396ea9e4b9d29776d4be096016dbd2509b'),
        h('a8397a935f0dfceba6ba9618f6451ef4d80637abf4e6af2669fbc9de6a8fd2ac')
      );
      check(
        'xOnlyPointAddTweak(vector1)',
        xOnlyRes &&
          Buffer.from(xOnlyRes.xOnlyPubkey).equals(
            h('e478f99dab91052ab39a33ea35fd5e6e4933f4d28023cd597c9a1f6760346adf')
          ) &&
          xOnlyRes.parity === 1
      );

      xOnlyRes = ecc.xOnlyPointAddTweak(
        h('2c0b7cf95324a07d05398b240174dc0c2be444d96b159aa6c7f7b1e668680991'),
        h('823c3cd2142744b075a87eade7e1b8678ba308d566226a0056ca2b7a76f86b47')
      );
      // No explicit assertion in bip32's testEcc for this one; just ensure it doesn't throw/return null.
      check('xOnlyPointAddTweak(vector2 non-null)', xOnlyRes !== null);
    }

    const added = ecc.pointAddScalar(
      h('0379be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'),
      h('0000000000000000000000000000000000000000000000000000000000000003'),
      true
    );
    check(
      'pointAddScalar',
      added &&
        Buffer.from(added).equals(
          h('02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5')
        )
    );

    const privAdded = ecc.privateAdd(
      h('fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd036413e'),
      h('0000000000000000000000000000000000000000000000000000000000000002')
    );
    check(
      'privateAdd',
      privAdded &&
        Buffer.from(privAdded).equals(
          h('fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364140')
        )
    );

    if (ecc.privateNegate) {
      check(
        'privateNegate(1)',
        Buffer.from(
          ecc.privateNegate(
            h('0000000000000000000000000000000000000000000000000000000000000001')
          )
        ).equals(
          h('fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364140')
        )
      );
      check(
        'privateNegate(order-2)',
        Buffer.from(
          ecc.privateNegate(
            h('fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd036413e')
          )
        ).equals(
          h('0000000000000000000000000000000000000000000000000000000000000003')
        )
      );
      check(
        'privateNegate(sample)',
        Buffer.from(
          ecc.privateNegate(
            h('b1121e4088a66a28f5b6b0f5844943ecd9f610196d7bb83b25214b60452c09af')
          )
        ).equals(
          h('4eede1bf775995d70a494f0a7bb6bc11e0b8cccd41cce8009ab1132c8b0a3792')
        )
      );
    }

    const sig = ecc.sign(
      h('5e9f0a0d593efdcf78ac923bc3313e4e7d408d574354ee2b3288c0da9fbba6ed'),
      h('fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364140')
    );
    check(
      'sign',
      Buffer.from(sig).equals(
        h('54c4a33c6423d689378f160a7ff8b61330444abb58fb470f96ea16d99d4a2fed07082304410efa6b2943111b6a4e0aaa7b7db55a07e9861d1fb3cb1f421044a5')
      )
    );
    check(
      'verify',
      ecc.verify(
        h('5e9f0a0d593efdcf78ac923bc3313e4e7d408d574354ee2b3288c0da9fbba6ed'),
        h('0379be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'),
        sig
      )
    );

    if (ecc.signSchnorr) {
      const schnorrSig = ecc.signSchnorr(
        h('7e2d58d8b3bcdf1abadec7829054f90dda9805aab56c77333024b9d0a508b75c'),
        h('c90fdaa22168c234c4c6628b80dc1cd129024e088a67cc74020bbea63b14e5c9'),
        h('c87aa53824b4d7ae2eb035a2b5bbbccc080e76cdc6d1692c4b0b62d798e6d906')
      );
      check(
        'signSchnorr',
        Buffer.from(schnorrSig).equals(
          h('5831aaeed7b44bb74e5eab94ba9d4294c49bcf2a60728d8b4c200f50dd313c1bab745879a5ad954a72c45a91c3a51d3c7adea98d82f8481e0e1e03674a6f3fb7')
        )
      );
      check(
        'verifySchnorr',
        ecc.verifySchnorr(
          h('7e2d58d8b3bcdf1abadec7829054f90dda9805aab56c77333024b9d0a508b75c'),
          h('dd308afec5777e13121fa72b9cc1b7cc0139715309b086c960e18fd969774eb8'),
          schnorrSig
        )
      );
    }

    console.log('[fabric/ecc] self-test results:', checks);
  } catch (e) {
    console.error('[fabric/ecc] self-test threw:', e && e.message, e);
  }
}

if (typeof window !== 'undefined') {
  // Avoid running multiple times if the module is re-evaluated.
  const globalScope = typeof globalThis !== 'undefined' ? globalThis : window;
  if (!globalScope.__FABRIC_ECC_SELFTESTED__) {
    globalScope.__FABRIC_ECC_SELFTESTED__ = true;
    debugEccSelfTest();
  }
}

module.exports = ecc;
