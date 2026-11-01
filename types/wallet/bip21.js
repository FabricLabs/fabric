/**
 * BIP-21 `bitcoin:` payment URIs (amount, label, message) plus opaque extra
 * query keys (`pj=`, `lightning=`, …) so BIP-321 / BIP-78 callers can round-trip
 * without this module claiming full BIP-321 grammar.
 *
 * Query components are RFC 3986 percent-encoded: a space is `%20` and `+` is
 * a literal plus (not `application/x-www-form-urlencoded`). Following BIP-321,
 * query keys are case-insensitive, `amount` / `label` / `message` / `pop` may
 * appear once, other keys may repeat, and the address may be empty when a
 * query key carries the payment instruction.
 *
 * @fileoverview BIP-21 bitcoin: URI encode/parse.
 * @module types/wallet/bip21
 */
'use strict';

/** Keys with their own `encodeBitcoinUri` option; `extras` cannot set them. */
const RESERVED_KEYS = Object.freeze(['amount', 'label', 'message']);
/**
 * Keys that may appear once: BIP-321's `label` / `message` / `pop` and
 * `amount` (per its invalid-URI examples), plus BIP-78's one Payjoin endpoint.
 */
const SINGLE_KEYS = Object.freeze([...RESERVED_KEYS, 'pop', 'pj', 'pjos']);

/** Decimal BTC with at most 8 fractional digits (one satoshi). */
const AMOUNT_PATTERN = /^\d+(\.\d{1,8})?$/;

/**
 * @param {*} amount
 * @returns {string}
 * @private
 */
function formatAmount (amount) {
  if (typeof amount === 'number') {
    if (!Number.isFinite(amount) || amount < 0) {
      throw new RangeError('BIP21 amount must be a non-negative BTC value');
    }
    const formatted = amount.toFixed(8);
    if (Number(formatted) !== amount) {
      throw new RangeError('BIP21 amount must be a non-negative BTC value');
    }
    return formatted;
  }
  const s = String(amount).trim();
  if (!s || !AMOUNT_PATTERN.test(s)) {
    throw new RangeError('BIP21 amount must be a decimal BTC string');
  }
  return s;
}

/**
 * @param {string} value
 * @param {string} what
 * @returns {string}
 * @private
 */
function percentDecode (value, what) {
  try {
    return decodeURIComponent(value);
  } catch (_) {
    throw new Error(`BIP21 ${what} has malformed percent-encoding`);
  }
}

/**
 * Build a BIP-21 URI.
 *
 * @param {Object} opts
 * @param {string} opts.address
 * @param {number|string} [opts.amount] BTC (not satoshis)
 * @param {string} [opts.label]
 * @param {string} [opts.message]
 * @param {Object} [opts.extras] extra query keys (`pj`, `lightning`, …); an array value repeats the key
 * @returns {string}
 */
function encodeBitcoinUri (opts = {}) {
  const address = String(opts.address || '').trim();
  if (!address) throw new Error('BIP21 URI requires an address');
  if (/[?#]/.test(address)) throw new Error('BIP21 address must not contain ? or #');
  const params = [];
  if (opts.amount != null && opts.amount !== '') {
    params.push(['amount', formatAmount(opts.amount)]);
  }
  if (opts.label) params.push(['label', String(opts.label)]);
  if (opts.message) params.push(['message', String(opts.message)]);
  const extras = opts.extras && typeof opts.extras === 'object' ? opts.extras : {};
  for (const key of Object.keys(extras)) {
    if (RESERVED_KEYS.includes(key.toLowerCase())) continue;
    const values = Array.isArray(extras[key]) ? extras[key] : [extras[key]];
    for (const val of values) {
      if (val == null || val === '') continue;
      params.push([key, String(val)]);
    }
  }
  const query = params
    .map(([key, val]) => `${encodeURIComponent(key)}=${encodeURIComponent(val)}`)
    .join('&');
  return query ? `bitcoin:${address}?${query}` : `bitcoin:${address}`;
}

/**
 * Parse a BIP-21 (or BIP-21-shaped BIP-321) URI.
 *
 * Extra keys are returned lower-cased; a key given more than once maps to an
 * array of its values.
 *
 * @param {string} uri
 * @returns {Object} parsed URI (`address`, `amount`, `label`, `message`, `extras`)
 */
function parseBitcoinUri (uri) {
  const raw = String(uri || '').trim();
  const m = /^bitcoin:(\/\/)?([^?#]*)(?:\?([^#]*))?(?:#.*)?$/i.exec(raw);
  if (!m) throw new Error('not a bitcoin: URI');
  const address = percentDecode(m[2] || '', 'address').trim();
  const extras = {};
  const seen = new Set();
  let amount = null;
  let label = null;
  let message = null;
  for (const part of (m[3] || '').split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    const key = percentDecode(eq < 0 ? part : part.slice(0, eq), 'query key').toLowerCase();
    const value = eq < 0 ? '' : percentDecode(part.slice(eq + 1), `${key} value`);
    if (key.startsWith('req-')) {
      throw new Error(`unsupported required BIP21 parameter: ${key}`);
    }
    if (SINGLE_KEYS.includes(key)) {
      if (seen.has(key)) throw new Error(`BIP21 parameter appears twice: ${key}`);
      seen.add(key);
    }
    if (key === 'amount') amount = value;
    else if (key === 'label') label = value;
    else if (key === 'message') message = value;
    else {
      // defineProperty: a `__proto__` key must stay a plain own property.
      const prior = Object.prototype.hasOwnProperty.call(extras, key) ? extras[key] : undefined;
      Object.defineProperty(extras, key, {
        value: prior === undefined ? value : [].concat(prior, value),
        enumerable: true,
        writable: true,
        configurable: true
      });
    }
  }
  if (amount != null && !AMOUNT_PATTERN.test(amount)) {
    throw new Error('BIP21 amount is invalid');
  }
  if (!address && !Object.keys(extras).length) {
    throw new Error('BIP21 URI requires an address or a payment instruction');
  }
  return { address, amount, label, message, extras };
}

module.exports = {
  encodeBitcoinUri,
  parseBitcoinUri
};
