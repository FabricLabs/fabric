'use strict';

/**
 * Canonical Fabric `DocumentPublish` wire bytes + document-offer envelope types.
 *
 * **Envelope (legacy / unsealed) payment hash:**
 * - preimage (32 bytes) = SHA256(Message.toBuffer())
 * - `purchaseContentHashHex` = SHA256(preimage)
 *
 * For the full buy/HTLC commitment (sealed vs envelope vs blob), use
 * {@link module:functions/documentPaymentHash} — `resolveDocumentContentHashHex`.
 * Wire / session field name is always `contentHashHex`.
 *
 * Offer JSON `type` aliases (BOLT12-shaped naming; wire opcodes remain inventory)
 * live here so Hub/Peer do not need a separate module.
 */

const crypto = require('crypto');
const Message = require('../types/message');
const fabricCanonicalJson = require('./fabricCanonicalJson');

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

/**
 * True for legacy `INVENTORY_REQUEST` or Fabric document-offer request aliases.
 * @param {unknown} type
 * @returns {boolean}
 */
function isDocumentInventoryRequestType (type) {
  const t = typeof type === 'string' ? type.trim() : '';
  return t === 'INVENTORY_REQUEST' ||
    t === FABRIC_DOCUMENT_OFFER ||
    t === FABRIC_DOCUMENT_OFFER_REQUEST;
}

/**
 * True for legacy `INVENTORY_RESPONSE` or Fabric document-offer response aliases.
 * @param {unknown} type
 * @returns {boolean}
 */
function isDocumentInventoryResponseType (type) {
  const t = typeof type === 'string' ? type.trim() : '';
  return t === 'INVENTORY_RESPONSE' ||
    t === FABRIC_DOCUMENT_OFFER_RESPONSE ||
    t === FABRIC_DOCUMENT_OFFER_REPLY;
}

/**
 * Bridge / hub: merge `documents` inventory when inner JSON matches this shape.
 * @param {object|null|undefined} parsed
 * @returns {boolean}
 */
function isDocumentInventoryDocumentsOfferResponse (parsed) {
  return !!(parsed && parsed.object &&
    String(parsed.object.kind || '').trim().toLowerCase() === 'documents' &&
    isDocumentInventoryResponseType(parsed.type));
}

/**
 * Whitelisted fields only — stable across hub collection metadata (e.g. purchase price).
 * @param {string} docIdNorm - normalized document id
 * @param {object} parsed - parsed document JSON (e.g. hub `documents/{id}.json`)
 */
function whitelistedDocumentFields (docIdNorm, parsed) {
  const p = parsed || {};
  const id = docIdNorm;
  return {
    contentBase64: p.contentBase64 != null ? String(p.contentBase64) : null,
    created: p.created != null ? p.created : null,
    edited: p.edited != null ? p.edited : null,
    id,
    lineage: p.lineage != null ? p.lineage : (p.id || id),
    mime: p.mime != null ? String(p.mime) : 'application/octet-stream',
    name: p.name != null ? String(p.name) : 'document',
    parent: p.parent != null ? p.parent : null,
    revision: p.revision != null ? Number(p.revision) : 1,
    sha256: p.sha256 != null ? String(p.sha256) : id,
    size: p.size != null ? Number(p.size) : 0
  };
}

/**
 * Full AMP message bytes (header + body) for DocumentPublish with canonical JSON payload.
 * @param {string} docIdNorm
 * @param {object} parsed
 * @returns {Buffer}
 */
function documentPublishEnvelopeBuffer (docIdNorm, parsed) {
  if (!docIdNorm || !parsed || parsed.contentBase64 == null) {
    throw new Error('document id and contentBase64 required for publish envelope');
  }
  const payload = whitelistedDocumentFields(docIdNorm, parsed);
  const dataStr = fabricCanonicalJson(payload);
  const msg = Message.fromVector(['DocumentPublish', dataStr]);
  return msg.toBuffer();
}

function inventoryHtlcPreimage32 (docIdNorm, parsed) {
  const buf = documentPublishEnvelopeBuffer(docIdNorm, parsed);
  return crypto.createHash('sha256').update(buf).digest();
}

/** Hex string matching Hub CreatePurchaseInvoice / ClaimPurchase `contentHash`. */
function purchaseContentHashHex (docIdNorm, parsed) {
  const preimage = inventoryHtlcPreimage32(docIdNorm, parsed);
  return crypto.createHash('sha256').update(preimage).digest('hex');
}

module.exports = {
  fabricCanonicalJson,
  whitelistedDocumentFields,
  documentPublishEnvelopeBuffer,
  inventoryHtlcPreimage32,
  purchaseContentHashHex,
  FABRIC_DOCUMENT_OFFER,
  FABRIC_DOCUMENT_OFFER_REQUEST,
  FABRIC_DOCUMENT_OFFER_RESPONSE,
  FABRIC_DOCUMENT_OFFER_REPLY,
  TO_LEGACY_INVENTORY,
  fabricDocumentOfferEnvelopeToLegacy,
  normalizeFabricDocumentOfferEnvelopeForHandlers,
  isDocumentInventoryRequestType,
  isDocumentInventoryResponseType,
  isDocumentInventoryDocumentsOfferResponse
};
