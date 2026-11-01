'use strict';

/**
 * BIP-340 Schnorr adaptor signatures.
 *
 * A pre-signature on `message` under `publicKey` for the adaptor point
 * `T = t·G` is `R̂ ‖ s'` (65 bytes): the compressed final nonce `R̂ = k·G + T`
 * and `s' = k + e·d`, where `k` is negated when `R̂` has an odd y so that the
 * completed signature `(x(R̂), s' ± t)` is a valid BIP-340 signature. Anyone
 * holding the pre-signature and the completed signature learns `t`.
 *
 * Adapting and extracting follow secp256k1-zkp `musig_adapt` /
 * `musig_extract_adaptor` (t is negated when the final nonce has an odd y);
 * {@link module:types/witness/musig2Adaptor} uses the same arithmetic for
 * 64-byte MuSig2 pre-signatures plus their nonce parity.
 *
 * @module types/witness/adaptor
 */

const crypto = require('crypto');
const { secp256k1 } = require('@noble/curves/secp256k1.js');
const taggedHash = require('../hash256').tagged;

const Point = secp256k1.Point;
const N = Point.Fn.ORDER;
const G = Point.BASE;

const NONCE_TAG = 'FabricAdaptor/nonce';
const PRE_SIGNATURE_BYTES = 65;

function toBytes (value, name, length) {
  let buf;
  if (Buffer.isBuffer(value)) buf = value;
  else if (value instanceof Uint8Array) buf = Buffer.from(value);
  else if (typeof value === 'string' && /^[0-9a-fA-F]*$/.test(value) && value.length % 2 === 0) buf = Buffer.from(value, 'hex');
  else throw new TypeError(`${name} must be a Buffer, Uint8Array, or hex string`);
  if (length != null && buf.length !== length) throw new RangeError(`${name} must be ${length} bytes`);
  return buf;
}

function toInt (buf) {
  return buf.length ? BigInt('0x' + buf.toString('hex')) : 0n;
}

function scalarBytes (x) {
  return Buffer.from(x.toString(16).padStart(64, '0'), 'hex');
}

function mod (x) {
  const r = x % N;
  return r < 0n ? r + N : r;
}

function secretScalar (value, name) {
  const x = toInt(toBytes(value, name, 32));
  if (x <= 0n || x >= N) throw new RangeError(`${name} must be in 1..n-1`);
  return x;
}

function point (value, name) {
  const buf = toBytes(value, name, 33);
  if (buf[0] !== 0x02 && buf[0] !== 0x03) throw new RangeError(`${name} must be a compressed point`);
  return Point.fromBytes(buf);
}

function liftX (value, name) {
  const buf = toBytes(value, name);
  if (buf.length === 33) return liftX(buf.subarray(1), name);
  if (buf.length !== 32) throw new RangeError(`${name} must be 32 (x-only) or 33 bytes`);
  return Point.fromBytes(Buffer.concat([Buffer.from([0x02]), buf]));
}

function hasEvenY (P) {
  return (P.toAffine().y & 1n) === 0n;
}

function compressed (P) {
  return Buffer.from(P.toBytes(true));
}

function xOnly (P) {
  return compressed(P).subarray(1);
}

function mulPublic (P, k) {
  return k === 0n ? Point.ZERO : P.multiplyUnsafe(k);
}

function challenge (rx, px, message) {
  return mod(toInt(taggedHash('BIP0340/challenge', Buffer.concat([rx, px, message]))));
}

/**
 * Pre-sign `message` for the adaptor point `adaptor`.
 *
 * @param {Buffer|string} secretKey 32-byte secret key
 * @param {Buffer|string} message message (BIP-340 allows any length)
 * @param {Buffer|string} adaptor 33-byte compressed adaptor point T
 * @param {Object} [options]
 * @param {Buffer|string} [options.aux] 32 bytes of auxiliary randomness (default: fresh random)
 * @returns {Buffer} 65-byte pre-signature `R̂ ‖ s'`
 */
function preSign (secretKey, message, adaptor, options = {}) {
  const d0 = secretScalar(secretKey, 'secretKey');
  const msg = toBytes(message, 'message');
  const T = point(adaptor, 'adaptor');
  const P = G.multiply(d0);
  const d = hasEvenY(P) ? d0 : N - d0;
  const px = xOnly(P);
  const aux = options.aux != null ? toBytes(options.aux, 'aux', 32) : crypto.randomBytes(32);
  const masked = scalarBytes(d);
  const auxHash = taggedHash('BIP0340/aux', aux);
  for (let i = 0; i < 32; i++) masked[i] ^= auxHash[i];
  const k0 = mod(toInt(taggedHash(NONCE_TAG, Buffer.concat([masked, compressed(T), px, msg]))));
  masked.fill(0);
  if (k0 === 0n) throw new Error('adaptor nonce is zero');
  const Rhat = G.multiply(k0).add(T);
  if (Rhat.equals(Point.ZERO)) throw new Error('adaptor final nonce is infinite');
  const k = hasEvenY(Rhat) ? k0 : N - k0;
  const e = challenge(xOnly(Rhat), px, msg);
  const preSignature = Buffer.concat([compressed(Rhat), scalarBytes(mod(k + e * d))]);
  if (!preVerify(preSignature, msg, px, adaptor)) throw new Error('pre-signature failed self-check');
  return preSignature;
}

/**
 * Check that `preSignature` completes, with the secret of `adaptor`, to a valid
 * BIP-340 signature on `message` under `publicKey`.
 *
 * @param {Buffer|string} preSignature 65-byte `R̂ ‖ s'`
 * @param {Buffer|string} message
 * @param {Buffer|string} publicKey 32-byte x-only or 33-byte compressed
 * @param {Buffer|string} adaptor 33-byte compressed adaptor point T
 * @returns {boolean}
 */
function preVerify (preSignature, message, publicKey, adaptor) {
  try {
    const pre = toBytes(preSignature, 'preSignature', PRE_SIGNATURE_BYTES);
    const Rhat = point(pre.subarray(0, 33), 'preSignature nonce');
    const s = toInt(pre.subarray(33));
    if (s >= N) return false;
    const P = liftX(publicKey, 'publicKey');
    const T = point(adaptor, 'adaptor');
    const e = challenge(xOnly(Rhat), xOnly(P), toBytes(message, 'message'));
    let Rk = Rhat.subtract(T);
    if (Rk.equals(Point.ZERO)) return false;
    if (!hasEvenY(Rhat)) Rk = Rk.negate();
    return mulPublic(G, s).equals(Rk.add(mulPublic(P, e)));
  } catch {
    return false;
  }
}

/**
 * Complete a 64-byte pre-signature (`x(R̂) ‖ s'`) whose final nonce has `nonceParity`.
 *
 * @param {Buffer|string} preSignature 64 bytes
 * @param {Buffer|string} secret 32-byte adaptor secret t
 * @param {number} nonceParity 1 when the final nonce has an odd y
 * @returns {Buffer} 64-byte BIP-340 signature
 */
function adaptXonly (preSignature, secret, nonceParity) {
  const pre = toBytes(preSignature, 'preSignature', 64);
  if (nonceParity !== 0 && nonceParity !== 1) throw new RangeError('nonceParity must be 0 or 1');
  const s = toInt(pre.subarray(32));
  if (s >= N) throw new RangeError('pre-signature s is out of range');
  const t = secretScalar(secret, 'secret');
  return Buffer.concat([pre.subarray(0, 32), scalarBytes(mod(nonceParity ? s - t : s + t))]);
}

/**
 * Recover the adaptor secret from a completed signature and its 64-byte pre-signature.
 *
 * @param {Buffer|string} signature 64-byte BIP-340 signature
 * @param {Buffer|string} preSignature 64 bytes
 * @param {number} nonceParity
 * @param {Buffer|string} [adaptor] when given, the secret must match this point
 * @returns {Buffer} 32-byte secret t
 */
function extractXonly (signature, preSignature, nonceParity, adaptor) {
  const sig = toBytes(signature, 'signature', 64);
  const pre = toBytes(preSignature, 'preSignature', 64);
  if (nonceParity !== 0 && nonceParity !== 1) throw new RangeError('nonceParity must be 0 or 1');
  if (!sig.subarray(0, 32).equals(pre.subarray(0, 32))) throw new Error('signature and pre-signature nonces differ');
  const s = toInt(sig.subarray(32));
  const sPre = toInt(pre.subarray(32));
  if (s >= N || sPre >= N) throw new RangeError('signature s is out of range');
  const t = mod(nonceParity ? sPre - s : s - sPre);
  if (t === 0n) throw new Error('no adaptor secret in this signature');
  if (adaptor != null && !G.multiply(t).equals(point(adaptor, 'adaptor'))) {
    throw new Error('extracted secret does not match the adaptor point');
  }
  return scalarBytes(t);
}

function splitPreSignature (preSignature) {
  const pre = toBytes(preSignature, 'preSignature', PRE_SIGNATURE_BYTES);
  if (pre[0] !== 0x02 && pre[0] !== 0x03) throw new RangeError('preSignature nonce must be compressed');
  return { xonly: Buffer.concat([pre.subarray(1, 33), pre.subarray(33)]), nonceParity: pre[0] === 0x03 ? 1 : 0 };
}

/**
 * Complete a 65-byte pre-signature with the adaptor secret.
 *
 * @param {Buffer|string} preSignature 65-byte `R̂ ‖ s'`
 * @param {Buffer|string} secret 32-byte adaptor secret t
 * @returns {Buffer} 64-byte BIP-340 signature
 */
function adapt (preSignature, secret) {
  const { xonly, nonceParity } = splitPreSignature(preSignature);
  return adaptXonly(xonly, secret, nonceParity);
}

/**
 * Recover the adaptor secret from a completed signature and its 65-byte pre-signature.
 *
 * @param {Buffer|string} signature 64-byte BIP-340 signature
 * @param {Buffer|string} preSignature 65-byte `R̂ ‖ s'`
 * @param {Buffer|string} [adaptor] when given, the secret must match this point
 * @returns {Buffer} 32-byte secret t
 */
function extract (signature, preSignature, adaptor) {
  const { xonly, nonceParity } = splitPreSignature(preSignature);
  return extractXonly(signature, xonly, nonceParity, adaptor);
}

module.exports = {
  NONCE_TAG,
  PRE_SIGNATURE_BYTES,
  preSign,
  preVerify,
  adapt,
  extract,
  adaptXonly,
  extractXonly
};
