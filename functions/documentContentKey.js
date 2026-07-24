'use strict';

/**
 * Content-key sealing for priced Document market documents.
 * Ciphertext-at-rest: AES-256-GCM; HTLC preimage = 32-byte content key K.
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

module.exports = {
  SCHEME,
  sealPlaintext,
  openCiphertext,
  paymentHashHexFromKey,
  isSealedDocument,
  contentKeyStorePath,
  readContentKey,
  writeContentKey
};
