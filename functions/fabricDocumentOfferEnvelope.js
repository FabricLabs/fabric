'use strict';

/**
 * Fabric document-offer envelope types (JSON `type` on generic payloads). Conceptually aligned with
 * Lightning BOLT12 *offers* (buyer-facing request → seller-facing response); wire remains
 * `P2P_INVENTORY_REQUEST` / `P2P_INVENTORY_RESPONSE` opcodes. See `docs/FABRIC_DOCUMENT_OFFER.md`.
 */

/** Canonical JSON `type`: buyer/originator asks for catalog / settlement terms. */
const FABRIC_DOCUMENT_OFFER = 'FABRIC_DOCUMENT_OFFER';
/** Accepted synonym for `FABRIC_DOCUMENT_OFFER`. */
const FABRIC_DOCUMENT_OFFER_REQUEST = 'FABRIC_DOCUMENT_OFFER_REQUEST';

/** Canonical JSON `type`: seller/router replies (items, L1 `contentHash`, optional HTLC hooks). */
const FABRIC_DOCUMENT_OFFER_RESPONSE = 'FABRIC_DOCUMENT_OFFER_RESPONSE';
/** Accepted synonym for `FABRIC_DOCUMENT_OFFER_RESPONSE`. */
const FABRIC_DOCUMENT_OFFER_REPLY = 'FABRIC_DOCUMENT_OFFER_REPLY';

const TO_LEGACY_INVENTORY = Object.freeze({
  [FABRIC_DOCUMENT_OFFER]: 'INVENTORY_REQUEST',
  [FABRIC_DOCUMENT_OFFER_REQUEST]: 'INVENTORY_REQUEST',
  [FABRIC_DOCUMENT_OFFER_RESPONSE]: 'INVENTORY_RESPONSE',
  [FABRIC_DOCUMENT_OFFER_REPLY]: 'INVENTORY_RESPONSE'
});

/**
 * Map Fabric document-offer envelope `type` strings to legacy handler types (`INVENTORY_*`).
 * @param {unknown} type
 * @returns {string|null}
 */
function fabricDocumentOfferEnvelopeToLegacy (type) {
  if (typeof type !== 'string') return null;
  const t = type.trim();
  return TO_LEGACY_INVENTORY[t] || null;
}

/**
 * Shallow-clone `message` with `type` set to `INVENTORY_REQUEST` / `INVENTORY_RESPONSE` when a Fabric alias is used.
 * @param {object} message
 * @returns {object}
 */
function normalizeFabricDocumentOfferEnvelopeForHandlers (message) {
  if (!message || typeof message !== 'object') return message;
  const legacy = fabricDocumentOfferEnvelopeToLegacy(message.type);
  if (!legacy) return message;
  return Object.assign({}, message, { type: legacy });
}

module.exports = {
  FABRIC_DOCUMENT_OFFER,
  FABRIC_DOCUMENT_OFFER_REQUEST,
  FABRIC_DOCUMENT_OFFER_RESPONSE,
  FABRIC_DOCUMENT_OFFER_REPLY,
  TO_LEGACY_INVENTORY,
  fabricDocumentOfferEnvelopeToLegacy,
  normalizeFabricDocumentOfferEnvelopeForHandlers
};
