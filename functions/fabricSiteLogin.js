'use strict';

/**
 * @fileoverview Sign-in across trust boundaries with `fabric:<frame>` strings.
 *
 * - A site (relying party) puts a fresh `nonce` in a `SITE_LOGIN_REQUEST`
 *   (unsigned, or signed by the site's own key) and hands it to the user's
 *   signer — a browser extension, or a desktop app.
 * - The signer answers with a `SITE_LOGIN_RESPONSE` signed by the identity
 *   the user chose. The response names the origin the signer saw (never the
 *   one the page claimed), the site's nonce, and an expiry.
 * - A linked device that does not hold the chosen identity's key wraps the
 *   request in a `FABRIC_SIGN_REQUEST` (signed by the device, with its own
 *   nonce and expiry) and sends it to the desktop app that does.
 *
 * Core frames carry no audience, expiry, or replay protection, so every type
 * here carries `origin`, `nonce`, `issuedAt`, and `expiresAt`, and the readers
 * refuse expired frames and lifetimes over {@link SITE_LOGIN_MAX_TTL_MS}.
 * Replay protection for nonces is the caller's job (a site redeems its nonce
 * once; a desktop app keeps a seen-nonce cache until `expiresAt`).
 *
 * @module functions/fabricSiteLogin
 */

const Actor = require('../types/actor');
const Message = require('../types/message');
const Key = require('../types/key');
const { encodeFabricUri, decodeFabricUri } = require('./fabricUri');
const { fabricIdentityIdFromPubkeyHex } = require('./fabricIdentitySchnorr');
const { SITE_LOGIN_MAX_TTL_MS } = require('../constants');

/** Default lifetime of a request or response. */
const SITE_LOGIN_DEFAULT_TTL_MS = 2 * 60 * 1000;
/** Allowed clock difference between signer and verifier. */
const SITE_LOGIN_CLOCK_SKEW_MS = 30 * 1000;
/** Signer labels a response may carry. */
const SITE_LOGIN_SIGNERS = Object.freeze(['passport', 'hub', 'gooncitizen', 'desktop']);

/** @private */
const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
/** @private */
const MAX_PURPOSE_LENGTH = 256;
/** @private */
const MAX_CROSS_SIGN_LENGTH = 8192;

/**
 * Normalize a web origin: `http:` / `https:` only, no path, lowercase host.
 * @param {string} value
 * @returns {string|null} Origin, or `null` when unusable (including `"null"`).
 */
function normalizeSiteOrigin (value) {
  if (typeof value !== 'string' || !value.trim() || value.trim() === 'null') return null;
  let url;
  try {
    url = new URL(value.trim());
  } catch (_) {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password) return null;
  return url.origin;
}

/**
 * Fresh random nonce (32 bytes, hex).
 * @returns {string}
 */
function createSiteLoginNonce () {
  return Buffer.from(Actor.randomBytes(32)).toString('hex');
}

/**
 * @private
 * @param {*} value
 * @returns {number}
 */
function toMillis (value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

/**
 * @private
 * @param {number|undefined} ttlMs
 * @returns {number}
 */
function clampTtl (ttlMs) {
  const n = Number(ttlMs);
  if (!Number.isFinite(n) || n <= 0) return SITE_LOGIN_DEFAULT_TTL_MS;
  return Math.min(Math.floor(n), SITE_LOGIN_MAX_TTL_MS);
}

/**
 * Check `issuedAt` / `expiresAt` against `now`.
 * @private
 * @returns {string|null} error, or null when the window is acceptable
 */
function checkWindow (issuedAt, expiresAt, options = {}) {
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const skew = Number.isFinite(options.clockSkewMs) ? options.clockSkewMs : SITE_LOGIN_CLOCK_SKEW_MS;
  const maxTtl = Number.isFinite(options.maxTtlMs) ? Math.min(options.maxTtlMs, SITE_LOGIN_MAX_TTL_MS) : SITE_LOGIN_MAX_TTL_MS;
  if (!expiresAt) return 'missing expiresAt';
  if (expiresAt <= now - skew) return 'expired';
  if (issuedAt && issuedAt > now + skew) return 'issued in the future';
  if (expiresAt - now > maxTtl + skew) return 'expiry too far in the future';
  if (issuedAt && expiresAt - issuedAt > maxTtl) return 'lifetime too long';
  return null;
}

/**
 * @private
 * @param {Key} key
 */
function assertSigningKey (key) {
  if (!key || !key.private || typeof key.signSchnorrHash !== 'function') {
    throw new TypeError('a private signing Key is required');
  }
}

/**
 * @private
 * @param {string|Buffer|Message} input
 * @param {object} options decodeFabricUri options
 */
function decodeInput (input, options) {
  if (input instanceof Message) input = input.toBuffer();
  if (Buffer.isBuffer(input) || input instanceof Uint8Array) {
    input = encodeFabricUri(Buffer.from(input));
  }
  return decodeFabricUri(input, options);
}

/**
 * Build a `SITE_LOGIN_REQUEST` (what a site hands to the user's signer).
 * @param {Object} params
 * @param {string} params.origin The site's origin.
 * @param {string} [params.nonce] Server-issued nonce (generated when omitted).
 * @param {string} [params.purpose] Short text shown to the user.
 * @param {number} [params.ttlMs] Lifetime (capped at {@link SITE_LOGIN_MAX_TTL_MS}).
 * @param {number} [params.now]
 * @param {Key} [key] The site's key; omit for an unsigned request.
 * @returns {{ message: Message, uri: string, nonce: string, issuedAt: number, expiresAt: number }}
 */
function createSiteLoginRequest (params = {}, key = null) {
  const origin = normalizeSiteOrigin(params.origin);
  if (!origin) throw new TypeError('createSiteLoginRequest: http(s) origin required');
  const nonce = params.nonce != null ? String(params.nonce) : createSiteLoginNonce();
  if (!NONCE_PATTERN.test(nonce)) throw new TypeError('nonce must be 16-128 characters of [A-Za-z0-9_-]');
  const purpose = params.purpose != null ? String(params.purpose).slice(0, MAX_PURPOSE_LENGTH) : '';
  const issuedAt = Number.isFinite(params.now) ? params.now : Date.now();
  const expiresAt = issuedAt + clampTtl(params.ttlMs);
  const message = Message.fromFields('SITE_LOGIN_REQUEST', {
    origin,
    nonce,
    issuedAt: BigInt(issuedAt),
    expiresAt: BigInt(expiresAt),
    purpose
  });
  if (key) {
    assertSigningKey(key);
    message.signWithKey(key);
  }
  return { message, uri: encodeFabricUri(message), nonce, issuedAt, expiresAt };
}

/**
 * Read a `SITE_LOGIN_REQUEST`. `origin` here is only what the page claims.
 * @param {string|Buffer|Message} input
 * @param {Object} [options]
 * @param {number} [options.now]
 * @param {number} [options.maxTtlMs]
 * @returns {{ ok: true, request: { origin: string|null, nonce: string, issuedAt: number, expiresAt: number, purpose: string }, author: string|null, buffer: Buffer, message: Message }|{ ok: false, error: string }}
 */
function readSiteLoginRequest (input, options = {}) {
  const decoded = decodeInput(input, { allowedTypes: ['SITE_LOGIN_REQUEST'], allowUnsigned: true });
  if (!decoded.ok) return decoded;
  const fields = decoded.message.toFields();
  if (!fields) return { ok: false, error: 'malformed SITE_LOGIN_REQUEST body' };
  const nonce = String(fields.nonce || '');
  if (!NONCE_PATTERN.test(nonce)) return { ok: false, error: 'invalid nonce' };
  const issuedAt = toMillis(fields.issuedAt);
  const expiresAt = toMillis(fields.expiresAt);
  const windowError = checkWindow(issuedAt, expiresAt, options);
  if (windowError) return { ok: false, error: `request ${windowError}` };
  return {
    ok: true,
    request: {
      origin: normalizeSiteOrigin(fields.origin),
      nonce,
      issuedAt,
      expiresAt,
      purpose: String(fields.purpose || '').slice(0, MAX_PURPOSE_LENGTH)
    },
    author: decoded.author,
    buffer: decoded.buffer,
    message: decoded.message
  };
}

/**
 * Sign a `SITE_LOGIN_RESPONSE`.
 * @param {Object} params
 * @param {string} params.origin The origin the signer saw (never page-supplied).
 * @param {string} params.nonce The site's nonce, from the request.
 * @param {string} params.signer One of {@link SITE_LOGIN_SIGNERS}.
 * @param {string} [params.xpub] Extended public key of the signing key, when it has one.
 * @param {object|string} [params.crossSign] IdentityCrossSign linking this identity to another.
 * @param {number} [params.ttlMs]
 * @param {number} [params.now]
 * @param {Key} key The identity's private key.
 * @returns {{ message: Message, uri: string, identity: { id: string, pubkey: string, xpub: string|null }, issuedAt: number, expiresAt: number }}
 */
function signSiteLoginResponse (params = {}, key) {
  assertSigningKey(key);
  const origin = normalizeSiteOrigin(params.origin);
  if (!origin) throw new TypeError('signSiteLoginResponse: http(s) origin required');
  const nonce = String(params.nonce || '');
  if (!NONCE_PATTERN.test(nonce)) throw new TypeError('signSiteLoginResponse: invalid nonce');
  const signer = String(params.signer || '');
  if (!SITE_LOGIN_SIGNERS.includes(signer)) throw new TypeError(`signer must be one of ${SITE_LOGIN_SIGNERS.join(', ')}`);
  const pubkey = String(key.pubkey || '').toLowerCase();
  const identityId = fabricIdentityIdFromPubkeyHex(pubkey);
  const xpub = params.xpub ? String(params.xpub) : '';
  if (xpub) {
    const fromXpub = String(new Key({ xpub }).pubkey || '').toLowerCase();
    if (fromXpub !== pubkey) throw new Error('xpub does not match the signing key');
  }
  let crossSign = '';
  if (params.crossSign) {
    crossSign = typeof params.crossSign === 'string' ? params.crossSign : JSON.stringify(params.crossSign);
    if (crossSign.length > MAX_CROSS_SIGN_LENGTH) throw new RangeError('crossSign too large');
  }
  const issuedAt = Number.isFinite(params.now) ? params.now : Date.now();
  const expiresAt = issuedAt + clampTtl(params.ttlMs);
  const message = Message.fromFields('SITE_LOGIN_RESPONSE', {
    origin,
    nonce,
    issuedAt: BigInt(issuedAt),
    expiresAt: BigInt(expiresAt),
    identityId,
    pubkey,
    signer,
    xpub,
    crossSign
  });
  message.signWithKey(key);
  return {
    message,
    uri: encodeFabricUri(message),
    identity: { id: identityId, pubkey, xpub: xpub || null },
    issuedAt,
    expiresAt
  };
}

/**
 * Verify a `SITE_LOGIN_RESPONSE` for a site: signature, origin, nonce, expiry,
 * and that `pubkey` (and `xpub`, when present) belong to the author.
 * @param {string|Buffer|Message} input
 * @param {Object} expected
 * @param {string} expected.origin The site's own origin.
 * @param {string} expected.nonce The nonce the site issued (and has not redeemed yet).
 * @param {number} [expected.now]
 * @param {number} [expected.maxTtlMs]
 * @param {string[]} [expected.signers] Accept only these signer labels.
 * @returns {{ ok: true, identity: { id: string, pubkey: string, xpub: string|null }, signer: string, author: string, issuedAt: number, expiresAt: number, crossSign: object|null }|{ ok: false, error: string }}
 */
function verifySiteLoginResponse (input, expected = {}) {
  const origin = normalizeSiteOrigin(expected.origin);
  if (!origin) return { ok: false, error: 'expected origin required' };
  if (!expected.nonce) return { ok: false, error: 'expected nonce required' };
  const decoded = decodeInput(input, { allowedTypes: ['SITE_LOGIN_RESPONSE'] });
  if (!decoded.ok) return decoded;
  const fields = decoded.message.toFields();
  if (!fields) return { ok: false, error: 'malformed SITE_LOGIN_RESPONSE body' };
  if (normalizeSiteOrigin(fields.origin) !== origin) return { ok: false, error: 'origin mismatch' };
  if (String(fields.nonce) !== String(expected.nonce)) return { ok: false, error: 'nonce mismatch' };
  const issuedAt = toMillis(fields.issuedAt);
  const expiresAt = toMillis(fields.expiresAt);
  const windowError = checkWindow(issuedAt, expiresAt, expected);
  if (windowError) return { ok: false, error: `response ${windowError}` };
  const signer = String(fields.signer || '');
  if (!SITE_LOGIN_SIGNERS.includes(signer)) return { ok: false, error: 'unknown signer' };
  if (Array.isArray(expected.signers) && expected.signers.length && !expected.signers.includes(signer)) {
    return { ok: false, error: `signer ${signer} not accepted` };
  }
  const pubkey = String(fields.pubkey || '').toLowerCase();
  if (!/^0[23][0-9a-f]{64}$/.test(pubkey)) return { ok: false, error: 'invalid pubkey' };
  if (pubkey.slice(2) !== decoded.author) return { ok: false, error: 'pubkey does not match the frame author' };
  let identityId;
  try {
    identityId = fabricIdentityIdFromPubkeyHex(pubkey);
  } catch (_) {
    return { ok: false, error: 'invalid pubkey' };
  }
  if (String(fields.identityId) !== identityId) return { ok: false, error: 'identity id does not match pubkey' };
  const xpub = String(fields.xpub || '');
  if (xpub) {
    let fromXpub = '';
    try {
      fromXpub = String(new Key({ xpub }).pubkey || '').toLowerCase();
    } catch (_) {
      return { ok: false, error: 'invalid xpub' };
    }
    if (fromXpub !== pubkey) return { ok: false, error: 'xpub does not match pubkey' };
  }
  let crossSign = null;
  if (fields.crossSign) {
    try {
      crossSign = JSON.parse(fields.crossSign);
    } catch (_) {
      return { ok: false, error: 'malformed crossSign' };
    }
  }
  return {
    ok: true,
    identity: { id: identityId, pubkey, xpub: xpub || null },
    signer,
    author: decoded.author,
    issuedAt,
    expiresAt,
    crossSign
  };
}

/**
 * Wrap a site's request for a desktop app that holds the chosen identity.
 * @param {Object} params
 * @param {string|Buffer|Message} params.request The site's `SITE_LOGIN_REQUEST`.
 * @param {string} params.origin The origin the device saw (overrides the page's claim).
 * @param {string} [params.nonce] Fresh per sign request (generated when omitted).
 * @param {number} [params.ttlMs]
 * @param {number} [params.now]
 * @param {Key} key The linked device's key.
 * @returns {{ message: Message, uri: string, nonce: string, expiresAt: number }}
 */
function createFabricSignRequest (params = {}, key) {
  assertSigningKey(key);
  const origin = normalizeSiteOrigin(params.origin);
  if (!origin) throw new TypeError('createFabricSignRequest: http(s) origin required');
  const inner = readSiteLoginRequest(params.request, { now: params.now });
  if (!inner.ok) throw new Error(`createFabricSignRequest: ${inner.error}`);
  if (inner.request.origin !== origin) throw new Error('createFabricSignRequest: request names a different origin');
  const nonce = params.nonce != null ? String(params.nonce) : createSiteLoginNonce();
  if (!NONCE_PATTERN.test(nonce)) throw new TypeError('nonce must be 16-128 characters of [A-Za-z0-9_-]');
  const issuedAt = Number.isFinite(params.now) ? params.now : Date.now();
  const expiresAt = Math.min(issuedAt + clampTtl(params.ttlMs), inner.request.expiresAt);
  const message = Message.fromFields('FABRIC_SIGN_REQUEST', {
    origin,
    nonce,
    issuedAt: BigInt(issuedAt),
    expiresAt: BigInt(expiresAt),
    inner: inner.buffer
  });
  message.signWithKey(key);
  return { message, uri: encodeFabricUri(message), nonce, expiresAt };
}

/**
 * Read a `FABRIC_SIGN_REQUEST`: device signature, window, and the inner site request.
 * Whether the author may ask (identity cluster) and whether the nonce is fresh
 * are the desktop app's checks.
 * @param {string|Buffer|Message} input
 * @param {Object} [options]
 * @param {number} [options.now]
 * @param {number} [options.maxTtlMs]
 * @returns {{ ok: true, author: string, origin: string, nonce: string, issuedAt: number, expiresAt: number, request: object, requestAuthor: string|null }|{ ok: false, error: string }}
 */
function readFabricSignRequest (input, options = {}) {
  const decoded = decodeInput(input, { allowedTypes: ['FABRIC_SIGN_REQUEST'] });
  if (!decoded.ok) return decoded;
  const fields = decoded.message.toFields();
  if (!fields) return { ok: false, error: 'malformed FABRIC_SIGN_REQUEST body' };
  const origin = normalizeSiteOrigin(fields.origin);
  if (!origin) return { ok: false, error: 'invalid origin' };
  const nonce = String(fields.nonce || '');
  if (!NONCE_PATTERN.test(nonce)) return { ok: false, error: 'invalid nonce' };
  const issuedAt = toMillis(fields.issuedAt);
  const expiresAt = toMillis(fields.expiresAt);
  const windowError = checkWindow(issuedAt, expiresAt, options);
  if (windowError) return { ok: false, error: `sign request ${windowError}` };
  const inner = readSiteLoginRequest(fields.inner, options);
  if (!inner.ok) return { ok: false, error: `inner ${inner.error}` };
  if (inner.request.origin !== origin) return { ok: false, error: 'inner request names a different origin' };
  return {
    ok: true,
    author: decoded.author,
    origin,
    nonce,
    issuedAt,
    expiresAt,
    request: inner.request,
    requestAuthor: inner.author
  };
}

module.exports = {
  SITE_LOGIN_DEFAULT_TTL_MS,
  SITE_LOGIN_MAX_TTL_MS,
  SITE_LOGIN_CLOCK_SKEW_MS,
  SITE_LOGIN_SIGNERS,
  normalizeSiteOrigin,
  createSiteLoginNonce,
  createSiteLoginRequest,
  readSiteLoginRequest,
  signSiteLoginResponse,
  verifySiteLoginResponse,
  createFabricSignRequest,
  readFabricSignRequest
};
