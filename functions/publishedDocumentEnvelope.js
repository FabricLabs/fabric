'use strict';

/**
 * Canonical Fabric `DocumentPublish` wire bytes for a stored document record.
 * Used by hub.fabric.pub for inventory HTLC preimage and CreatePurchaseInvoice / ClaimPurchase `contentHash`.
 *
 * preimage (32 bytes) = SHA256(Message.toBuffer())
 * payment hash / contentHash hex = SHA256(preimage)
 */

const crypto = require('crypto');
const Message = require('../types/message');

function fabricCanonicalJson (value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map((v) => fabricCanonicalJson(v)).join(',') + ']';
  }
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + fabricCanonicalJson(value[k])).join(',') + '}';
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
  purchaseContentHashHex
};
