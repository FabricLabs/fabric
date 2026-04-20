'use strict';

/**
 * BOLT #12 semantic helpers for interpreting **`Lightning#decodeLightning`** (`decode` RPC) JSON from Core Lightning.
 *
 * **BIP-340 signatures (BOLT #12 § Signature calculation):**
 * - **Offers** (`lno1…`) do **not** carry a signature TLV.
 * - **`invoice_request`** and **`invoice`** streams include **signature** (TLV type **240**…1000), keyed with
 *   `SIG("lightning" ‖ stream ‖ field, Merkle_root, key)` per the spec ([BOLT #12](https://github.com/lightning/bolts/blob/master/12-offer-encoding.md)).
 * - This module does **not** verify Schnorr signatures; use **`lightningd`** / **`decode`** and payment flows for that.
 *
 * **Recurrence:** TLVs such as `offer_recurrence_optional` / `_compulsory`, `invreq_recurrence_*`, `invoice_recurrence_basetime`
 * are summarized from flat **`decode`** objects when present.
 *
 * @module functions/bolt12Semantics
 * @see docs/LIGHTNING_COMPAT.md
 */

/**
 * TLV types named in BOLT #12 (offer / invoice_request / invoice ranges differ by stream).
 * @readonly
 */
const BOLT12_TLV = Object.freeze({
  INVREQ_METADATA: 0,
  OFFER_CHAINS: 2,
  OFFER_METADATA: 4,
  OFFER_CURRENCY: 6,
  OFFER_AMOUNT: 8,
  OFFER_DESCRIPTION: 10,
  OFFER_FEATURES: 12,
  OFFER_ABSOLUTE_EXPIRY: 14,
  OFFER_PATHS: 16,
  OFFER_ISSUER: 18,
  OFFER_QUANTITY_MAX: 20,
  OFFER_ISSUER_ID: 22,
  OFFER_RECURRENCE_COMPULSORY: 24,
  OFFER_RECURRENCE_OPTIONAL: 25,
  OFFER_RECURRENCE_BASE: 26,
  OFFER_RECURRENCE_PAYWINDOW: 27,
  OFFER_RECURRENCE_LIMIT: 29,
  INVREQ_CHAIN: 80,
  INVREQ_AMOUNT: 82,
  INVREQ_QUANTITY: 86,
  INVREQ_PAYER_ID: 88,
  INVREQ_RECURRENCE_COUNTER: 92,
  INVREQ_RECURRENCE_START: 93,
  INVREQ_RECURRENCE_CANCEL: 94,
  SIGNATURE_MIN: 240,
  SIGNATURE_MAX: 1000,
  INVOICE_PATHS: 160,
  INVOICE_BLINDEDPAY: 162,
  INVOICE_CREATED_AT: 164,
  INVOICE_PAYMENT_HASH: 168,
  INVOICE_AMOUNT: 170,
  INVOICE_NODE_ID: 176,
  INVOICE_RECURRENCE_BASETIME: 177
});

/**
 * Normalized kind for a value returned by **`decode`** / **`decodeLightning`**.
 * @readonly
 * @enum {string}
 */
const Bolt12StreamKind = Object.freeze({
  bolt12_offer: 'bolt12_offer',
  bolt12_invoice_request: 'bolt12_invoice_request',
  bolt12_invoice: 'bolt12_invoice',
  bolt11_invoice: 'bolt11_invoice',
  unknown: 'unknown'
});

/**
 * Classify **`decode`** result from Core Lightning using its **`type`** field (wording varies slightly by version).
 * @param {Object|null|undefined} decoded
 * @returns {typeof Bolt12StreamKind[keyof typeof Bolt12StreamKind]}
 */
function classifyDecodedBolt12 (decoded) {
  if (!decoded || typeof decoded !== 'object') return Bolt12StreamKind.unknown;
  const t = decoded.type;
  if (typeof t !== 'string') return Bolt12StreamKind.unknown;
  const s = t.toLowerCase();
  if (s.includes('bolt12') && s.includes('offer') && !s.includes('invoice')) {
    return Bolt12StreamKind.bolt12_offer;
  }
  if (s.includes('invoice_request') || (s.includes('bolt12') && s.includes('invoice') && s.includes('request'))) {
    return Bolt12StreamKind.bolt12_invoice_request;
  }
  if (s.includes('bolt12') && s.includes('invoice') && !s.includes('request')) {
    return Bolt12StreamKind.bolt12_invoice;
  }
  if (s.includes('bolt11') || /^bitcoin\s*invoice/i.test(t)) {
    return Bolt12StreamKind.bolt11_invoice;
  }
  return Bolt12StreamKind.unknown;
}

/**
 * Whether BOLT #12 Merkle **BIP-340** signatures apply to this stream (not offers).
 * @param {typeof Bolt12StreamKind[keyof typeof Bolt12StreamKind]} kind
 * @returns {boolean}
 */
function bip340SignatureApplies (kind) {
  return kind === Bolt12StreamKind.bolt12_invoice_request || kind === Bolt12StreamKind.bolt12_invoice;
}

/**
 * Collect recurrence-related fields from a flat **`decode`** object (snake_case keys as CLN tends to emit).
 * @param {Object|null|undefined} decoded
 * @returns {Object|null} Plain object copy, or `null` if nothing recurrence-related.
 */
function summarizeBolt12RecurrenceFromDecode (decoded) {
  if (!decoded || typeof decoded !== 'object') return null;
  /** @type {Record<string, unknown>} */
  const out = {};

  const offerKeys = [
    'offer_recurrence',
    'offer_recurrence_compulsory',
    'offer_recurrence_optional',
    'offer_recurrence_base',
    'offer_recurrence_paywindow',
    'offer_recurrence_limit'
  ];
  for (const k of offerKeys) {
    if (decoded[k] != null) out[k] = decoded[k];
  }

  const invreqKeys = [
    'invreq_recurrence_counter',
    'invreq_recurrence_start',
    'invreq_recurrence_cancel'
  ];
  for (const k of invreqKeys) {
    if (decoded[k] != null) out[k] = decoded[k];
  }

  if (decoded.invoice_recurrence_basetime != null) {
    out.invoice_recurrence_basetime = decoded.invoice_recurrence_basetime;
  }

  return Object.keys(out).length ? out : null;
}

module.exports = {
  BOLT12_TLV,
  Bolt12StreamKind,
  bip340SignatureApplies,
  classifyDecodedBolt12,
  summarizeBolt12RecurrenceFromDecode
};
