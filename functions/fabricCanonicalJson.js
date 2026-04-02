'use strict';

/**
 * Deep JSON with lexicographically sorted object keys. Used anywhere bytes must be
 * **identical** across Node, browser, and Hub (L1 document preimage, beacon strings).
 *
 * **Security / audit**
 * - One implementation — do not fork a second “stable stringify” for signing or hashes.
 * - **Depth cap** prevents stack exhaustion on cyclic or pathologically nested input.
 * - **`undefined`**, **`Symbol`**, **`BigInt`**: `undefined` encodes as JSON `null` (explicit);
 *   `Symbol` / non-JSON BigInt throw (fail closed).
 *
 * @module functions/fabricCanonicalJson
 */

const MAX_DEPTH = 64;

/**
 * @param {*} value
 * @param {number} [depth=0]
 * @returns {string}
 */
function fabricCanonicalJson (value, depth = 0) {
  if (depth > MAX_DEPTH) {
    throw new RangeError('fabricCanonicalJson: max nesting depth exceeded');
  }
  if (value === undefined) {
    return 'null';
  }
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'bigint') {
      throw new TypeError('fabricCanonicalJson: BigInt is not JSON-safe');
    }
    if (typeof value === 'symbol') {
      throw new TypeError('fabricCanonicalJson: Symbol is not JSON-safe');
    }
    const s = JSON.stringify(value);
    if (s === undefined) {
      throw new TypeError('fabricCanonicalJson: value is not JSON-serializable');
    }
    return s;
  }
  if (Array.isArray(value)) {
    return '[' + value.map((v) => fabricCanonicalJson(v, depth + 1)).join(',') + ']';
  }
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + fabricCanonicalJson(value[k], depth + 1)).join(',') + '}';
}

module.exports = fabricCanonicalJson;
