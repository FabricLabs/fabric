'use strict';

/**
 * MuSig2 adaptor signatures, compatible with secp256k1-zkp's MuSig module.
 *
 * The adaptor point T is added to the first aggregate nonce before the nonce
 * coefficient is hashed (`musig_nonce_process` with an adaptor), so every
 * signer's partial signature is a share of a pre-signature `x(R̂) ‖ s'`. The
 * final nonce parity says whether completing it adds or subtracts t.
 *
 * @module types/witness/musig2Adaptor
 */

const { secp256k1 } = require('@noble/curves/secp256k1.js');
const musig2 = require('./musig2');
const adaptor = require('./adaptor');

const Point = secp256k1.Point;
const N = Point.Fn.ORDER;
const G = Point.BASE;

function requireAdaptor (value) {
  if (value == null) throw new TypeError('an adaptor point is required');
  return value;
}

function hasEvenY (P) {
  return (P.toAffine().y & 1n) === 0n;
}

function toInt (buf) {
  return BigInt('0x' + Buffer.from(buf).toString('hex'));
}

/**
 * @param {Buffer} aggnonce 66-byte aggregate nonce (without the adaptor)
 * @param {Array<Buffer>} pubkeys
 * @param {Array<Buffer>} tweaks
 * @param {Array<boolean>} isXonly
 * @param {Buffer} msg
 * @param {Buffer} adaptorPoint 33-byte compressed T
 * @returns {object} session context for {@link module:types/witness/musig2}
 */
function sessionContext (aggnonce, pubkeys, tweaks, isXonly, msg, adaptorPoint) {
  return musig2.sessionContext(aggnonce, pubkeys, tweaks, isXonly, msg, requireAdaptor(adaptorPoint));
}

/**
 * @param {object} sessionCtx adaptor session context
 * @returns {number} 1 when the final nonce has an odd y
 */
function nonceParity (sessionCtx) {
  requireAdaptor(sessionCtx.adaptor);
  return hasEvenY(musig2.getSessionValues(sessionCtx).R) ? 0 : 1;
}

/**
 * Aggregate the partial signatures of an adaptor session.
 *
 * @param {Array<Buffer>} psigs
 * @param {object} sessionCtx adaptor session context
 * @returns {Buffer} 64-byte pre-signature `x(R̂) ‖ s'`
 */
function preSignatureAgg (psigs, sessionCtx) {
  requireAdaptor(sessionCtx.adaptor);
  return musig2.partialSigAgg(psigs, sessionCtx);
}

/**
 * Check an aggregate pre-signature against the session: completing it with the
 * secret of the session's adaptor point gives a valid BIP-340 signature under
 * the (tweaked) aggregate key.
 *
 * @param {Buffer} preSignature 64 bytes
 * @param {object} sessionCtx adaptor session context
 * @returns {boolean}
 */
function preVerify (preSignature, sessionCtx) {
  try {
    requireAdaptor(sessionCtx.adaptor);
    const pre = Buffer.from(preSignature);
    if (pre.length !== 64) return false;
    const { Q, R, e } = musig2.getSessionValues(sessionCtx);
    if (!pre.subarray(0, 32).equals(Buffer.from(R.toBytes(true)).subarray(1))) return false;
    const s = toInt(pre.subarray(32));
    if (s >= N) return false;
    let Rk = R.subtract(Point.fromBytes(sessionCtx.adaptor));
    if (Rk.equals(Point.ZERO)) return false;
    if (!hasEvenY(R)) Rk = Rk.negate();
    const Qeven = hasEvenY(Q) ? Q : Q.negate();
    const lhs = s === 0n ? Point.ZERO : G.multiplyUnsafe(s);
    const rhs = e === 0n ? Rk : Rk.add(Qeven.multiplyUnsafe(e));
    return lhs.equals(rhs);
  } catch {
    return false;
  }
}

/**
 * Verify one signer's partial signature in an adaptor session.
 *
 * @param {Buffer} psig
 * @param {Array<Buffer>} pubnonces
 * @param {Array<Buffer>} pubkeys
 * @param {Array<Buffer>} tweaks
 * @param {Array<boolean>} isXonly
 * @param {Buffer} msg
 * @param {number} i
 * @param {Buffer} adaptorPoint
 * @returns {boolean}
 */
function partialSigVerify (psig, pubnonces, pubkeys, tweaks, isXonly, msg, i, adaptorPoint) {
  return musig2.partialSigVerify(psig, pubnonces, pubkeys, tweaks, isXonly, msg, i, requireAdaptor(adaptorPoint));
}

/**
 * Stateless signing for the last signer of an adaptor session (BIP-327 DeterministicSign).
 *
 * @param {Buffer} sk
 * @param {Buffer} aggothernonce
 * @param {Array<Buffer>} pubkeys
 * @param {Array<Buffer>} tweaks
 * @param {Array<boolean>} isXonly
 * @param {Buffer} msg
 * @param {Buffer|null} rand
 * @param {Buffer} adaptorPoint
 * @returns {{ pubnonce: Buffer, psig: Buffer }}
 */
function deterministicSign (sk, aggothernonce, pubkeys, tweaks, isXonly, msg, rand, adaptorPoint) {
  return musig2.deterministicSign(sk, aggothernonce, pubkeys, tweaks, isXonly, msg, rand, requireAdaptor(adaptorPoint));
}

module.exports = {
  sessionContext,
  nonceParity,
  preSignatureAgg,
  preVerify,
  partialSigVerify,
  deterministicSign,
  adapt: adaptor.adaptXonly,
  extract: adaptor.extractXonly
};
