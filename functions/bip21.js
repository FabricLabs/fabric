/**
 * BIP-21 `bitcoin:` payment URIs (amount, label, message) plus opaque extra
 * query keys (`pj=`, `lightning=`, …) so BIP-321 / BIP-78 callers can round-trip
 * without this module claiming full BIP-321 grammar.
 *
 * @fileoverview BIP-21 bitcoin: URI encode/parse.
 * @module functions/bip21
 */
'use strict';

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
  if (!s || !/^\d+(\.\d+)?$/.test(s)) {
    throw new RangeError('BIP21 amount must be a decimal BTC string');
  }
  return s;
}

/**
 * Build a BIP-21 URI.
 *
 * @param {Object} opts
 * @param {string} opts.address
 * @param {number|string} [opts.amount] BTC (not satoshis)
 * @param {string} [opts.label]
 * @param {string} [opts.message]
 * @param {Object} [opts.extras] extra query keys (`pj`, `lightning`, …)
 * @returns {string}
 */
function encodeBitcoinUri (opts = {}) {
  const address = String(opts.address || '').trim();
  if (!address) throw new Error('BIP21 URI requires an address');
  if (/[?#]/.test(address)) throw new Error('BIP21 address must not contain ? or #');
  const params = new URLSearchParams();
  if (opts.amount != null && opts.amount !== '') {
    params.set('amount', formatAmount(opts.amount));
  }
  if (opts.label) params.set('label', String(opts.label));
  if (opts.message) params.set('message', String(opts.message));
  const extras = opts.extras && typeof opts.extras === 'object' ? opts.extras : {};
  for (const key of Object.keys(extras)) {
    if (key === 'amount' || key === 'label' || key === 'message') continue;
    const val = extras[key];
    if (val == null || val === '') continue;
    params.set(key, String(val));
  }
  const query = params.toString();
  return query ? `bitcoin:${address}?${query}` : `bitcoin:${address}`;
}

/**
 * Parse a BIP-21 (or BIP-21-shaped BIP-321) URI.
 *
 * @param {string} uri
 * @returns {Object} parsed URI (`address`, `amount`, `label`, `message`, `extras`)
 */
function parseBitcoinUri (uri) {
  const raw = String(uri || '').trim();
  const m = /^bitcoin:(\/\/)?([^?#]*)(?:\?([^#]*))?(?:#.*)?$/i.exec(raw);
  if (!m) throw new Error('not a bitcoin: URI');
  const address = decodeURIComponent(m[2] || '').trim();
  const extras = {};
  let amount = null;
  let label = null;
  let message = null;
  if (m[3]) {
    const params = new URLSearchParams(m[3]);
    for (const [key, value] of params.entries()) {
      const k = String(key);
      if (k.toLowerCase().startsWith('req-')) {
        throw new Error(`unsupported required BIP21 parameter: ${k}`);
      }
      if (k === 'amount') amount = value;
      else if (k === 'label') label = value;
      else if (k === 'message') message = value;
      else extras[k] = value;
    }
  }
  if (amount != null && (Number(amount) < 0 || !/^\d+(\.\d+)?$/.test(String(amount)))) {
    throw new Error('BIP21 amount is invalid');
  }
  return { address, amount, label, message, extras };
}

module.exports = {
  encodeBitcoinUri,
  parseBitcoinUri
};
