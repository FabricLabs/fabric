'use strict';

const bech32 = require('./bech32');
const lb = require('./lightningBolt12');

const FABRIC_ROUTED_PAYMENT_HRP = 'fa';

/** All such strings use the `1` separator after the HRP, e.g. `fa1…`. */
const FABRIC_ROUTED_PAYMENT_PREFIX = `${FABRIC_ROUTED_PAYMENT_HRP}1`;

/** Payload format byte (first byte after decode). */
const FABRIC_PAYMENT_VERSION = 0;

/**
 * Route / binding type (second byte). `0` = 32-byte document **content hash** (see L1 document exchange).
 * @readonly
 * @enum {number}
 */
const FabricRouteType = Object.freeze({
  /** SHA256 hash as used with `purchaseContentHashHex` / canonical publish preimage chain. */
  DOCUMENT_CONTENT_HASH: 0
});

/**
 * @param {string|null|undefined} s
 * @returns {boolean}
 */
function isFabricRoutedPaymentString (s) {
  return String(s || '').trim().toLowerCase().startsWith(FABRIC_ROUTED_PAYMENT_PREFIX);
}

/**
 * Encode a v0 Fabric-routed payment reference: version + route type + 32-byte id (e.g. content hash).
 * @param {Object} o
 * @param {Buffer|Uint8Array|number[]} o.hash32 Exactly 32 bytes (e.g. document content hash).
 * @param {number} [o.routeType=0] {@link FabricRouteType}
 * @returns {string} bech32m string (`fa1…`)
 */
function encodeFabricRoutedPaymentV0 (o) {
  if (!o || !o.hash32) throw new TypeError('encodeFabricRoutedPaymentV0 requires hash32');
  let buf;
  if (Buffer.isBuffer(o.hash32)) buf = o.hash32;
  else if (o.hash32 instanceof Uint8Array) buf = Buffer.from(o.hash32);
  else if (Array.isArray(o.hash32)) buf = Buffer.from(o.hash32);
  else throw new TypeError('hash32 must be Buffer, Uint8Array, or byte array');
  if (buf.length !== 32) throw new TypeError('hash32 must be exactly 32 bytes');
  const routeType = o.routeType != null ? Number(o.routeType) : FabricRouteType.DOCUMENT_CONTENT_HASH;
  if (!Number.isInteger(routeType) || routeType < 0 || routeType > 255) {
    throw new TypeError('routeType must be an integer 0..255');
  }
  const payload = Buffer.concat([Buffer.from([FABRIC_PAYMENT_VERSION, routeType]), buf]);
  const words = bech32.toWords(payload);
  return bech32.encode(FABRIC_ROUTED_PAYMENT_HRP, words, 'bech32m');
}

/**
 * Decode an `fa1…` string. Returns `null` if HRP/spec mismatch or payload shape is wrong.
 * @param {string} str
 * @returns {{ version: number, routeType: number, hash32: Buffer, hrp: string, spec: string }|null}
 */
function decodeFabricRoutedPayment (str) {
  if (typeof str !== 'string' || !str.trim()) return null;
  let d;
  try {
    d = bech32.decode(str.trim());
  } catch {
    return null;
  }
  if (d.hrp !== FABRIC_ROUTED_PAYMENT_HRP || d.spec !== 'bech32m') return null;
  let raw;
  try {
    raw = bech32.fromWords(d.words);
  } catch {
    return null;
  }
  if (raw.length < 2 + 32) return null;
  const version = raw[0];
  const routeType = raw[1];
  const hash32 = Buffer.from(raw.slice(2, 34));
  if (version !== FABRIC_PAYMENT_VERSION) return null;
  if (raw.length !== 34) return null;
  return {
    version,
    routeType,
    hash32,
    hrp: d.hrp,
    spec: d.spec
  };
}

/**
 * Classify a payment-related encoded string: Fabric `fa1…`, then Lightning `ln…` (see {@link ./lightningBolt12}).
 * @param {string|null|undefined} s
 * @returns {string}
 */
function classifyPaymentEncodingString (s) {
  const t = String(s || '').trim();
  if (!t) return 'empty';
  if (isFabricRoutedPaymentString(t)) return 'fabric_routed_payment';
  return lb.classifyLightningEncodedString(s);
}

module.exports = {
  FABRIC_ROUTED_PAYMENT_HRP,
  FABRIC_ROUTED_PAYMENT_PREFIX,
  FABRIC_PAYMENT_VERSION,
  FabricRouteType,
  classifyPaymentEncodingString,
  decodeFabricRoutedPayment,
  encodeFabricRoutedPaymentV0,
  isFabricRoutedPaymentString
};
