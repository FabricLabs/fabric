'use strict';

const assert = require('assert');
const {
  FABRIC_DOCUMENT_OFFER,
  FABRIC_DOCUMENT_OFFER_RESPONSE,
  isDocumentInventoryDocumentsOfferResponse,
  isDocumentInventoryRequestType,
  isDocumentInventoryResponseType,
  normalizeFabricDocumentOfferEnvelopeForHandlers
} = require('../functions/publishedDocumentEnvelope');

describe('@fabric/core publishedDocumentEnvelope (document-offer aliases)', function () {
  it('accepts legacy and Fabric document-offer request types', function () {
    assert.strictEqual(isDocumentInventoryRequestType('INVENTORY_REQUEST'), true);
    assert.strictEqual(isDocumentInventoryRequestType(FABRIC_DOCUMENT_OFFER), true);
    assert.strictEqual(isDocumentInventoryRequestType('P2P_CHAT_MESSAGE'), false);
  });

  it('accepts legacy and Fabric document-offer response types', function () {
    assert.strictEqual(isDocumentInventoryResponseType('INVENTORY_RESPONSE'), true);
    assert.strictEqual(isDocumentInventoryResponseType(FABRIC_DOCUMENT_OFFER_RESPONSE), true);
    assert.strictEqual(isDocumentInventoryResponseType('INVENTORY_REQUEST'), false);
  });

  it('detects documents inventory merge shape for both legacy and Fabric response type', function () {
    assert.strictEqual(isDocumentInventoryDocumentsOfferResponse({
      type: 'INVENTORY_RESPONSE',
      object: { kind: 'documents', items: [] }
    }), true);
    assert.strictEqual(isDocumentInventoryDocumentsOfferResponse({
      type: FABRIC_DOCUMENT_OFFER_RESPONSE,
      object: { kind: 'documents', items: [] }
    }), true);
    assert.strictEqual(isDocumentInventoryDocumentsOfferResponse({
      type: FABRIC_DOCUMENT_OFFER_RESPONSE,
      object: { kind: 'mainchain', items: [] }
    }), false);
  });

  it('normalizes Fabric envelope types to legacy INVENTORY_* for Peer handlers', function () {
    const req = { type: FABRIC_DOCUMENT_OFFER, object: { kind: 'documents' } };
    const nr = normalizeFabricDocumentOfferEnvelopeForHandlers(req);
    assert.strictEqual(nr.type, 'INVENTORY_REQUEST');
    assert.strictEqual(nr.object, req.object);

    const res = { type: FABRIC_DOCUMENT_OFFER_RESPONSE, object: {} };
    const nres = normalizeFabricDocumentOfferEnvelopeForHandlers(res);
    assert.strictEqual(nres.type, 'INVENTORY_RESPONSE');

    assert.strictEqual(
      normalizeFabricDocumentOfferEnvelopeForHandlers({ type: 'INVENTORY_REQUEST' }).type,
      'INVENTORY_REQUEST'
    );
  });
});
