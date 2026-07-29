'use strict';

/**
 * Sealed document sale helpers (AES-GCM content key + HTLC payment hash).
 *
 * Includes content-key primitives formerly in `documentContentKey.js`:
 * ciphertext-at-rest AES-256-GCM; HTLC preimage = 32-byte content key K.
 *
 * Atomic shape:
 * 1. Seller seals plaintext with random K; advertises paymentHash = SHA256(K).
 * 2. Ciphertext blobs may be delivered anytime (useless without K).
 * 3. K is revealed only when the buyer proves payment intent (matching
 *    contentHashHex on DocumentRequest) — typically after L1 HTLC funding.
 * 4. Buyer verifies ciphertext Tree root, then opens with K.
 * 5. If K never arrives, buyer refunds after HTLC locktime (seller cannot
 *    claim without revealing K on-chain either).
 */

const crypto = require('crypto');

const SCHEME = 'aes-256-gcm-content-v1';

/**
 * @param {Buffer} plaintext
 * @returns {{ key: Buffer, iv: Buffer, ciphertext: Buffer, contentSha256: string, encryption: object }}
 */
function sealPlaintext (plaintext) {
  const buf = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(plaintext);
  const key = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(buf), cipher.final()]);
  const tag = cipher.getAuthTag();
  const ciphertext = Buffer.concat([enc, tag]);
  const contentSha256 = crypto.createHash('sha256').update(ciphertext).digest('hex');
  return {
    key,
    iv,
    ciphertext,
    contentSha256,
    encryption: {
      scheme: SCHEME,
      iv: iv.toString('base64'),
      contentSha256
    }
  };
}

/**
 * @param {Buffer} ciphertextWithTag
 * @param {Buffer} key32
 * @param {Buffer|string} iv - 12-byte Buffer or base64 string
 * @returns {Buffer}
 */
function openCiphertext (ciphertextWithTag, key32, iv) {
  const ct = Buffer.isBuffer(ciphertextWithTag) ? ciphertextWithTag : Buffer.from(ciphertextWithTag);
  const key = Buffer.isBuffer(key32) ? key32 : Buffer.from(String(key32), 'hex');
  if (key.length !== 32) throw new Error('content key must be 32 bytes');
  const ivBuf = Buffer.isBuffer(iv) ? iv : Buffer.from(String(iv), 'base64');
  if (ivBuf.length !== 12) throw new Error('IV must be 12 bytes');
  if (ct.length < 16) throw new Error('ciphertext too short');
  const tag = ct.subarray(ct.length - 16);
  const data = ct.subarray(0, ct.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, ivBuf);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

/**
 * @param {Buffer|string} key32
 * @returns {string} lowercase hex SHA-256(K)
 */
function paymentHashHexFromKey (key32) {
  const key = Buffer.isBuffer(key32) ? key32 : Buffer.from(String(key32), 'hex');
  return crypto.createHash('sha256').update(key).digest('hex');
}

/**
 * @param {object|null|undefined} doc
 * @returns {boolean}
 */
function isSealedDocument (doc) {
  return !!(doc && doc.encryption && doc.encryption.scheme === SCHEME);
}

/**
 * Hub filesystem path for the content key (never published).
 * @param {string} documentId
 * @returns {string}
 */
function contentKeyStorePath (documentId) {
  return `documents/${String(documentId)}.content-key`;
}

/**
 * @param {{ readFile: Function }} fs
 * @param {string} documentId
 * @returns {Buffer|null}
 */
function readContentKey (fs, documentId) {
  if (!fs || typeof fs.readFile !== 'function') return null;
  try {
    const raw = fs.readFile(contentKeyStorePath(documentId));
    if (!raw) return null;
    let parsed = raw;
    if (Buffer.isBuffer(raw)) {
      try {
        parsed = JSON.parse(raw.toString('utf8'));
      } catch (_) {
        const hex = raw.toString('utf8').trim();
        if (/^[0-9a-fA-F]{64}$/.test(hex)) return Buffer.from(hex, 'hex');
        return null;
      }
    } else if (typeof raw === 'string') {
      try {
        parsed = JSON.parse(raw);
      } catch (_) {
        if (/^[0-9a-fA-F]{64}$/.test(raw.trim())) return Buffer.from(raw.trim(), 'hex');
        return null;
      }
    }
    const hex = parsed && (parsed.keyHex || parsed.preimageHex || parsed.key);
    if (!hex || !/^[0-9a-fA-F]{64}$/.test(String(hex))) return null;
    return Buffer.from(String(hex), 'hex');
  } catch (_) {
    return null;
  }
}

/**
 * @param {{ publish: Function }} fs
 * @param {string} documentId
 * @param {Buffer} key32
 * @returns {Promise<void>}
 */
async function writeContentKey (fs, documentId, key32) {
  const key = Buffer.isBuffer(key32) ? key32 : Buffer.from(String(key32), 'hex');
  if (key.length !== 32) throw new Error('content key must be 32 bytes');
  await fs.publish(contentKeyStorePath(documentId), {
    type: 'DocumentContentKey',
    documentId: String(documentId),
    keyHex: key.toString('hex'),
    scheme: SCHEME,
    created: new Date().toISOString()
  });
}
const { splitBlobs, advertiseDocumentBlobs } = require('./documentBlobManifest');

const KEY_REVEAL_TYPE = 'DocumentContentKeyReveal';

/**
 * @param {Buffer|string} plaintext
 * @returns {{
 *   key: Buffer,
 *   keyHex: string,
 *   paymentHashHex: string,
 *   ciphertext: Buffer,
 *   encryption: object,
 *   plaintextSha256: string
 * }}
 */
function prepareSealedSale (plaintext) {
  const plain = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(plaintext == null ? '' : plaintext);
  const sealed = sealPlaintext(plain);
  return {
    key: sealed.key,
    keyHex: sealed.key.toString('hex'),
    paymentHashHex: paymentHashHexFromKey(sealed.key),
    ciphertext: sealed.ciphertext,
    encryption: sealed.encryption,
    plaintextSha256: crypto.createHash('sha256').update(plain).digest('hex')
  };
}

/**
 * Inventory + blob advertisement over **ciphertext** with HTLC hash = SHA256(K).
 * @param {object} sale from {@link prepareSealedSale}
 * @param {object} [opts]
 */
function advertiseSealedDocument (sale, opts = {}) {
  const documentId = opts.documentId != null ? String(opts.documentId) : undefined;
  const rateSats = Number(opts.rateSats) || 0;
  const pay = String(sale.paymentHashHex).toLowerCase();
  const advertised = advertiseDocumentBlobs(sale.ciphertext, {
    documentId,
    chunkBytes: opts.chunkBytes,
    rateSats,
    // Sealed sales bind one HTLC to SHA256(K) — never per-blob tagged hashes.
    includePaymentHashes: false
  });
  for (const b of advertised.itemBlobs || []) {
    b.contentHash = pay;
    b.contentHashHex = pay;
  }
  if (advertised.index && Array.isArray(advertised.index.blobs)) {
    for (const b of advertised.index.blobs) {
      b.contentHash = pay;
      b.contentHashHex = pay;
    }
  }
  return {
    ...advertised,
    contentHash: pay,
    contentHashHex: pay,
    paymentHashHex: pay,
    sealed: true,
    encryption: sale.encryption,
    plaintextSha256: sale.plaintextSha256
  };
}

/**
 * @param {object} opts
 * @returns {object} GenericMessage-shaped body
 */
function buildKeyRevealMessage (opts = {}) {
  const documentId = String(opts.documentId || '').trim();
  const keyHex = String(opts.keyHex || '').trim().toLowerCase();
  const paymentHashHex = String(opts.paymentHashHex || '').trim().toLowerCase();
  if (!documentId) throw new Error('documentId required');
  if (!/^[0-9a-f]{64}$/.test(keyHex)) throw new Error('keyHex must be 64 hex chars');
  if (!/^[0-9a-f]{64}$/.test(paymentHashHex)) throw new Error('paymentHashHex must be 64 hex chars');
  if (paymentHashHexFromKey(keyHex) !== paymentHashHex) {
    throw new Error('paymentHashHex does not match key');
  }
  return {
    type: KEY_REVEAL_TYPE,
    object: {
      documentId,
      keyHex,
      paymentHashHex,
      iv: opts.iv != null ? String(opts.iv) : null,
      scheme: opts.scheme || SCHEME,
      plaintextSha256: opts.plaintextSha256 || null,
      settlementId: opts.settlementId || null
    }
  };
}

/**
 * @param {object} reveal object from DocumentContentKeyReveal
 * @param {Buffer|string} ciphertext
 * @returns {{ ok: boolean, plaintext?: Buffer, error?: string }}
 */
function openSealedDelivery (reveal, ciphertext) {
  if (!reveal || typeof reveal !== 'object') return { ok: false, error: 'missing reveal' };
  const keyHex = String(reveal.keyHex || '').trim().toLowerCase();
  const paymentHashHex = String(reveal.paymentHashHex || '').trim().toLowerCase();
  const iv = reveal.iv;
  if (!/^[0-9a-f]{64}$/.test(keyHex)) return { ok: false, error: 'invalid keyHex' };
  if (paymentHashHex && paymentHashHexFromKey(keyHex) !== paymentHashHex) {
    return { ok: false, error: 'key does not match paymentHashHex' };
  }
  try {
    const plaintext = openCiphertext(ciphertext, keyHex, iv);
    if (reveal.plaintextSha256) {
      const got = crypto.createHash('sha256').update(plaintext).digest('hex');
      if (got !== String(reveal.plaintextSha256).toLowerCase()) {
        return { ok: false, error: 'plaintextSha256 mismatch' };
      }
    }
    return { ok: true, plaintext };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

/**
 * True when a DocumentRequest carries the advertised payment hash (catalog match only).
 * This is **not** payment proof — `paymentHashHex` is public in inventory.
 * @param {object} parsed request body
 * @param {string} paymentHashHex seller's SHA256(K)
 */
function requestMatchesPaymentHash (parsed, paymentHashHex) {
  if (!parsed || !paymentHashHex) return false;
  const got = String(parsed.contentHashHex || parsed.paymentHashHex || '').trim().toLowerCase();
  return got === String(paymentHashHex).toLowerCase();
}

/**
 * True when a DocumentRequest may unlock the AES content key.
 * Requires a matching payment hash **and** verified settlement authorization
 * (`opts.settlementVerified`). Echoing the public inventory hash alone must never
 * reveal `K`.
 * @param {object} parsed request body
 * @param {string} paymentHashHex seller's SHA256(K)
 * @param {{ settlementVerified?: boolean }} [opts]
 */
function requestUnlocksContentKey (parsed, paymentHashHex, opts = {}) {
  if (!requestMatchesPaymentHash(parsed, paymentHashHex)) return false;
  return opts.settlementVerified === true;
}

/**
 * Apply an on-chain (or Fabric) revealed preimage to open sealed ciphertext.
 * @param {object} opts
 * @param {Buffer|string} opts.ciphertext
 * @param {string} opts.preimageHex 32-byte key as hex (HTLC claim witness)
 * @param {string} opts.paymentHashHex
 * @param {string} [opts.iv]
 * @param {string} [opts.plaintextSha256]
 * @returns {{ ok: boolean, plaintext?: Buffer, keyHex?: string, error?: string }}
 */
function openWithClaimPreimage (opts = {}) {
  const preimageHex = String(opts.preimageHex || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(preimageHex)) {
    return { ok: false, error: 'preimageHex must be 64 hex chars' };
  }
  const paymentHashHex = String(opts.paymentHashHex || '').trim().toLowerCase();
  if (paymentHashHex && paymentHashHexFromKey(preimageHex) !== paymentHashHex) {
    return { ok: false, error: 'preimage does not match paymentHashHex' };
  }
  return openSealedDelivery({
    keyHex: preimageHex,
    paymentHashHex: paymentHashHex || paymentHashHexFromKey(preimageHex),
    iv: opts.iv,
    plaintextSha256: opts.plaintextSha256
  }, opts.ciphertext);
}

module.exports = {
  KEY_REVEAL_TYPE,
  SCHEME,
  sealPlaintext,
  openCiphertext,
  paymentHashHexFromKey,
  isSealedDocument,
  contentKeyStorePath,
  readContentKey,
  writeContentKey,
  prepareSealedSale,
  advertiseSealedDocument,
  buildKeyRevealMessage,
  openSealedDelivery,
  openWithClaimPreimage,
  requestMatchesPaymentHash,
  requestUnlocksContentKey,
  splitBlobs
};
