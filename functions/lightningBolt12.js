'use strict';

/** BOLT12 offer encoding uses HRP `lno` → strings begin with `lno1` (bech32m). */
const BOLT12_OFFER_PREFIX = 'lno1';

/** Invoice request (`invoice_request` in spec) — Core Lightning exposes `lnr1…` strings. */
const BOLT12_INVOICE_REQUEST_PREFIX = 'lnr1';

/**
 * Common BOLT11 invoice HRPs (first segment before `1`). Not exhaustive; unknown `ln…1` may still be BOLT11.
 * @type {ReadonlyArray<string>}
 */
const BOLT11_INVOICE_HRPS = Object.freeze([
  'lnbc', 'lntb', 'lnbcrt', 'lntbs', 'lnbs', 'lntbsc', 'lnsb', 'lnbsc', 'lntb4', 'lnbc4'
]);

/**
 * @typedef {'bolt12_offer'|'bolt12_invoice_request'|'bolt11_invoice'|'unknown'} Bolt12Class
 */

function normalizeBolt12ScanString (s) {
  let t = String(s ?? '').trim();
  if (!t) return '';
  t = t.replace(/\+\s*/g, '');
  return t;
}

/**
 * @param {string|null|undefined} s
 * @returns {boolean}
 */
function isBolt12OfferString (s) {
  const low = normalizeBolt12ScanString(s).toLowerCase();
  return low.startsWith(BOLT12_OFFER_PREFIX);
}

/**
 * @param {string|null|undefined} s
 * @returns {boolean}
 */
function isBolt12InvoiceRequestString (s) {
  const low = normalizeBolt12ScanString(s).toLowerCase();
  return low.startsWith(BOLT12_INVOICE_REQUEST_PREFIX);
}

/**
 * @param {string|null|undefined} s
 * @returns {boolean}
 */
function isLikelyBolt11InvoiceString (s) {
  const t = String(s || '').trim().toLowerCase();
  if (!t.includes('1')) return false;
  return BOLT11_INVOICE_HRPS.some((hrp) => t.startsWith(`${hrp}1`));
}

/**
 * Classify a Lightning-encoded string for routing to `fetchInvoice`, `sendInvoice`, `pay`, etc.
 * @param {string|null|undefined} s
 * @returns {Bolt12Class|'empty'}
 */
function classifyLightningEncodedString (s) {
  const t = normalizeBolt12ScanString(s);
  if (!t) return 'empty';
  const low = t.toLowerCase();
  if (low.startsWith(BOLT12_OFFER_PREFIX)) return 'bolt12_offer';
  if (low.startsWith(BOLT12_INVOICE_REQUEST_PREFIX)) return 'bolt12_invoice_request';
  if (isLikelyBolt11InvoiceString(low)) return 'bolt11_invoice';
  return 'unknown';
}

/**
 * How Fabric **markets** and related layers relate to Lightning (see `docs/FABRIC_LIGHTNING_OFFERS.md`).
 * @readonly
 * @enum {string}
 */
const FabricLightningOfferRole = Object.freeze({
  /** Fabric `Peer` `P2P_SESSION_OFFER` / peering — not a BOLT12 string. */
  fabric_peer_handshake: 'fabric_peer_handshake',
  /** Inventory `offerBtc` / document rate — market surface; may pair with a BOLT12 `bolt12` for LN pay. */
  fabric_document_commerce: 'fabric_document_commerce',
  /** BOLT12 `offer` / `lno1…` — Lightning payment offer (Core Lightning `offer` RPC). */
  lightning_bolt12_offer: 'lightning_bolt12_offer',
  /** BOLT12 `invoice_request` / `lnr1…` — payer-initiated flow (`invoicerequest` RPC). */
  lightning_bolt12_invoice_request: 'lightning_bolt12_invoice_request'
});

/** @type {typeof FabricLightningOfferRole} Preferred name; same frozen object as {@link FabricLightningOfferRole}. */
const FabricLightningMarketRole = FabricLightningOfferRole;

module.exports = {
  BOLT12_OFFER_PREFIX,
  BOLT12_INVOICE_REQUEST_PREFIX,
  BOLT11_INVOICE_HRPS,
  FabricLightningMarketRole,
  FabricLightningOfferRole,
  classifyLightningEncodedString,
  isBolt12OfferString,
  isBolt12InvoiceRequestString,
  isLikelyBolt11InvoiceString,
  normalizeBolt12ScanString
};
