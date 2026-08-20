/**
 * BIP-327 MuSig2 (n-of-n Schnorr). Official vectors:
 * https://github.com/bitcoin/bips/tree/master/bip-0327/vectors
 *
 * MuSig2 is **n-of-n only**. t-of-n Bitcoin spends stay Taproot script-path
 * (`OP_CHECKSIGADD`). Off-chain Beacon / GroupChange stay independent BIP-340
 * signature counts. Interactive `P2P_MUSIG_*` mesh sessions live in
 * {@link module:functions/musig2Session} and are dispatched by {@link Peer}.
 *
 * @fileoverview BIP-327 MuSig2.
 * @module functions/musig2
 */
'use strict';

const crypto = require('crypto');
const { secp256k1, schnorr: schnorrModule } = require('@noble/curves/secp256k1.js');
const taggedHash = require('./taggedHash');
const { toUint8Flexible } = require('./bytes');

const SecpPoint = secp256k1.ProjectivePoint || secp256k1.Point;
const N = (secp256k1.CURVE && secp256k1.CURVE.n) ||
  (secp256k1.Point && secp256k1.Point.Fn && secp256k1.Point.Fn.ORDER);
const nobleSchnorr = schnorrModule && typeof schnorrModule.verify === 'function'
  ? schnorrModule
  : (schnorrModule && schnorrModule.schnorr) || schnorrModule;

/**
 * @param {Buffer|Uint8Array} bytes
 * @returns {object}
 * @private
 */
function fromBytes (bytes) {
  if (!SecpPoint) throw new Error('Unsupported noble secp256k1 Point API');
  const u8 = toUint8Flexible(bytes, 65);
  if (typeof SecpPoint.fromBytes === 'function') return SecpPoint.fromBytes(u8);
  if (typeof SecpPoint.fromHex === 'function') {
    return SecpPoint.fromHex(Buffer.from(u8).toString('hex'));
  }
  throw new Error('Unsupported noble secp256k1 Point API');
}

/**
 * @param {object} P
 * @param {boolean} [compressed]
 * @returns {Uint8Array}
 * @private
 */
function toRawBytesLocal (P, compressed = true) {
  if (!P) throw new Error('Missing point');
  if (typeof P.toRawBytes === 'function') return P.toRawBytes(compressed);
  if (typeof P.toBytes === 'function') {
    if (compressed) return P.toBytes();
    const affine = typeof P.toAffine === 'function' ? P.toAffine() : null;
    if (!affine || typeof affine.x !== 'bigint' || typeof affine.y !== 'bigint') {
      throw new Error('Point.toAffine() unavailable for uncompressed encoding');
    }
    const x = Buffer.from(affine.x.toString(16).padStart(64, '0'), 'hex');
    const y = Buffer.from(affine.y.toString(16).padStart(64, '0'), 'hex');
    return Buffer.concat([Buffer.from([0x04]), x, y]);
  }
  throw new Error('Unsupported point serialization');
}

/**
 * @param {object} P
 * @returns {number}
 * @private
 */
function getYParity (P) {
  const y = (P && typeof P.y === 'bigint')
    ? P.y
    : (P && typeof P.toAffine === 'function' ? P.toAffine().y : null);
  if (typeof y !== 'bigint') throw new Error('Unable to determine point y-parity');
  return (y & 1n) ? 1 : 0;
}

const ZERO33 = Buffer.alloc(33);

class InvalidContributionError extends Error {
  /**
   * @param {number|null} signer
   * @param {string} contrib pubkey | pubnonce | aggnonce | psig | aggothernonce
   */
  constructor (signer, contrib) {
    super(`Invalid MuSig2 contribution (${contrib})` +
      (signer == null ? '' : ` from signer ${signer}`));
    this.name = 'InvalidContributionError';
    this.signer = signer;
    this.contrib = contrib;
  }
}

class ValueError extends Error {
  constructor (message) {
    super(message);
    this.name = 'ValueError';
  }
}

/**
 * @param {number} threshold
 * @param {number} n
 * @returns {boolean}
 */
function musig2IsNOfN (threshold, n) {
  const t = Number(threshold);
  const count = Number(n);
  return Number.isInteger(t) && Number.isInteger(count) && count >= 2 && t === count;
}

/**
 * @param {Buffer|Uint8Array|string} input
 * @returns {Buffer}
 * @private
 */
function asBuf (input) {
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof Uint8Array) return Buffer.from(input);
  if (typeof input === 'string') {
    const hex = String(input).trim().replace(/^0x/i, '');
    if (hex.length % 2) throw new TypeError('odd hex length');
    if (!/^[0-9a-f]*$/i.test(hex)) throw new TypeError('expected hex');
    return Buffer.from(hex, 'hex');
  }
  throw new TypeError('expected Buffer, Uint8Array, or hex');
}

/**
 * @param {bigint} x
 * @returns {Buffer}
 * @private
 */
function bytesFromInt (x) {
  let hex = x.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  return Buffer.from(hex.padStart(64, '0'), 'hex');
}

/**
 * @param {Buffer} b
 * @returns {bigint}
 * @private
 */
function intFromBytes (b) {
  const hex = Buffer.from(b).toString('hex');
  if (!hex) return 0n;
  return BigInt('0x' + hex);
}

/**
 * @param {Buffer} a
 * @param {Buffer} b
 * @returns {Buffer}
 * @private
 */
function bytesXor (a, b) {
  const out = Buffer.alloc(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] ^ b[i];
  return out;
}

/**
 * @param {*} P
 * @returns {boolean}
 * @private
 */
function isInfinite (P) {
  if (!P) return true;
  if (SecpPoint && SecpPoint.ZERO && typeof P.equals === 'function') {
    return P.equals(SecpPoint.ZERO);
  }
  return false;
}

/**
 * @param {*} P
 * @returns {boolean}
 * @private
 */
function hasEvenY (P) {
  return getYParity(P) === 0;
}

/**
 * @param {*} P
 * @returns {Buffer} 32-byte x
 * @private
 */
function xbytes (P) {
  const c = Buffer.from(toRawBytesLocal(P, true));
  return c.subarray(1, 33);
}

/**
 * @param {*} P
 * @returns {Buffer} 33-byte compressed
 * @private
 */
function cbytes (P) {
  return Buffer.from(toRawBytesLocal(P, true));
}

/**
 * @param {*|null} P
 * @returns {Buffer}
 * @private
 */
function cbytesExt (P) {
  if (isInfinite(P)) return Buffer.from(ZERO33);
  return cbytes(P);
}

/**
 * @param {*|null} P
 * @returns {*|null}
 * @private
 */
function pointNegate (P) {
  if (isInfinite(P)) return P;
  if (typeof P.negate === 'function') return P.negate();
  return P.multiply(N - 1n);
}

/**
 * @param {*|null} P
 * @param {bigint} k
 * @returns {*|null}
 * @private
 */
function pointMul (P, k) {
  if (isInfinite(P)) return null;
  let s = k % N;
  if (s < 0n) s += N;
  if (s === 0n) return null;
  return P.multiply(s);
}

/**
 * @param {*|null} P1
 * @param {*|null} P2
 * @returns {*|null}
 * @private
 */
function pointAdd (P1, P2) {
  if (isInfinite(P1)) return isInfinite(P2) ? null : P2;
  if (isInfinite(P2)) return P1;
  const R = P1.add(P2);
  return isInfinite(R) ? null : R;
}

/**
 * @param {Buffer} x 33-byte compressed
 * @returns {*}
 * @private
 */
function cpoint (x) {
  const buf = asBuf(x);
  if (buf.length !== 33) {
    throw new ValueError('x is not a valid compressed point.');
  }
  if (buf[0] !== 0x02 && buf[0] !== 0x03) {
    throw new ValueError('x is not a valid compressed point.');
  }
  try {
    return fromBytes(buf);
  } catch {
    throw new ValueError('x is not a valid compressed point.');
  }
}

/**
 * @param {Buffer} x
 * @returns {*|null}
 * @private
 */
function cpointExt (x) {
  const buf = asBuf(x);
  if (buf.equals(ZERO33)) return null;
  return cpoint(buf);
}

/**
 * @param {Buffer} seckey
 * @returns {Buffer}
 */
function individualPk (seckey) {
  const d0 = intFromBytes(asBuf(seckey));
  if (!(d0 >= 1n && d0 <= N - 1n)) {
    throw new ValueError('The secret key must be an integer in the range 1..n-1.');
  }
  const P = SecpPoint.BASE.multiply(d0);
  return cbytes(P);
}

/**
 * Lexicographic sort of compressed encodings (BIP-327 KeySort). Does not
 * require valid curve points — the official vectors include an invalid key.
 *
 * @param {Array<Buffer|Uint8Array|string>} pubkeys
 * @returns {Array<Buffer>}
 */
function keySort (pubkeys) {
  if (!Array.isArray(pubkeys)) throw new TypeError('pubkeys must be an array');
  return pubkeys.map((pk) => Buffer.from(asBuf(pk))).sort(Buffer.compare);
}

/**
 * @param {Array<Buffer>} pubkeys
 * @returns {Buffer}
 * @private
 */
function hashKeys (pubkeys) {
  return taggedHash('KeyAgg list', Buffer.concat(pubkeys.map((pk) => asBuf(pk))));
}

/**
 * @param {Array<Buffer>} pubkeys
 * @returns {Buffer}
 * @private
 */
function getSecondKey (pubkeys) {
  const first = asBuf(pubkeys[0]);
  for (let j = 1; j < pubkeys.length; j++) {
    const pk = asBuf(pubkeys[j]);
    if (!pk.equals(first)) return pk;
  }
  return Buffer.alloc(33);
}

/**
 * @param {Array<Buffer>} pubkeys
 * @param {Buffer} pk_
 * @param {Buffer} pk2
 * @returns {bigint}
 * @private
 */
function keyAggCoeffInternal (pubkeys, pk_, pk2) {
  const L = hashKeys(pubkeys);
  const pk = asBuf(pk_);
  if (pk.equals(asBuf(pk2))) return 1n;
  return intFromBytes(taggedHash('KeyAgg coefficient', Buffer.concat([L, pk]))) % N;
}

/**
 * @param {Array<Buffer>} pubkeys
 * @param {Buffer} pk_
 * @returns {bigint}
 */
function keyAggCoeff (pubkeys, pk_) {
  return keyAggCoeffInternal(pubkeys, pk_, getSecondKey(pubkeys));
}

/**
 * @param {Array<Buffer|Uint8Array|string>} pubkeys
 * @returns {{ Q: object, gacc: bigint, tacc: bigint }}
 */
function keyAgg (pubkeys) {
  if (!Array.isArray(pubkeys) || !pubkeys.length) {
    throw new TypeError('keyAgg requires a non-empty pubkey list');
  }
  const keys = pubkeys.map((pk) => Buffer.from(asBuf(pk)));
  const pk2 = getSecondKey(keys);
  let Q = null;
  for (let i = 0; i < keys.length; i++) {
    let P;
    try {
      P = cpoint(keys[i]);
    } catch (err) {
      if (err instanceof ValueError) throw new InvalidContributionError(i, 'pubkey');
      throw err;
    }
    const a = keyAggCoeffInternal(keys, keys[i], pk2);
    Q = pointAdd(Q, pointMul(P, a));
  }
  if (isInfinite(Q)) {
    throw new Error('keyAgg: aggregate is infinity');
  }
  return { Q, gacc: 1n, tacc: 0n };
}

/**
 * @param {{ Q: object, gacc: bigint, tacc: bigint }} keyaggCtx
 * @returns {Buffer} 32-byte x-only
 */
function getXonlyPk (keyaggCtx) {
  return xbytes(keyaggCtx.Q);
}

/**
 * @param {{ Q: object, gacc: bigint, tacc: bigint }} keyaggCtx
 * @param {Buffer|string} tweak
 * @param {boolean} isXonly
 * @returns {{ Q: object, gacc: bigint, tacc: bigint }}
 */
function applyTweak (keyaggCtx, tweak, isXonly) {
  const tBuf = asBuf(tweak);
  if (tBuf.length !== 32) {
    throw new ValueError('The tweak must be a 32-byte array.');
  }
  const { Q, gacc, tacc } = keyaggCtx;
  const g = (isXonly && !hasEvenY(Q)) ? (N - 1n) : 1n;
  const t = intFromBytes(tBuf);
  if (t >= N) throw new ValueError('The tweak must be less than n.');
  const Gt = t === 0n ? null : SecpPoint.BASE.multiply(t);
  const Q_ = pointAdd(pointMul(Q, g), Gt);
  if (isInfinite(Q_)) {
    throw new ValueError('The result of tweaking cannot be infinity.');
  }
  return {
    Q: Q_,
    gacc: (g * gacc) % N,
    tacc: (t + g * tacc) % N
  };
}

/**
 * @param {Array<Buffer>} pubkeys
 * @param {Array<Buffer>} tweaks
 * @param {Array<boolean>} isXonly
 * @returns {{ Q: object, gacc: bigint, tacc: bigint }}
 */
function keyAggAndTweak (pubkeys, tweaks, isXonly) {
  const tw = tweaks || [];
  const xo = isXonly || [];
  if (tw.length !== xo.length) {
    throw new ValueError('The `tweaks` and `is_xonly` arrays must have the same length.');
  }
  let ctx = keyAgg(pubkeys);
  for (let i = 0; i < tw.length; i++) {
    ctx = applyTweak(ctx, tw[i], !!xo[i]);
  }
  return ctx;
}

/**
 * @param {Buffer} rand
 * @param {Buffer} pk
 * @param {Buffer} aggpk
 * @param {number} i
 * @param {Buffer} msgPrefixed
 * @param {Buffer} extraIn
 * @returns {bigint}
 * @private
 */
function nonceHash (rand, pk, aggpk, i, msgPrefixed, extraIn) {
  const buf = Buffer.concat([
    rand,
    Buffer.from([pk.length]),
    pk,
    Buffer.from([aggpk.length]),
    aggpk,
    msgPrefixed,
    Buffer.from([
      (extraIn.length >>> 24) & 0xff,
      (extraIn.length >>> 16) & 0xff,
      (extraIn.length >>> 8) & 0xff,
      extraIn.length & 0xff
    ]),
    extraIn,
    Buffer.from([i])
  ]);
  return intFromBytes(taggedHash('MuSig/nonce', buf));
}

/**
 * @param {Buffer} rand_
 * @param {Buffer|null} sk
 * @param {Buffer} pk
 * @param {Buffer|null} aggpk
 * @param {Buffer|null} msg
 * @param {Buffer|null} extraIn
 * @returns {{ secnonce: Buffer, pubnonce: Buffer }}
 */
function nonceGenInternal (rand_, sk, pk, aggpk, msg, extraIn) {
  const pkBuf = asBuf(pk);
  let rand = asBuf(rand_);
  if (sk != null) {
    rand = bytesXor(asBuf(sk), taggedHash('MuSig/aux', rand));
  }
  const agg = aggpk == null ? Buffer.alloc(0) : asBuf(aggpk);
  let msgPrefixed;
  if (msg == null) {
    msgPrefixed = Buffer.from([0x00]);
  } else {
    const m = asBuf(msg);
    const len = Buffer.alloc(8);
    len.writeBigUInt64BE(BigInt(m.length));
    msgPrefixed = Buffer.concat([Buffer.from([0x01]), len, m]);
  }
  const extra = extraIn == null ? Buffer.alloc(0) : asBuf(extraIn);
  const k1 = nonceHash(rand, pkBuf, agg, 0, msgPrefixed, extra) % N;
  const k2 = nonceHash(rand, pkBuf, agg, 1, msgPrefixed, extra) % N;
  if (k1 === 0n || k2 === 0n) throw new Error('nonceGen: zero nonce scalar');
  const Rs1 = SecpPoint.BASE.multiply(k1);
  const Rs2 = SecpPoint.BASE.multiply(k2);
  return {
    secnonce: Buffer.concat([bytesFromInt(k1), bytesFromInt(k2), pkBuf]),
    pubnonce: Buffer.concat([cbytes(Rs1), cbytes(Rs2)])
  };
}

/**
 * @param {Buffer|null} sk
 * @param {Buffer} pk
 * @param {Buffer|null} aggpk
 * @param {Buffer|null} msg
 * @param {Buffer|null} extraIn
 * @returns {{ secnonce: Buffer, pubnonce: Buffer }}
 */
function nonceGen (sk, pk, aggpk, msg, extraIn) {
  if (sk != null && asBuf(sk).length !== 32) {
    throw new ValueError('The optional byte array sk must have length 32.');
  }
  if (aggpk != null && asBuf(aggpk).length !== 32) {
    throw new ValueError('The optional byte array aggpk must have length 32.');
  }
  return nonceGenInternal(crypto.randomBytes(32), sk, pk, aggpk, msg, extraIn);
}

/**
 * @param {Array<Buffer|string>} pubnonces
 * @returns {Buffer} 66-byte aggnonce
 */
function nonceAgg (pubnonces) {
  if (!Array.isArray(pubnonces) || !pubnonces.length) {
    throw new TypeError('nonceAgg requires pubnonces');
  }
  const parts = [];
  for (let j = 0; j < 2; j++) {
    let Rj = null;
    for (let i = 0; i < pubnonces.length; i++) {
      const pn = asBuf(pubnonces[i]);
      let Rij;
      try {
        Rij = cpoint(pn.subarray(j * 33, (j + 1) * 33));
      } catch (err) {
        if (err instanceof ValueError) throw new InvalidContributionError(i, 'pubnonce');
        throw err;
      }
      Rj = pointAdd(Rj, Rij);
    }
    parts.push(cbytesExt(Rj));
  }
  return Buffer.concat(parts);
}

/**
 * @param {Buffer} aggnonce
 * @param {Array<Buffer>} pubkeys
 * @param {Array<Buffer>} tweaks
 * @param {Array<boolean>} isXonly
 * @param {Buffer} msg
 * @returns {object}
 */
function sessionContext (aggnonce, pubkeys, tweaks, isXonly, msg) {
  return {
    aggnonce: asBuf(aggnonce),
    pubkeys: pubkeys.map((pk) => Buffer.from(asBuf(pk))),
    tweaks: (tweaks || []).map((t) => Buffer.from(asBuf(t))),
    isXonly: (isXonly || []).map((v) => !!v),
    msg: asBuf(msg)
  };
}

/**
 * @param {object} sessionCtx
 * @returns {{ Q: object, gacc: bigint, tacc: bigint, b: bigint, R: object, e: bigint }}
 */
function getSessionValues (sessionCtx) {
  const { aggnonce, pubkeys, tweaks, isXonly, msg } = sessionCtx;
  const { Q, gacc, tacc } = keyAggAndTweak(pubkeys, tweaks, isXonly);
  const b = intFromBytes(taggedHash(
    'MuSig/noncecoef',
    Buffer.concat([aggnonce, xbytes(Q), msg])
  )) % N;
  let R1;
  let R2;
  try {
    R1 = cpointExt(aggnonce.subarray(0, 33));
    R2 = cpointExt(aggnonce.subarray(33, 66));
  } catch (err) {
    if (err instanceof ValueError) throw new InvalidContributionError(null, 'aggnonce');
    throw err;
  }
  let R_ = pointAdd(R1, pointMul(R2, b));
  const R = isInfinite(R_) ? SecpPoint.BASE : R_;
  const e = intFromBytes(taggedHash(
    'BIP0340/challenge',
    Buffer.concat([xbytes(R), xbytes(Q), msg])
  )) % N;
  return { Q, gacc, tacc, b, R, e };
}

/**
 * @param {object} sessionCtx
 * @param {*} P
 * @returns {bigint}
 * @private
 */
function getSessionKeyAggCoeff (sessionCtx, P) {
  const pk = cbytes(P);
  const found = sessionCtx.pubkeys.some((p) => asBuf(p).equals(pk));
  if (!found) {
    throw new ValueError('The signer\'s pubkey must be included in the list of pubkeys.');
  }
  return keyAggCoeff(sessionCtx.pubkeys, pk);
}

/**
 * Zero the secret nonce after use (BIP-327). Mutates `secnonce` in place.
 *
 * @param {Buffer} secnonce 97-byte (k1 || k2 || pk)
 * @param {Buffer} sk
 * @param {object} sessionCtx
 * @returns {Buffer} 32-byte partial signature
 */
function sign (secnonce, sk, sessionCtx) {
  const sn = asBuf(secnonce);
  const k1_ = intFromBytes(sn.subarray(0, 32));
  const k2_ = intFromBytes(sn.subarray(32, 64));
  const pkPart = Buffer.from(sn.subarray(64, 97));
  // BIP-327: never reuse a secret nonce, including after a later session-ctx throw.
  if (Buffer.isBuffer(secnonce)) secnonce.fill(0);
  else sn.fill(0);
  const { Q, gacc, b, R, e } = getSessionValues(sessionCtx);
  if (!(k1_ > 0n && k1_ < N)) {
    throw new ValueError('first secnonce value is out of range.');
  }
  if (!(k2_ > 0n && k2_ < N)) {
    throw new ValueError('second secnonce value is out of range.');
  }
  const k1 = hasEvenY(R) ? k1_ : (N - k1_);
  const k2 = hasEvenY(R) ? k2_ : (N - k2_);
  const d_ = intFromBytes(asBuf(sk));
  if (!(d_ > 0n && d_ < N)) {
    throw new ValueError('secret key value is out of range.');
  }
  const P = SecpPoint.BASE.multiply(d_);
  const pk = cbytes(P);
  if (!pk.equals(pkPart)) {
    throw new ValueError('Public key does not match nonce_gen argument');
  }
  const a = getSessionKeyAggCoeff(sessionCtx, P);
  const g = hasEvenY(Q) ? 1n : (N - 1n);
  const d = (g * gacc * d_) % N;
  const s = (k1 + b * k2 + e * a * d) % N;
  const psig = bytesFromInt(s);
  const Rs1 = SecpPoint.BASE.multiply(k1_);
  const Rs2 = SecpPoint.BASE.multiply(k2_);
  const pubnonce = Buffer.concat([cbytes(Rs1), cbytes(Rs2)]);
  if (!partialSigVerifyInternal(psig, pubnonce, pk, sessionCtx)) {
    throw new Error('sign: partial signature failed self-check');
  }
  return psig;
}

/**
 * @param {Buffer} psig
 * @param {Buffer} pubnonce
 * @param {Buffer} pk
 * @param {object} sessionCtx
 * @returns {boolean}
 */
function partialSigVerifyInternal (psig, pubnonce, pk, sessionCtx) {
  const { Q, gacc, b, R, e } = getSessionValues(sessionCtx);
  const s = intFromBytes(asBuf(psig));
  if (!(s > 0n && s < N)) return false;
  const pn = asBuf(pubnonce);
  const Rs1 = cpoint(pn.subarray(0, 33));
  const Rs2 = cpoint(pn.subarray(33, 66));
  const ReS_ = pointAdd(Rs1, pointMul(Rs2, b));
  const ReS = hasEvenY(R) ? ReS_ : pointNegate(ReS_);
  const P = cpoint(pk);
  const a = getSessionKeyAggCoeff(sessionCtx, P);
  const g = hasEvenY(Q) ? 1n : (N - 1n);
  const g_ = (g * gacc) % N;
  const lhs = SecpPoint.BASE.multiply(s);
  const rhs = pointAdd(ReS, pointMul(P, (e * a * g_) % N));
  if (isInfinite(rhs)) return false;
  return lhs.equals(rhs);
}

/**
 * @param {Buffer} psig
 * @param {Array<Buffer>} pubnonces
 * @param {Array<Buffer>} pubkeys
 * @param {Array<Buffer>} tweaks
 * @param {Array<boolean>} isXonly
 * @param {Buffer} msg
 * @param {number} i
 * @returns {boolean}
 */
function partialSigVerify (psig, pubnonces, pubkeys, tweaks, isXonly, msg, i) {
  if (pubnonces.length !== pubkeys.length) {
    throw new ValueError('The `pubnonces` and `pubkeys` arrays must have the same length.');
  }
  const aggnonce = nonceAgg(pubnonces);
  const sessionCtx = sessionContext(aggnonce, pubkeys, tweaks, isXonly, msg);
  return partialSigVerifyInternal(psig, pubnonces[i], pubkeys[i], sessionCtx);
}

/**
 * @param {Array<Buffer>} psigs
 * @param {object} sessionCtx
 * @returns {Buffer} 64-byte BIP-340 signature
 */
function partialSigAgg (psigs, sessionCtx) {
  const { Q, tacc, R, e } = getSessionValues(sessionCtx);
  let s = 0n;
  for (let i = 0; i < psigs.length; i++) {
    const si = intFromBytes(asBuf(psigs[i]));
    if (si >= N) throw new InvalidContributionError(i, 'psig');
    s = (s + si) % N;
  }
  const g = hasEvenY(Q) ? 1n : (N - 1n);
  s = (s + e * g * tacc) % N;
  return Buffer.concat([xbytes(R), bytesFromInt(s)]);
}

/**
 * @param {Buffer} sk_
 * @param {Buffer} aggothernonce
 * @param {Buffer} aggpk
 * @param {Buffer} msg
 * @param {number} i
 * @returns {bigint}
 * @private
 */
function detNonceHash (sk_, aggothernonce, aggpk, msg, i) {
  const len = Buffer.alloc(8);
  len.writeBigUInt64BE(BigInt(msg.length));
  const buf = Buffer.concat([
    sk_,
    aggothernonce,
    aggpk,
    len,
    msg,
    Buffer.from([i])
  ]);
  return intFromBytes(taggedHash('MuSig/deterministic/nonce', buf));
}

/**
 * @param {Buffer} sk
 * @param {Buffer} aggothernonce
 * @param {Array<Buffer>} pubkeys
 * @param {Array<Buffer>} tweaks
 * @param {Array<boolean>} isXonly
 * @param {Buffer} msg
 * @param {Buffer|null} rand
 * @returns {{ pubnonce: Buffer, psig: Buffer }}
 */
function deterministicSign (sk, aggothernonce, pubkeys, tweaks, isXonly, msg, rand) {
  const skBuf = asBuf(sk);
  const sk_ = rand != null
    ? bytesXor(skBuf, taggedHash('MuSig/aux', asBuf(rand)))
    : skBuf;
  const aggpk = getXonlyPk(keyAggAndTweak(pubkeys, tweaks, isXonly));
  const m = asBuf(msg);
  const other = asBuf(aggothernonce);
  const k1 = detNonceHash(sk_, other, aggpk, m, 0) % N;
  const k2 = detNonceHash(sk_, other, aggpk, m, 1) % N;
  if (k1 === 0n || k2 === 0n) throw new Error('deterministicSign: zero nonce');
  const Rs1 = SecpPoint.BASE.multiply(k1);
  const Rs2 = SecpPoint.BASE.multiply(k2);
  const pubnonce = Buffer.concat([cbytes(Rs1), cbytes(Rs2)]);
  const secnonce = Buffer.concat([bytesFromInt(k1), bytesFromInt(k2), individualPk(skBuf)]);
  let aggnonce;
  try {
    aggnonce = nonceAgg([pubnonce, other]);
  } catch (err) {
    if (err instanceof InvalidContributionError) {
      throw new InvalidContributionError(null, 'aggothernonce');
    }
    throw err;
  }
  const sessionCtx = sessionContext(aggnonce, pubkeys, tweaks, isXonly, m);
  const psig = sign(secnonce, skBuf, sessionCtx);
  return { pubnonce, psig };
}

/**
 * Convenience: x-only MuSig2 aggregate of compressed pubkeys (no tweaks).
 *
 * @param {Array<Buffer|string>} pubkeys
 * @returns {Buffer} 32-byte x-only
 */
function aggregateXonly (pubkeys, opts = {}) {
  const keys = opts.sort === false ? pubkeys : keySort(pubkeys);
  return getXonlyPk(keyAgg(keys));
}

/**
 * BIP-340 verify of an aggregated signature against keys we compute (never
 * trust a caller-supplied aggregate). `message` is hashed with SHA-256 unless
 * it is already 32 bytes.
 *
 * @param {Buffer|string} message
 * @param {Buffer|string} signature 64-byte Schnorr
 * @param {Array<Buffer|string>} pubkeys compressed participants
 * @param {Buffer|string} [claimedAggregate] compressed or x-only; must match
 * @returns {boolean}
 */
function verifyAggregatedSchnorr (message, signature, pubkeys, claimedAggregate) {
  if (!Array.isArray(pubkeys) || pubkeys.length < 1) return false;
  const xonly = aggregateXonly(pubkeys);
  if (claimedAggregate != null) {
    const claimed = asBuf(claimedAggregate);
    let claimedX;
    if (claimed.length === 32) claimedX = claimed;
    else if (claimed.length === 33) claimedX = claimed.subarray(1, 33);
    else return false;
    if (!claimedX.equals(xonly)) return false;
  }
  let msg = asBuf(message);
  if (msg.length !== 32) {
    msg = crypto.createHash('sha256').update(msg).digest();
  }
  const sig = asBuf(signature);
  if (sig.length !== 64) return false;
  try {
    return nobleSchnorr.verify(sig, msg, xonly);
  } catch {
    return false;
  }
}

module.exports = {
  InvalidContributionError,
  ValueError,
  musig2IsNOfN,
  individualPk,
  keySort,
  keyAgg,
  getXonlyPk,
  applyTweak,
  keyAggAndTweak,
  keyAggCoeff,
  nonceGen,
  nonceGenInternal,
  nonceAgg,
  sessionContext,
  getSessionValues,
  sign,
  partialSigVerify,
  partialSigVerifyInternal,
  partialSigAgg,
  deterministicSign,
  aggregateXonly,
  verifyAggregatedSchnorr
};
