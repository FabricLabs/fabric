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
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer && Buffer.isBuffer(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  if (input instanceof Uint8Array) return input;
  throw new TypeError('expected Buffer or Uint8Array');
}

function _enforceMax (u8, maxLength, label) {
  if (maxLength == null || !Number.isFinite(maxLength) || maxLength < 0) return;
  if (u8.length > maxLength) {
    throw new RangeError(`${label}: length ${u8.length} exceeds maxLength ${maxLength}`);
  }
}

function _isByte (v) {
  return Number.isInteger(v) && v >= 0 && v <= 255;
}

/**
 * Pack four 0–255 byte values as a big-endian uint32 (for protocol constants without large literals).
 * @param {number} a
 * @param {number} b
 * @param {number} c
 * @param {number} d
 * @returns {number}
 */
function u32be (a, b, c, d) {
  return ((a & 255) << 24) | ((b & 255) << 16) | ((c & 255) << 8) | (d & 255);
}

function _bytesFromIterable (iterable, maxLength) {
  const out = [];
  let i = 0;
  for (const v of iterable) {
    if (!_isByte(v)) {
      throw new TypeError('toUint8Flexible: expected integer byte 0–255');
    }
    out.push(v);
    i++;
    if (maxLength != null && Number.isFinite(maxLength) && i > maxLength) {
      throw new RangeError(`toUint8Flexible: length exceeds maxLength ${maxLength}`);
    }
  }
  return new Uint8Array(out);
}

/**
 * Noble / secp256k1 call sites that must accept browser-friendly inputs already vetted
 * by callers (e.g. key material as Buffer, hex-decoded bytes, or typed arrays).
 * Optional **`maxLength`** bounds allocation for array-likes and iterables (DoS hardening).
 * Rejects strings (use explicit encoding) and non-byte values (no silent modular wrap).
 * @param {Buffer|Uint8Array|ArrayLike<number>|Iterable<number>} bytes
 * @param {number} [maxLength] — when set, reject views longer than this
 * @returns {Uint8Array}
 */
function toUint8Flexible (bytes, maxLength) {
  if (typeof bytes === 'string') {
    throw new TypeError('toUint8Flexible: string input is not allowed; decode to bytes explicitly');
  }
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer && Buffer.isBuffer(bytes)) {
    const u8 = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    _enforceMax(u8, maxLength, 'toUint8Flexible');
    return u8;
  }
  if (bytes instanceof Uint8Array) {
    _enforceMax(bytes, maxLength, 'toUint8Flexible');
    return bytes;
  }
  const len = bytes != null && typeof bytes.length === 'number' && Number.isFinite(bytes.length)
    ? bytes.length
    : null;
  if (len != null) {
    if (maxLength != null && Number.isFinite(maxLength) && len > maxLength) {
      throw new RangeError(`toUint8Flexible: array-like length ${len} exceeds maxLength ${maxLength}`);
    }
    const out = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      const v = bytes[i];
      if (!_isByte(v)) {
        throw new TypeError(`toUint8Flexible: expected integer byte 0–255 at index ${i}`);
      }
      out[i] = v;
    }
    return out;
  }
  if (bytes != null && typeof bytes[Symbol.iterator] === 'function') {
    return _bytesFromIterable(bytes, maxLength);
  }
  throw new TypeError('toUint8Flexible: expected Buffer, Uint8Array, array-like, or iterable of bytes');
}

module.exports = {
  toUint8Strict,
  toUint8Flexible,
  u32be
};
