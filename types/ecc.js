'use strict';

// Shared noble-curves-based secp256k1 shim implementing the tiny-secp256k1-style interface
const { secp256k1, schnorr: schnorrModule } = require('@noble/curves/secp256k1.js');
const { toUint8Flexible } = require('../functions/bytes');
const SecpPoint = secp256k1.ProjectivePoint || secp256k1.Point;

// noble-curves v1 exposes secp256k1.CURVE.n; v2 exposes secp256k1.Point.Fn.ORDER
const CURVE_N = (secp256k1.CURVE && secp256k1.CURVE.n) ||
  (secp256k1.Point && secp256k1.Point.Fn && secp256k1.Point.Fn.ORDER);

function fromBytes (bytes) {
  if (!SecpPoint) throw new Error('Unsupported noble secp256k1 Point API');
  const u8 = toUint8Flexible(bytes, 65);
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
    } catch {
      return false;
    }
  },

  isPoint (p) {
    if (!p) return false;
    const bytes = Buffer.isBuffer(p) ? p : Buffer.from(p);
    try {
      if (secp256k1.utils && typeof secp256k1.utils.isValidPublicKey === 'function') {
        return secp256k1.utils.isValidPublicKey(toUint8Flexible(bytes, 65));
      }
      fromBytes(bytes);
      return true;
    } catch {
      return false;
    }
  },

  // bitcoinjs / bip32: scalar -> point
  pointFromScalar (d, compressed) {
    if (!d) return null;
    const bytes = Buffer.isBuffer(d) ? d : Buffer.from(d);
    try {
      const pub = secp256k1.getPublicKey(toUint8Flexible(bytes, 32), compressed);
      return Buffer.from(pub);
    } catch {
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
    } catch {
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
    } catch {
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
    } catch {
      try {
        fromBytes(Buffer.concat([Buffer.from([0x03]), xBytes]));
        return true;
      } catch {
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
    } catch {
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
    const sig = secp256k1.sign(toUint8Flexible(m, 32), toUint8Flexible(d, 32), { prehash: false });
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
      return secp256k1.verify(toUint8Flexible(s, 64), toUint8Flexible(m, 32), toUint8Flexible(p, 65), { prehash: false });
    } catch {
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
    return Buffer.from(schnorrModule.sign(toUint8Flexible(m, 32), toUint8Flexible(d, 32), toUint8Flexible(aux, 32)));
  },
  verifySchnorr (msgHash, xOnlyPubkey, sig) {
    const m = Buffer.isBuffer(msgHash) ? msgHash : Buffer.from(msgHash);
    const px = Buffer.isBuffer(xOnlyPubkey) ? xOnlyPubkey : Buffer.from(xOnlyPubkey);
    const s = Buffer.isBuffer(sig) ? sig : Buffer.from(sig);
    if (m.length !== 32 || px.length !== 32 || s.length !== 64) return false;
    try {
      return schnorrModule.verify(toUint8Flexible(s, 64), toUint8Flexible(m, 32), toUint8Flexible(px, 32));
    } catch {
      return false;
    }
  }
};

if (typeof window !== 'undefined') {
  // Skip under JSDOM (e.g. Sensemaker webpack bundler sets global.window); self-test is for real browsers.
  // Use window.navigator — Node may set global.window without a global `navigator`.
  const nav = typeof window.navigator !== 'undefined' ? window.navigator : null;
  const ua = nav && nav.userAgent ? nav.userAgent : '';
  const skipJsdom = /jsdom/i.test(ua);
  const globalScope = typeof globalThis !== 'undefined' ? globalThis : window;
  if (!skipJsdom && !globalScope.__FABRIC_ECC_SELFTESTED__) {
    globalScope.__FABRIC_ECC_SELFTESTED__ = true;
    try {
      require('./ecc.selftest')(ecc);
    } catch (e) {
      console.error('[fabric/ecc] self-test load failed:', e && e.message, e);
    }
  }
}

module.exports = ecc;
