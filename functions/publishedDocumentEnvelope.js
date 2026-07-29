'use strict';

/**
 * Canonical Fabric `DocumentPublish` **unsigned** envelope bytes + document-offer types.
 *
 * **Legacy unsealed payment binding (do not hash signed gossip frames):**
 * 1. Build **unsigned** AMP bytes via {@link documentPublishEnvelopeBuffer}
 *    (signature field **must** be all zeros — this is the binding commitment).
 * 2. HTLC / invoice **preimage** (32 bytes) = `SHA256(those unsigned bytes)`.
 * 3. **`purchaseContentHashHex`** / wire `contentHashHex` = `SHA256(preimage)`.
 *
 * Signing a `DocumentPublish` for Peer gossip changes the signature bytes and
 * **must not** be used as the payment commitment. Prefer
 * {@link module:functions/documentPaymentHash} `resolveDocumentContentHashHex`
 * for sealed vs envelope vs blob.
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
 * Content-stable fields only — no timestamps / lineage that drift between Hub store
 * and Peer rebuild (`_buildDocumentParsedForPublish`).
 * @param {string} docIdNorm - normalized document id
 * @param {object} parsed - parsed document JSON (e.g. hub `documents/{id}.json`)
 */
function whitelistedDocumentFields (docIdNorm, parsed) {
  const p = parsed || {};
  const id = docIdNorm;
  return {
    contentBase64: p.contentBase64 != null ? String(p.contentBase64) : null,
    id,
    mime: p.mime != null ? String(p.mime) : 'application/octet-stream',
    name: p.name != null ? String(p.name) : 'document',
    revision: p.revision != null ? Number(p.revision) : 1,
    sha256: p.sha256 != null ? String(p.sha256) : id,
    size: p.size != null ? Number(p.size) : 0
  };
}

/**
 * Assert AMP buffer is an **unsigned** DocumentPublish frame (signature all zeros).
 * Payment binding must never hash a Schnorr-signed gossip frame.
 * @param {Buffer} buf
 * @returns {Buffer} same buffer
 */
function assertUnsignedDocumentPublishEnvelope (buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 208) {
    throw new Error('document publish envelope must be an AMP Message buffer (≥ 208 bytes)');
  }
  const sig = buf.subarray(144, 208);
  if (!sig.equals(Buffer.alloc(64))) {
    throw new Error(
      'document publish envelope must be unsigned (zero signature); ' +
      'do not hash signed gossip DocumentPublish bytes for payment binding'
    );
  }
  return buf;
}

/**
 * Full **unsigned** AMP message bytes (header + body) for DocumentPublish with
 * canonical JSON payload. Signature field is always zeros — safe for payment hash.
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
  // Ensure we never accidentally carry a signature into the commitment.
  if (msg.raw && Buffer.isBuffer(msg.raw.signature)) msg.raw.signature.fill(0);
  const buf = msg.toBuffer();
  return assertUnsignedDocumentPublishEnvelope(buf);
}

/**
 * SHA256 of the **unsigned** envelope buffer (legacy unsealed HTLC preimage).
 * Rejects signed frames if a raw buffer is passed through {@link assertUnsignedDocumentPublishEnvelope}.
 * @param {string} docIdNorm
 * @param {object} parsed
 * @returns {Buffer}
 */
function inventoryHtlcPreimage32 (docIdNorm, parsed) {
  const buf = documentPublishEnvelopeBuffer(docIdNorm, parsed);
  return crypto.createHash('sha256').update(buf).digest();
}

/** Hex string matching Hub CreatePurchaseInvoice / ClaimPurchase `contentHash` (envelope mode). */
function purchaseContentHashHex (docIdNorm, parsed) {
  const preimage = inventoryHtlcPreimage32(docIdNorm, parsed);
  return crypto.createHash('sha256').update(preimage).digest('hex');
}

/**
 * Payment preimage from an already-built AMP buffer — only if unsigned.
 * @param {Buffer} envelopeBuf
 * @returns {Buffer} 32-byte SHA256(envelopeBuf)
 */
function inventoryHtlcPreimage32FromEnvelopeBuffer (envelopeBuf) {
  const buf = assertUnsignedDocumentPublishEnvelope(envelopeBuf);
  return crypto.createHash('sha256').update(buf).digest();
}

module.exports = {
  fabricCanonicalJson,
  whitelistedDocumentFields,
  assertUnsignedDocumentPublishEnvelope,
  documentPublishEnvelopeBuffer,
  inventoryHtlcPreimage32,
  inventoryHtlcPreimage32FromEnvelopeBuffer,
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
