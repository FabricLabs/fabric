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
 *
 * **Per-buyer payment hashes** (`DocumentBlobQuote`). Settling on the static
 * hash `SHA256(K_i)` puts `K_i` in a public claim witness (and in every hop of
 * a forwarded channel HTLC), after which anyone holding the free ciphertext
 * can decrypt blob i. A quote instead binds the HTLC to a fresh secret `s`
 * the seller draws for one buyer: `paymentHash = SHA256(s)` and the buyer is
 * handed `wrappedKey = K_i XOR HMAC-SHA256(s, tag || documentId || root ||
 * blobIndex)`. Revealing `s` (claim witness / channel fulfil) only lets the
 * holder of `wrappedKey` recover `K_i`, which is checked against the
 * committed `SHA256(K_i)`. Unlike the static hash this is not atomic: a
 * seller can quote a `wrappedKey` that does not unwrap. The signed quote plus
 * the public `s` is then a self-contained fraud proof (`checkBlobQuote`).
 *
 * **Convergent sealing** (`CONVERGENT_SCHEME`). The key is derived from the
 * plaintext — `K = taggedHash(CONVERGENT_KEY_TAG, mode || secret? || plaintext)`
 * — and the IV from the key, so the same plaintext seals to the same
 * ciphertext, blob hash, and payment hash for every seller. Identical chunks
 * de-duplicate by construction. An optional convergence secret scopes that
 * to whoever holds it (a community), which blunts confirmation-of-file
 * guesses. Random keys (`SCHEME`) remain the private mode.
 */

const crypto = require('crypto');
const taggedHash = require('./taggedHash');

const SCHEME = 'aes-256-gcm-content';
const CONVERGENT_SCHEME = 'aes-256-gcm-convergent';
const CONVERGENT_KEY_TAG = 'Fabric/DocumentConvergentKey';
const CONVERGENT_IV_TAG = 'Fabric/DocumentConvergentIv';
const SEALED_SCHEMES = Object.freeze([SCHEME, CONVERGENT_SCHEME]);

/**
 * Normalize a convergence secret to 32 bytes (`SHA256` of whatever was given).
 * @param {Buffer|string|null|undefined} secret
 * @returns {Buffer|null}
 * @private
 */
function _convergenceSecret (secret) {
  if (secret == null || secret === '') return null;
  const buf = Buffer.isBuffer(secret) ? secret : Buffer.from(String(secret), 'utf8');
  if (!buf.length) return null;
  return crypto.createHash('sha256').update(buf).digest();
}

/**
 * Content-derived key for one chunk. A leading mode byte keeps the public
 * and secret-scoped namespaces disjoint.
 * @param {Buffer|string} plaintext
 * @param {Buffer|string} [secret] convergence secret (community scope)
 * @returns {Buffer} 32-byte key
 */
function convergentKey (plaintext, secret) {
  const plain = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(plaintext == null ? '' : plaintext);
  const scope = _convergenceSecret(secret);
  const head = scope ? Buffer.concat([Buffer.from([1]), scope]) : Buffer.from([0]);
  return taggedHash(CONVERGENT_KEY_TAG, Buffer.concat([head, plain]));
}

/**
 * IV for a convergent key (a key is only ever used for one plaintext).
 * @param {Buffer|string} key32
 * @returns {Buffer} 12-byte IV
 */
function convergentIv (key32) {
  const key = Buffer.isBuffer(key32) ? key32 : Buffer.from(String(key32), 'hex');
  if (key.length !== 32) throw new Error('content key must be 32 bytes');
  return taggedHash(CONVERGENT_IV_TAG, key).subarray(0, 12);
}

/**
 * True when `keyHex` (and `iv`, when given) are the convergent derivation of
 * `plaintext` — the chunk is the canonical one for its content.
 * @param {Buffer} plaintext
 * @param {Buffer|string} keyHex
 * @param {Object} [opts]
 * @param {Buffer|string} [opts.iv] base64 or Buffer
 * @param {Buffer|string} [opts.secret]
 * @returns {boolean}
 */
function isConvergentKey (plaintext, keyHex, opts = {}) {
  const key = Buffer.isBuffer(keyHex) ? keyHex : Buffer.from(String(keyHex || ''), 'hex');
  if (key.length !== 32) return false;
  const derived = convergentKey(plaintext, opts.secret);
  if (!crypto.timingSafeEqual(derived, key)) return false;
  if (opts.iv == null) return true;
  const iv = Buffer.isBuffer(opts.iv) ? opts.iv : Buffer.from(String(opts.iv), 'base64');
  return iv.length === 12 && iv.equals(convergentIv(key));
}

/**
 * @param {Buffer} plaintext
 * @param {Object} [opts]
 * @param {boolean} [opts.convergent] derive key and IV from the content
 * @param {Buffer|string} [opts.secret] convergence secret (with `convergent`)
 * @returns {{ key: Buffer, iv: Buffer, ciphertext: Buffer, contentSha256: string, encryption: object }}
 */
function sealPlaintext (plaintext, opts = {}) {
  const buf = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(plaintext);
  const convergent = opts.convergent === true;
  const key = convergent ? convergentKey(buf, opts.secret) : crypto.randomBytes(32);
  const iv = convergent ? convergentIv(key) : crypto.randomBytes(12);
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
      scheme: convergent ? CONVERGENT_SCHEME : SCHEME,
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
  return !!(doc && doc.encryption && SEALED_SCHEMES.includes(doc.encryption.scheme));
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
const { splitBlobs, advertiseDocumentBlobs, merkleRootHexFromBlobHashes } = require('./documentBlobManifest');

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
  // Every leaf commits SHA256(K): the root binds the ciphertext to the key sold.
  const merkleRootHex = merkleRootHexFromBlobHashes(
    (advertised.blobs || []).map((b) => b.blobHashHex),
    { paymentHashHex: pay }
  );
  advertised.merkleRootHex = merkleRootHex;
  if (advertised.index) advertised.index.merkleRootHex = merkleRootHex;
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
  // No plaintextSha256: a public plaintext digest is a confirmation oracle
  // for guessable content. It travels only with the key reveal.
  return {
    ...advertised,
    contentHash: pay,
    contentHashHex: pay,
    paymentHashHex: pay,
    sealed: true,
    encryption: sale.encryption
  };
}

const BLOB_QUOTE_TYPE = 'DocumentBlobQuote';
const BLOB_KEY_WRAP_TAG = 'Fabric/DocumentBlobKeyWrap';
const HEX64 = /^[0-9a-f]{64}$/;

/**
 * @param {*} v
 * @param {string} name
 * @returns {Buffer}
 * @private
 */
function _key32 (v, name) {
  const s = Buffer.isBuffer(v) ? v.toString('hex') : String(v == null ? '' : v).trim().toLowerCase();
  if (!HEX64.test(s)) throw new Error(`${name} must be 64 hex chars`);
  return Buffer.from(s, 'hex');
}

/**
 * Key-wrap pad for one blob: `HMAC-SHA256(s, tag || 0 || documentId || 0 || root || uint32be(blobIndex))`.
 * @param {Buffer} secret
 * @param {Object} opts `{ documentId, merkleRootHex, blobIndex }`
 * @returns {Buffer}
 * @private
 */
function _blobKeyWrapPad (secret, opts = {}) {
  const index = Math.round(Number(opts.blobIndex));
  if (!Number.isInteger(index) || index < 0) throw new Error('blobIndex must be >= 0');
  const root = String(opts.merkleRootHex || '').trim().toLowerCase();
  const count = Buffer.alloc(4);
  count.writeUInt32BE(index >>> 0, 0);
  return crypto.createHmac('sha256', secret).update(Buffer.concat([
    Buffer.from(BLOB_KEY_WRAP_TAG, 'utf8'),
    Buffer.from([0]),
    Buffer.from(String(opts.documentId || ''), 'utf8'),
    Buffer.from([0]),
    HEX64.test(root) ? Buffer.from(root, 'hex') : Buffer.alloc(0),
    count
  ])).digest();
}

/**
 * Wrap `K_i` under a per-buyer secret `s` (see the file overview).
 * @param {Object} opts
 * @param {string} opts.keyHex `K_i`
 * @param {string} opts.secretHex `s` (the HTLC preimage)
 * @param {string} opts.documentId
 * @param {string} [opts.merkleRootHex]
 * @param {number} opts.blobIndex
 * @returns {string} wrapped key (64 hex)
 */
function wrapBlobKey (opts = {}) {
  const key = _key32(opts.keyHex, 'keyHex');
  const pad = _blobKeyWrapPad(_key32(opts.secretHex, 'secretHex'), opts);
  const out = Buffer.alloc(32);
  for (let i = 0; i < 32; i++) out[i] = key[i] ^ pad[i];
  return out.toString('hex');
}

/**
 * Recover `K_i` from a wrapped key once `s` is known.
 * @param {Object} opts `{ wrappedKeyHex, secretHex, documentId, merkleRootHex?, blobIndex, keyHashHex? }`
 * @returns {{ ok: boolean, keyHex: (string|undefined), error: (string|undefined) }}
 */
function unwrapBlobKey (opts = {}) {
  try {
    const keyHex = wrapBlobKey(Object.assign({}, opts, { keyHex: opts.wrappedKeyHex }));
    const want = opts.keyHashHex ? String(opts.keyHashHex).trim().toLowerCase() : null;
    if (want && paymentHashHexFromKey(keyHex) !== want) return { ok: false, error: 'unwrapped key does not match keyHashHex' };
    return { ok: true, keyHex };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

/**
 * Seller side: a per-buyer quote for one sealed blob. Keep `secretHex`
 * private (it is the HTLC preimage); send only `quote` to the buyer, over a
 * signed message so a bad `wrappedKeyHex` is attributable.
 * @param {Object} opts
 * @param {string} opts.documentId
 * @param {string} [opts.merkleRootHex]
 * @param {number} opts.blobIndex
 * @param {string} [opts.blobHashHex]
 * @param {string} opts.keyHex `K_i`
 * @param {number} [opts.amountSats]
 * @param {number} [opts.expiresAt] epoch ms
 * @param {string} [opts.secretHex] fixed `s` (tests); random by default
 * @returns {{ quote: Object, secretHex: string }}
 */
function createBlobQuote (opts = {}) {
  const documentId = String(opts.documentId || '').trim();
  if (!documentId) throw new Error('documentId required');
  const key = _key32(opts.keyHex, 'keyHex');
  const secret = opts.secretHex ? _key32(opts.secretHex, 'secretHex') : crypto.randomBytes(32);
  const merkleRootHex = opts.merkleRootHex ? String(opts.merkleRootHex).toLowerCase() : null;
  const blobIndex = Math.round(Number(opts.blobIndex));
  const quote = {
    type: BLOB_QUOTE_TYPE,
    documentId,
    merkleRootHex,
    blobIndex,
    blobHashHex: opts.blobHashHex ? String(opts.blobHashHex).toLowerCase() : null,
    keyHashHex: paymentHashHexFromKey(key),
    paymentHashHex: paymentHashHexFromKey(secret),
    wrappedKeyHex: wrapBlobKey({ keyHex: key, secretHex: secret, documentId, merkleRootHex, blobIndex }),
    amountSats: Math.max(0, Math.floor(Number(opts.amountSats) || 0)),
    expiresAt: Number(opts.expiresAt) > 0 ? Number(opts.expiresAt) : null
  };
  return { quote, secretHex: secret.toString('hex') };
}

/**
 * Shape check for a received quote (no secrets involved).
 * @param {Object} quote
 * @returns {boolean}
 */
function isWellFormedBlobQuote (quote) {
  if (!quote || typeof quote !== 'object') return false;
  if (!String(quote.documentId || '').trim()) return false;
  if (!Number.isInteger(Number(quote.blobIndex)) || Number(quote.blobIndex) < 0) return false;
  for (const k of ['keyHashHex', 'paymentHashHex', 'wrappedKeyHex']) {
    if (!HEX64.test(String(quote[k] || '').toLowerCase())) return false;
  }
  return String(quote.keyHashHex).toLowerCase() !== String(quote.paymentHashHex).toLowerCase();
}

/**
 * Buyer side, after payment: recover `K_i` from a quote with the revealed
 * preimage `s`. `ok: false` with `fraud: true` means `s` is the paid
 * preimage but the quote's wrapped key does not open to `keyHashHex` — the
 * signed quote plus `s` prove the seller cheated.
 * @param {Object} opts
 * @param {Object} opts.quote from {@link createBlobQuote}
 * @param {string} opts.preimageHex `s`
 * @param {string} [opts.keyHashHex] committed `SHA256(K_i)` (defaults to `quote.keyHashHex`)
 * @returns {{ ok: boolean, keyHex: (string|undefined), error: (string|undefined), fraud: (boolean|undefined) }}
 */
function checkBlobQuote (opts = {}) {
  const quote = opts.quote;
  if (!isWellFormedBlobQuote(quote)) return { ok: false, error: 'malformed quote' };
  let pre;
  try {
    pre = _key32(opts.preimageHex, 'preimageHex');
  } catch (err) {
    return { ok: false, error: err.message };
  }
  if (paymentHashHexFromKey(pre) !== String(quote.paymentHashHex).toLowerCase()) {
    return { ok: false, error: 'preimage does not match quote paymentHashHex' };
  }
  const keyHashHex = String(opts.keyHashHex || quote.keyHashHex).toLowerCase();
  if (keyHashHex !== String(quote.keyHashHex).toLowerCase()) {
    return { ok: false, error: 'quote keyHashHex is not the committed key hash', fraud: true };
  }
  const out = unwrapBlobKey({
    wrappedKeyHex: quote.wrappedKeyHex,
    secretHex: pre,
    documentId: quote.documentId,
    merkleRootHex: quote.merkleRootHex,
    blobIndex: quote.blobIndex,
    keyHashHex
  });
  return out.ok ? out : Object.assign(out, { fraud: true });
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
 * True when a DocumentContentKeyReveal object carries a 32-byte key that is the
 * SHA-256 preimage of its declared `paymentHashHex`. Public inventory hashes
 * alone must not occupy logical-register slots or reverse-relay paths.
 * @param {object|null|undefined} reveal
 * @returns {boolean}
 */
function isWellFormedKeyReveal (reveal) {
  if (!reveal || typeof reveal !== 'object') return false;
  const documentId = String(reveal.documentId || '').trim();
  const keyHex = String(reveal.keyHex || '').trim().toLowerCase();
  const paymentHashHex = String(reveal.paymentHashHex || '').trim().toLowerCase();
  if (!documentId) return false;
  if (!/^[0-9a-f]{64}$/.test(keyHex)) return false;
  if (!/^[0-9a-f]{64}$/.test(paymentHashHex)) return false;
  return paymentHashHexFromKey(keyHex) === paymentHashHex;
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
  BLOB_QUOTE_TYPE,
  SCHEME,
  CONVERGENT_SCHEME,
  SEALED_SCHEMES,
  convergentKey,
  convergentIv,
  isConvergentKey,
  wrapBlobKey,
  unwrapBlobKey,
  createBlobQuote,
  isWellFormedBlobQuote,
  checkBlobQuote,
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
  isWellFormedKeyReveal,
  openSealedDelivery,
  openWithClaimPreimage,
  requestMatchesPaymentHash,
  requestUnlocksContentKey,
  splitBlobs
};
