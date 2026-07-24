'use strict';

/**
 * Single reference path for document buy / HTLC payment commitments.
 *
 * Wire / session field: **`contentHashHex`** (64 lowercase hex).
 * Aliases accepted on ingest: `contentHash`, `paymentHashHex`, `purchaseContentHashHex`.
 *
 * Binding modes:
 * - **sealed** — `SHA256(content key K)` (priced AES-GCM docs)
 * - **envelope** — `purchaseContentHashHex` = SHA256(SHA256(DocumentPublish AMP bytes))
 * - **blob** — `blobPaymentHashHex` (unsealed multi-blob settles only)
 */

const { purchaseContentHashHex } = require('./publishedDocumentEnvelope');
const { paymentHashHexFromKey } = require('./documentContentKey');
const { blobPaymentHashHex } = require('./documentBlobManifest');

const HEX64 = /^[0-9a-f]{64}$/;

/**
 * @param {unknown} value
 * @returns {string|null}
 */
function normalizeContentHashHex (value) {
  if (value == null || value === '') return null;
  const s = String(value).trim().toLowerCase();
  return HEX64.test(s) ? s : null;
}

/**
 * Read the buy/HTLC commitment from any common alias shape.
 * @param {object|null|undefined} obj
 * @returns {string|null}
 */
function contentHashHexFromObject (obj) {
  if (!obj || typeof obj !== 'object') return null;
  return normalizeContentHashHex(
    obj.contentHashHex ||
    obj.contentHash ||
    obj.paymentHashHex ||
    obj.purchaseContentHashHex
  );
}

/**
 * Resolve the payment commitment for a document (or one blob of an unsealed doc).
 *
 * Precedence: explicit content key → sealed meta → blob settle → DocumentPublish envelope.
 *
 * @param {object} opts
 * @param {string} [opts.documentId]
 * @param {object} [opts.parsed] hub/peer document record (required for envelope)
 * @param {Buffer|string} [opts.contentKey] 32-byte key or 64-hex
 * @param {object} [opts.sealedMeta] `{ paymentHashHex }` from prepareSealedSale / peer store
 * @param {string} [opts.sealedPaymentHashHex]
 * @param {boolean} [opts.sealed]
 * @param {{ index: number, blobHashHex: string }} [opts.blob] unsealed per-blob settle
 * @returns {{ contentHashHex: string, binding: 'sealed'|'envelope'|'blob' }}
 */
function resolveDocumentContentHashHex (opts = {}) {
  if (opts.contentKey != null && opts.contentKey !== '') {
    return {
      contentHashHex: paymentHashHexFromKey(opts.contentKey),
      binding: 'sealed'
    };
  }

  const sealedHex = normalizeContentHashHex(
    opts.sealedPaymentHashHex ||
    (opts.sealedMeta && opts.sealedMeta.paymentHashHex)
  );
  if (sealedHex && (opts.sealed === true || opts.sealedMeta || opts.sealedPaymentHashHex)) {
    return { contentHashHex: sealedHex, binding: 'sealed' };
  }

  const blob = opts.blob;
  if (blob && opts.documentId != null && blob.blobHashHex != null && blob.index != null) {
    return {
      contentHashHex: blobPaymentHashHex({
        documentId: opts.documentId,
        blobIndex: blob.index,
        blobHashHex: blob.blobHashHex
      }),
      binding: 'blob'
    };
  }

  const documentId = opts.documentId != null ? String(opts.documentId) : '';
  if (!documentId || !opts.parsed || typeof opts.parsed !== 'object') {
    throw new Error('resolveDocumentContentHashHex: documentId and parsed required for envelope binding');
  }
  return {
    contentHashHex: purchaseContentHashHex(documentId, opts.parsed),
    binding: 'envelope'
  };
}

module.exports = {
  HEX64,
  normalizeContentHashHex,
  contentHashHexFromObject,
  resolveDocumentContentHashHex,
  // Re-exports so callers can import one module for the full chain.
  purchaseContentHashHex,
  paymentHashHexFromKey,
  blobPaymentHashHex
};
