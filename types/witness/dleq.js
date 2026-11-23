'use strict';

/**
 * Chaum-Pedersen proof that two points share a discrete logarithm:
 * `P1 = x·G` and `P2 = x·H`. Byte-compatible with secp256k1-zkp's DLEQ
 * (the `ecdsa_adaptor` module, after the DLC specification): nonce
 * `k = H_DLEQ(x' ‖ H ‖ SHA256(P1 ‖ P2))` with `x'` masked by
 * `H_ECDSAadaptor/aux(aux)` when auxiliary randomness is given, challenge
 * `e = H_DLEQ(P1 ‖ H ‖ P2 ‖ k·G ‖ k·H)`, response `s = k + e·x`.
 *
 * @module types/witness/dleq
 */

const crypto = require('crypto');
const { secp256k1 } = require('@noble/curves/secp256k1.js');
const taggedHash = require('../hash256').tagged;

const Point = secp256k1.Point;
const N = Point.Fn.ORDER;
const G = Point.BASE;

const TAG = 'DLEQ';
const AUX_TAG = 'ECDSAadaptor/aux';
const PROOF_BYTES = 64;

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
  return BigInt('0x' + buf.toString('hex'));
}

function scalarBytes (x) {
  return Buffer.from(x.toString(16).padStart(64, '0'), 'hex');
}

function point (value, name) {
  const buf = toBytes(value, name, 33);
  if (buf[0] !== 0x02 && buf[0] !== 0x03) throw new RangeError(`${name} must be a compressed point`);
  return Point.fromBytes(buf);
}

function compressed (P) {
  return Buffer.from(P.toBytes(true));
}

function challenge (P1, H, P2, R1, R2) {
  return toInt(taggedHash(TAG, Buffer.concat([P1, H, P2, R1, R2].map(compressed)))) % N;
}

/**
 * Prove that `x·G` and `x·generator` share the secret `x`.
 *
 * @param {Buffer|string} secret 32-byte x
 * @param {Buffer|string} generator 33-byte compressed second base H
 * @param {Object} [options]
 * @param {Buffer|string|null} [options.aux] 32 bytes of auxiliary randomness
 *   (default: fresh random; `null`: none, deterministic)
 * @returns {{ p1: Buffer, p2: Buffer, e: Buffer, s: Buffer, proof: Buffer }} `proof` is `e ‖ s`
 */
function prove (secret, generator, options = {}) {
  const x32 = toBytes(secret, 'secret', 32);
  const x = toInt(x32);
  if (x <= 0n || x >= N) throw new RangeError('secret must be in 1..n-1');
  const H = point(generator, 'generator');
  const P1 = G.multiply(x);
  const P2 = H.multiply(x);
  const pointsHash = crypto.createHash('sha256').update(Buffer.concat([compressed(P1), compressed(P2)])).digest();
  const key = Buffer.from(x32);
  const aux = options.aux === undefined ? crypto.randomBytes(32) : options.aux;
  if (aux !== null) {
    const mask = taggedHash(AUX_TAG, toBytes(aux, 'aux', 32));
    for (let i = 0; i < 32; i++) key[i] ^= mask[i];
  }
  const k = toInt(taggedHash(TAG, Buffer.concat([key, compressed(H), pointsHash]))) % N;
  key.fill(0);
  if (k === 0n) throw new Error('DLEQ nonce is zero');
  const e = challenge(P1, H, P2, G.multiply(k), H.multiply(k));
  const s = (k + e * x) % N;
  const eBytes = scalarBytes(e);
  const sBytes = scalarBytes(s);
  return { p1: compressed(P1), p2: compressed(P2), e: eBytes, s: sBytes, proof: Buffer.concat([eBytes, sBytes]) };
}

/**
 * @param {Buffer|string} proof 64-byte `e ‖ s`
 * @param {Buffer|string} p1 33-byte x·G
 * @param {Buffer|string} generator 33-byte H
 * @param {Buffer|string} p2 33-byte x·H
 * @returns {boolean}
 */
function verify (proof, p1, generator, p2) {
  try {
    const bytes = toBytes(proof, 'proof', PROOF_BYTES);
    const e = toInt(bytes.subarray(0, 32));
    const s = toInt(bytes.subarray(32));
    if (e >= N || s >= N) return false;
    const P1 = point(p1, 'p1');
    const H = point(generator, 'generator');
    const P2 = point(p2, 'p2');
    const mul = (P, k) => (k === 0n ? Point.ZERO : P.multiplyUnsafe(k));
    const R1 = mul(G, s).subtract(mul(P1, e));
    const R2 = mul(H, s).subtract(mul(P2, e));
    if (R1.equals(Point.ZERO) || R2.equals(Point.ZERO)) return false;
    return challenge(P1, H, P2, R1, R2) === e;
  } catch {
    return false;
  }
}

module.exports = {
  TAG,
  AUX_TAG,
  PROOF_BYTES,
  prove,
  verify
};
