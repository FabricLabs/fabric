'use strict';

/**
 * Normalized byte views for crypto pipelines.
 *
 * **Why one module:** duplicate `toU8` helpers across encoders and curves tend to drift
 * (Buffer vs Uint8Array order, throw vs coerce). Downstream, that becomes inconsistent
 * signatures, hashes, or address parsing between Node and browser bundles — a useful
 * wedge for differential bugs. Keep coercion rules centralized and tested.
 *
 * @module functions/bytes
 */

/**
 * Wire / encoding inputs: only Node `Buffer` or `Uint8Array`. Reject everything else.
 * @param {Buffer|Uint8Array} input
 * @returns {Uint8Array}
 */
function toUint8Strict (input) {
  if (input instanceof Uint8Array) return input;
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer && Buffer.isBuffer(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  throw new TypeError('expected Buffer or Uint8Array');
}

function _enforceMax (u8, maxLength, label) {
  if (maxLength == null || !Number.isFinite(maxLength) || maxLength < 0) return;
  if (u8.length > maxLength) {
    throw new RangeError(`${label}: length ${u8.length} exceeds maxLength ${maxLength}`);
  }
}

/**
 * Noble / secp256k1 call sites that must accept browser-friendly inputs already vetted
 * by callers (e.g. key material as Buffer, hex-decoded bytes, or typed arrays).
 * Optional **`maxLength`** bounds `Uint8Array.from` allocation when `bytes` is an array-like
 * (DoS hardening). `Buffer` / `Uint8Array` are checked after view creation.
 * @param {Buffer|Uint8Array|ArrayLike<number>} bytes
 * @param {number} [maxLength] — when set, reject views longer than this
 * @returns {Uint8Array}
 */
function toUint8Flexible (bytes, maxLength) {
  if (bytes instanceof Uint8Array) {
    _enforceMax(bytes, maxLength, 'toUint8Flexible');
    return bytes;
  }
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer && Buffer.isBuffer(bytes)) {
    const u8 = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    _enforceMax(u8, maxLength, 'toUint8Flexible');
    return u8;
  }
  const len = bytes != null && typeof bytes.length === 'number' ? bytes.length : null;
  if (maxLength != null && Number.isFinite(maxLength) && len != null && len > maxLength) {
    throw new RangeError(`toUint8Flexible: array-like length ${len} exceeds maxLength ${maxLength}`);
  }
  const out = Uint8Array.from(bytes);
  _enforceMax(out, maxLength, 'toUint8Flexible');
  return out;
}

module.exports = {
  toUint8Strict,
  toUint8Flexible
};
