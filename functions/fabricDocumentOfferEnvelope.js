'use strict';

/**
 * Compatibility surface for Fabric document-offer envelope types.
 *
 * Canonical implementation lives in {@link module:functions/publishedDocumentEnvelope}.
 * This module re-exports the same helpers so existing
 * `require('@fabric/core/functions/fabricDocumentOfferEnvelope')` call sites keep working.
 *
 * @module functions/fabricDocumentOfferEnvelope
 * @see docs/FABRIC_DOCUMENT_OFFER.md
 */

const published = require('./publishedDocumentEnvelope');

module.exports = {
  FABRIC_DOCUMENT_OFFER: published.FABRIC_DOCUMENT_OFFER,
  FABRIC_DOCUMENT_OFFER_REQUEST: published.FABRIC_DOCUMENT_OFFER_REQUEST,
  FABRIC_DOCUMENT_OFFER_RESPONSE: published.FABRIC_DOCUMENT_OFFER_RESPONSE,
  FABRIC_DOCUMENT_OFFER_REPLY: published.FABRIC_DOCUMENT_OFFER_REPLY,
  TO_LEGACY_INVENTORY: published.TO_LEGACY_INVENTORY,
  fabricDocumentOfferEnvelopeToLegacy: published.fabricDocumentOfferEnvelopeToLegacy,
  normalizeFabricDocumentOfferEnvelopeForHandlers: published.normalizeFabricDocumentOfferEnvelopeForHandlers,
  isDocumentInventoryRequestType: published.isDocumentInventoryRequestType,
  isDocumentInventoryResponseType: published.isDocumentInventoryResponseType,
  isDocumentInventoryDocumentsOfferResponse: published.isDocumentInventoryDocumentsOfferResponse
};
