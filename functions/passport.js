'use strict';

/**
 * @fileoverview Passport v2: sign in to a web service with a Fabric identity.
 *
 * - The site (relying party) issues a `PASSPORT_CHALLENGE` for its own origin
 *   with a fresh 32-byte nonce, optionally naming its network and asking for
 *   the user's wallet or cosigner key.
 * - The signer (Passport, or a desktop app it has paired with) answers with a
 *   `PASSPORT_ASSERTION` signed by the identity key. It names the origin the
 *   signer saw, the nonce, the sha256 of the challenge frame, and the network
 *   whose paths it used. Wallet xpubs and the cosigner key are included only
 *   when the challenge asked and the user agreed.
 * - Passport asks a desktop app to answer for it with a `PASSPORT_SIGN_REQUEST`
 *   signed by the Passport device, carrying the challenge and the disclosures
 *   the user agreed to.
 *
 * Every frame carries `origin`, `nonce`, `issuedAt`, and `expiresAt`; readers
 * refuse lifetimes over {@link PASSPORT_MAX_TTL_MS}. Redeeming a nonce once is
 * the caller's job. These frames cross trust boundaries as `fabric:` strings
 * and are never relayed on the mesh.
 *
 * @module functions/passport
 */

const crypto = require('crypto');
const Actor = require('../types/actor');
const Message = require('../types/message');
const Key = require('../types/key');
const { encodeFabricUri, decodeFabricUri } = require('./fabricUri');
const { fabricIdentityIdFromPubkeyHex } = require('./fabricIdentitySchnorr');
const {
  normalizeAccountNetwork,
  extendedKeyForNetwork,
  walletDescriptors,
  cosignerProof,
  verifyCosignerProof
} = require('./accountKeys');
const { PASSPORT_MAX_TTL_MS } = require('../constants');

/** Protocol version carried in every frame. */
const PASSPORT_VERSION = 2;
/** Default lifetime of a challenge, assertion, or sign request. */
const PASSPORT_DEFAULT_TTL_MS = 2 * 60 * 1000;
/** Allowed clock difference between signer and verifier. */
const PASSPORT_CLOCK_SKEW_MS = 30 * 1000;
/** Signer labels an assertion may carry. */
const PASSPORT_SIGNERS = Object.freeze(['passport', 'hub', 'gooncitizen']);
/** What a challenge may ask the user to share. */
const PASSPORT_DISCLOSURES = Object.freeze(['wallet', 'cosigner']);
/** Longest `purpose` text. */
const PASSPORT_MAX_PURPOSE_LENGTH = 140;

/** @private */
const NONCE_PATTERN = /^[0-9a-f]{64}$/;
/** @private */
const PUBKEY_PATTERN = /^0[23][0-9a-f]{64}$/;
/** @private */
const MAX_DISCLOSURE_JSON = 4096;

/**
 * Normalize a web origin: `http:` / `https:` only, no path or credentials.
 * @param {string} value
 * @returns {string|null} Origin, or `null` when unusable (including `"null"`).
 */
function normalizeOrigin (value) {
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
 * Fresh nonce: 32 random bytes, hex.
 * @returns {string}
 */
function createNonce () {
  return Buffer.from(Actor.randomBytes(32)).toString('hex');
}

/**
 * sha256 of a challenge frame, hex. An assertion carries it.
 * @param {string|Buffer|Message} challenge `fabric:` string, frame bytes, or Message.
 * @returns {string}
 */
function challengeHash (challenge) {
  let buffer;
  if (challenge instanceof Message) buffer = challenge.toBuffer();
  else if (Buffer.isBuffer(challenge) || challenge instanceof Uint8Array) buffer = Buffer.from(challenge);
  else {
    const decoded = decodeFabricUri(challenge, { allowedTypes: ['PASSPORT_CHALLENGE'], allowUnsigned: true });
    if (!decoded.ok) throw new TypeError(`challengeHash: ${decoded.error}`);
    buffer = decoded.buffer;
  }
  return crypto.createHash('sha256').update(buffer).digest('hex');
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
  if (!Number.isFinite(n) || n <= 0) return PASSPORT_DEFAULT_TTL_MS;
  return Math.min(Math.floor(n), PASSPORT_MAX_TTL_MS);
}

/**
 * @private
 * @returns {string|null} error, or null when the window is acceptable
 */
function checkWindow (issuedAt, expiresAt, options = {}) {
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const skew = Number.isFinite(options.clockSkewMs) ? options.clockSkewMs : PASSPORT_CLOCK_SKEW_MS;
  const maxTtl = Number.isFinite(options.maxTtlMs) ? Math.min(options.maxTtlMs, PASSPORT_MAX_TTL_MS) : PASSPORT_MAX_TTL_MS;
  if (!issuedAt) return 'missing issuedAt';
  if (!expiresAt) return 'missing expiresAt';
  if (expiresAt <= issuedAt) return 'expires before it is issued';
  if (expiresAt <= now - skew) return 'expired';
  if (issuedAt > now + skew) return 'issued in the future';
  if (expiresAt - issuedAt > maxTtl) return 'lifetime too long';
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
 * @private
 * @param {*} list
 * @returns {string[]|null} Sorted unique disclosures, or null when one is unknown.
 */
function normalizeDisclosures (list) {
  if (list == null || list === '') return [];
  const items = Array.isArray(list) ? list : String(list).split(',');
  const out = new Set();
  for (const item of items) {
    const value = String(item).trim();
    if (!value) continue;
    if (!PASSPORT_DISCLOSURES.includes(value)) return null;
    out.add(value);
  }
  return PASSPORT_DISCLOSURES.filter((d) => out.has(d));
}

/**
 * @private
 * @param {string|null|undefined} network
 * @returns {string|null}
 */
function optionalNetwork (network) {
  if (network == null || network === '') return null;
  return normalizeAccountNetwork(network);
}

/**
 * Build a `PASSPORT_CHALLENGE` (what a site hands to the user's signer).
 * @param {Object} params
 * @param {string} params.origin The site's origin.
 * @param {string} [params.nonce] 64 hex characters (generated when omitted).
 * @param {string} [params.purpose] Short text shown to the user (at most 140 characters).
 * @param {string} [params.network] The network the site runs on.
 * @param {string[]} [params.request] Ask for `wallet` and/or `cosigner`.
 * @param {number} [params.ttlMs] Lifetime (capped at {@link PASSPORT_MAX_TTL_MS}).
 * @param {number} [params.now]
 * @param {Key} [key] The site's key; omit for an unsigned challenge.
 * @returns {{ message: Message, uri: string, hash: string, nonce: string, issuedAt: number, expiresAt: number, network: (string|null), request: string[] }}
 */
function createChallenge (params = {}, key = null) {
  const origin = normalizeOrigin(params.origin);
  if (!origin) throw new TypeError('createChallenge: http(s) origin required');
  const nonce = params.nonce != null ? String(params.nonce).toLowerCase() : createNonce();
  if (!NONCE_PATTERN.test(nonce)) throw new TypeError('nonce must be 32 bytes of hex');
  const purpose = params.purpose != null ? String(params.purpose).slice(0, PASSPORT_MAX_PURPOSE_LENGTH) : '';
  const network = optionalNetwork(params.network);
  const request = normalizeDisclosures(params.request);
  if (!request) throw new TypeError(`request may only list ${PASSPORT_DISCLOSURES.join(', ')}`);
  const issuedAt = Number.isFinite(params.now) ? params.now : Date.now();
  const expiresAt = issuedAt + clampTtl(params.ttlMs);
  const message = Message.fromFields('PASSPORT_CHALLENGE', {
    v: PASSPORT_VERSION,
    origin,
    nonce,
    issuedAt: BigInt(issuedAt),
    expiresAt: BigInt(expiresAt),
    purpose,
    network: network || '',
    request: request.join(',')
  });
  if (key) {
    assertSigningKey(key);
    message.signWithKey(key);
  }
  return {
    message,
    uri: encodeFabricUri(message),
    hash: challengeHash(message),
    nonce,
    issuedAt,
    expiresAt,
    network,
    request
  };
}

/**
 * Read a `PASSPORT_CHALLENGE`. Its `origin` is only what the site claims; the
 * signer compares it with the origin it saw.
 * @param {string|Buffer|Message} input
 * @param {Object} [options]
 * @param {number} [options.now]
 * @param {number} [options.maxTtlMs]
 * @returns {{ ok: true, challenge: { v: number, origin: string, nonce: string, issuedAt: number, expiresAt: number, purpose: string, network: (string|null), request: string[] }, hash: string, author: (string|null), buffer: Buffer, message: Message }|{ ok: false, error: string }}
 */
function readChallenge (input, options = {}) {
  const decoded = decodeInput(input, { allowedTypes: ['PASSPORT_CHALLENGE'], allowUnsigned: true });
  if (!decoded.ok) return decoded;
  const fields = decoded.message.toFields();
  if (!fields) return { ok: false, error: 'malformed PASSPORT_CHALLENGE body' };
  if (Number(fields.v) !== PASSPORT_VERSION) return { ok: false, error: `unsupported Passport version ${fields.v}` };
  const origin = normalizeOrigin(fields.origin);
  if (!origin) return { ok: false, error: 'invalid origin' };
  const nonce = String(fields.nonce || '');
  if (!NONCE_PATTERN.test(nonce)) return { ok: false, error: 'invalid nonce' };
  const issuedAt = toMillis(fields.issuedAt);
  const expiresAt = toMillis(fields.expiresAt);
  const windowError = checkWindow(issuedAt, expiresAt, options);
  if (windowError) return { ok: false, error: `challenge ${windowError}` };
  const purpose = String(fields.purpose || '');
  if (purpose.length > PASSPORT_MAX_PURPOSE_LENGTH) return { ok: false, error: 'purpose too long' };
  let network;
  try {
    network = optionalNetwork(fields.network);
  } catch (_) {
    return { ok: false, error: 'unknown network' };
  }
  const request = normalizeDisclosures(fields.request);
  if (!request) return { ok: false, error: 'unknown disclosure requested' };
  return {
    ok: true,
    challenge: { v: PASSPORT_VERSION, origin, nonce, issuedAt, expiresAt, purpose, network, request },
    hash: crypto.createHash('sha256').update(decoded.buffer).digest('hex'),
    author: decoded.author,
    buffer: decoded.buffer,
    message: decoded.message
  };
}

/**
 * Wallet disclosure for an assertion: both account xpubs for `network` and
 * their watch descriptors, without key origins.
 * @private
 * @param {{ segwit: { xpub: string }, standard: { xpub: string } }} wallet
 * @param {string} network
 * @returns {{ segwit: { xpub: string }, standard: { xpub: string }, receive: string, descriptors: object }}
 */
function walletDisclosure (wallet, network) {
  if (!wallet || !wallet.segwit || !wallet.standard) throw new TypeError('wallet with segwit and standard accounts required');
  const segwit = { xpub: extendedKeyForNetwork(wallet.segwit.xpub, network) };
  const standard = { xpub: extendedKeyForNetwork(wallet.standard.xpub, network) };
  return { segwit, standard, receive: 'segwit', descriptors: walletDescriptors({ segwit, standard }) };
}

/**
 * Sign a `PASSPORT_ASSERTION` answering a challenge.
 * @param {Object} params
 * @param {string|Buffer|Message} params.challenge The site's `PASSPORT_CHALLENGE`.
 * @param {string} params.origin The origin the signer saw (never page-supplied).
 * @param {string} params.signer One of {@link PASSPORT_SIGNERS}.
 * @param {string} params.network The network whose paths the identity was derived on;
 *   must equal the challenge's when it names one.
 * @param {string[]} [params.disclose] What the user agreed to share; each must be requested.
 * @param {{ segwit: { xpub: string }, standard: { xpub: string } }} [params.wallet] Needed to disclose `wallet`.
 * @param {Key} [params.cosignerKey] Needed to disclose `cosigner`.
 * @param {string} [params.device] Compressed pubkey of the Passport device that asked (desktop signers).
 * @param {number} [params.ttlMs]
 * @param {number} [params.now]
 * @param {Key} key The identity's private key.
 * @returns {{ message: Message, uri: string, challengeHash: string, identity: { id: string, pubkey: string }, network: string, disclosed: string[], expiresAt: number }}
 */
function signAssertion (params = {}, key) {
  assertSigningKey(key);
  const origin = normalizeOrigin(params.origin);
  if (!origin) throw new TypeError('signAssertion: http(s) origin required');
  const read = readChallenge(params.challenge, { now: params.now });
  if (!read.ok) throw new Error(`signAssertion: ${read.error}`);
  const challenge = read.challenge;
  if (challenge.origin !== origin) throw new Error('signAssertion: the challenge names a different origin');
  const signer = String(params.signer || '');
  if (!PASSPORT_SIGNERS.includes(signer)) throw new TypeError(`signer must be one of ${PASSPORT_SIGNERS.join(', ')}`);
  const network = normalizeAccountNetwork(params.network || challenge.network);
  if (challenge.network && network !== challenge.network) {
    throw new Error(`signAssertion: the challenge is for ${challenge.network}, not ${network}`);
  }
  const disclose = normalizeDisclosures(params.disclose);
  if (!disclose) throw new TypeError(`disclose may only list ${PASSPORT_DISCLOSURES.join(', ')}`);
  for (const item of disclose) {
    if (!challenge.request.includes(item)) throw new Error(`signAssertion: the challenge did not ask for ${item}`);
  }
  let device = '';
  if (params.device) {
    device = String(params.device).toLowerCase();
    if (!PUBKEY_PATTERN.test(device)) throw new TypeError('device must be a compressed pubkey');
  }
  const pubkey = String(key.pubkey || '').toLowerCase();
  const identityId = fabricIdentityIdFromPubkeyHex(pubkey);
  const hash = read.hash;

  let wallet = '';
  if (disclose.includes('wallet')) {
    wallet = JSON.stringify(walletDisclosure(params.wallet, network));
  }
  let cosigner = '';
  if (disclose.includes('cosigner')) {
    const cosignerKey = params.cosignerKey;
    if (!cosignerKey || !cosignerKey.private) throw new TypeError('signAssertion: cosignerKey required to disclose cosigner');
    const proof = cosignerProof(cosignerKey, { identityPubkey: pubkey, scope: cosignerScope(origin, hash) });
    cosigner = JSON.stringify({ pubkey: String(cosignerKey.pubkey).toLowerCase(), proof });
  }

  const issuedAt = Number.isFinite(params.now) ? params.now : Date.now();
  const expiresAt = Math.min(issuedAt + clampTtl(params.ttlMs), challenge.expiresAt);
  const message = Message.fromFields('PASSPORT_ASSERTION', {
    v: PASSPORT_VERSION,
    origin,
    nonce: challenge.nonce,
    challengeHash: Buffer.from(hash, 'hex'),
    issuedAt: BigInt(issuedAt),
    expiresAt: BigInt(expiresAt),
    network,
    pubkey,
    identityId,
    signer,
    device,
    wallet,
    cosigner
  });
  message.signWithKey(key);
  return {
    message,
    uri: encodeFabricUri(message),
    challengeHash: hash,
    identity: { id: identityId, pubkey },
    network,
    disclosed: disclose,
    expiresAt
  };
}

/**
 * Scope a cosigner proof to one sign-in, so it can't be replayed elsewhere.
 * @param {string} origin
 * @param {string} hash Challenge hash, hex.
 * @returns {string}
 */
function cosignerScope (origin, hash) {
  return `passport:${origin}:${hash}`;
}

/**
 * Verify a `PASSPORT_ASSERTION` for a site.
 * @param {string|Buffer|Message} input
 * @param {Object} expected What the site stored when it issued the challenge.
 * @param {string} expected.origin The site's own origin.
 * @param {string} expected.nonce
 * @param {string} expected.challengeHash
 * @param {string} [expected.network] Required when the challenge named one.
 * @param {string[]} [expected.allow] What the challenge asked for; anything else disclosed is refused.
 * @param {number} [expected.challengeExpiresAt] The assertion may not outlive it.
 * @param {string[]} [expected.signers] Accept only these signer labels.
 * @param {number} [expected.now]
 * @param {number} [expected.maxTtlMs]
 * @returns {{ ok: true, identity: { id: string, pubkey: string }, network: string, signer: string, device: (string|null), wallet: (object|null), cosigner: (object|null), issuedAt: number, expiresAt: number }|{ ok: false, error: string }}
 */
function verifyAssertion (input, expected = {}) {
  const origin = normalizeOrigin(expected.origin);
  if (!origin) return { ok: false, error: 'expected origin required' };
  if (!expected.nonce) return { ok: false, error: 'expected nonce required' };
  const expectedHash = String(expected.challengeHash || '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(expectedHash)) return { ok: false, error: 'expected challengeHash required' };
  let expectedNetwork = null;
  try {
    expectedNetwork = optionalNetwork(expected.network);
  } catch (_) {
    return { ok: false, error: 'expected network unknown' };
  }
  const allow = normalizeDisclosures(expected.allow);
  if (!allow) return { ok: false, error: 'expected allow lists an unknown disclosure' };

  const decoded = decodeInput(input, { allowedTypes: ['PASSPORT_ASSERTION'] });
  if (!decoded.ok) return decoded;
  const fields = decoded.message.toFields();
  if (!fields) return { ok: false, error: 'malformed PASSPORT_ASSERTION body' };
  if (Number(fields.v) !== PASSPORT_VERSION) return { ok: false, error: `unsupported Passport version ${fields.v}` };
  if (normalizeOrigin(fields.origin) !== origin) return { ok: false, error: 'origin mismatch' };
  if (String(fields.nonce) !== String(expected.nonce)) return { ok: false, error: 'nonce mismatch' };
  const hash = Buffer.from(fields.challengeHash || []).toString('hex');
  if (hash !== expectedHash) return { ok: false, error: 'challengeHash mismatch' };

  const issuedAt = toMillis(fields.issuedAt);
  const expiresAt = toMillis(fields.expiresAt);
  const windowError = checkWindow(issuedAt, expiresAt, expected);
  if (windowError) return { ok: false, error: `assertion ${windowError}` };
  if (Number.isFinite(expected.challengeExpiresAt) && expiresAt > expected.challengeExpiresAt) {
    return { ok: false, error: 'assertion outlives its challenge' };
  }

  let network;
  try {
    network = normalizeAccountNetwork(fields.network);
  } catch (_) {
    return { ok: false, error: 'unknown network' };
  }
  if (expectedNetwork && network !== expectedNetwork) return { ok: false, error: 'network mismatch' };

  const signer = String(fields.signer || '');
  if (!PASSPORT_SIGNERS.includes(signer)) return { ok: false, error: 'unknown signer' };
  if (Array.isArray(expected.signers) && expected.signers.length && !expected.signers.includes(signer)) {
    return { ok: false, error: `signer ${signer} not accepted` };
  }

  const pubkey = String(fields.pubkey || '').toLowerCase();
  if (!PUBKEY_PATTERN.test(pubkey)) return { ok: false, error: 'invalid pubkey' };
  if (pubkey.slice(2) !== decoded.author) return { ok: false, error: 'pubkey does not match the frame author' };
  let identityId;
  try {
    identityId = fabricIdentityIdFromPubkeyHex(pubkey);
  } catch (_) {
    return { ok: false, error: 'invalid pubkey' };
  }
  if (String(fields.identityId) !== identityId) return { ok: false, error: 'identity id does not match pubkey' };

  const device = String(fields.device || '').toLowerCase();
  if (device && !PUBKEY_PATTERN.test(device)) return { ok: false, error: 'invalid device' };

  let wallet = null;
  if (fields.wallet) {
    if (!allow.includes('wallet')) return { ok: false, error: 'wallet disclosed without being requested' };
    const checked = readWalletDisclosure(fields.wallet, network);
    if (!checked.ok) return checked;
    wallet = checked.wallet;
  }
  let cosigner = null;
  if (fields.cosigner) {
    if (!allow.includes('cosigner')) return { ok: false, error: 'cosigner disclosed without being requested' };
    const checked = readCosignerDisclosure(fields.cosigner, { identityPubkey: pubkey, origin, hash });
    if (!checked.ok) return checked;
    cosigner = checked.cosigner;
  }

  return {
    ok: true,
    identity: { id: identityId, pubkey },
    network,
    signer,
    device: device || null,
    wallet,
    cosigner,
    issuedAt,
    expiresAt
  };
}

/**
 * @private
 * @param {string} text
 * @param {string} network
 */
function readWalletDisclosure (text, network) {
  if (String(text).length > MAX_DISCLOSURE_JSON) return { ok: false, error: 'wallet disclosure too large' };
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (_) {
    return { ok: false, error: 'malformed wallet disclosure' };
  }
  if (!parsed || !parsed.segwit || !parsed.standard || parsed.receive !== 'segwit') {
    return { ok: false, error: 'malformed wallet disclosure' };
  }
  let wallet;
  try {
    wallet = walletDisclosure(parsed, network);
    for (const xpub of [wallet.segwit.xpub, wallet.standard.xpub]) new Key({ xpub: extendedKeyForNetwork(xpub, 'mainnet') });
  } catch (_) {
    return { ok: false, error: 'invalid wallet xpub' };
  }
  if (wallet.segwit.xpub !== parsed.segwit.xpub || wallet.standard.xpub !== parsed.standard.xpub) {
    return { ok: false, error: 'wallet xpubs are not for the assertion network' };
  }
  if (JSON.stringify(wallet.descriptors) !== JSON.stringify(parsed.descriptors)) {
    return { ok: false, error: 'wallet descriptors do not match the xpubs' };
  }
  return { ok: true, wallet };
}

/**
 * @private
 * @param {string} text
 * @param {{ identityPubkey: string, origin: string, hash: string }} context
 */
function readCosignerDisclosure (text, context) {
  if (String(text).length > MAX_DISCLOSURE_JSON) return { ok: false, error: 'cosigner disclosure too large' };
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (_) {
    return { ok: false, error: 'malformed cosigner disclosure' };
  }
  const cosignerPubkey = parsed && String(parsed.pubkey || '').toLowerCase();
  if (!cosignerPubkey || !PUBKEY_PATTERN.test(cosignerPubkey)) return { ok: false, error: 'invalid cosigner pubkey' };
  if (cosignerPubkey === context.identityPubkey) return { ok: false, error: 'cosigner key is the identity key' };
  const valid = verifyCosignerProof({
    cosigner: cosignerPubkey,
    identityPubkey: context.identityPubkey,
    scope: cosignerScope(context.origin, context.hash),
    proof: parsed.proof
  });
  if (!valid) return { ok: false, error: 'cosigner proof does not verify for this sign-in' };
  return { ok: true, cosigner: { pubkey: cosignerPubkey, proof: String(parsed.proof).toLowerCase() } };
}

/**
 * Ask a paired desktop app to answer a challenge (signed by the Passport device).
 * @param {Object} params
 * @param {string|Buffer|Message} params.challenge The site's `PASSPORT_CHALLENGE`.
 * @param {string} params.origin The origin Passport saw (must match the challenge).
 * @param {number} [params.account=0] Account index the desktop signs with.
 * @param {string[]} [params.disclose] What the user agreed to share; each must be requested.
 * @param {string} [params.nonce] 64 hex characters (generated when omitted).
 * @param {number} [params.ttlMs]
 * @param {number} [params.now]
 * @param {Key} key The Passport device key.
 * @returns {{ message: Message, uri: string, nonce: string, expiresAt: number }}
 */
function createSignRequest (params = {}, key) {
  assertSigningKey(key);
  const origin = normalizeOrigin(params.origin);
  if (!origin) throw new TypeError('createSignRequest: http(s) origin required');
  const inner = readChallenge(params.challenge, { now: params.now });
  if (!inner.ok) throw new Error(`createSignRequest: ${inner.error}`);
  if (inner.challenge.origin !== origin) throw new Error('createSignRequest: the challenge names a different origin');
  const disclose = normalizeDisclosures(params.disclose);
  if (!disclose) throw new TypeError(`disclose may only list ${PASSPORT_DISCLOSURES.join(', ')}`);
  for (const item of disclose) {
    if (!inner.challenge.request.includes(item)) throw new Error(`createSignRequest: the challenge did not ask for ${item}`);
  }
  const account = params.account != null ? Number(params.account) : 0;
  if (!Number.isInteger(account) || account < 0 || account >= 0x80000000) throw new RangeError('account must be a BIP32 child index');
  const nonce = params.nonce != null ? String(params.nonce).toLowerCase() : createNonce();
  if (!NONCE_PATTERN.test(nonce)) throw new TypeError('nonce must be 32 bytes of hex');
  const issuedAt = Number.isFinite(params.now) ? params.now : Date.now();
  const expiresAt = Math.min(issuedAt + clampTtl(params.ttlMs), inner.challenge.expiresAt);
  const message = Message.fromFields('PASSPORT_SIGN_REQUEST', {
    v: PASSPORT_VERSION,
    origin,
    nonce,
    issuedAt: BigInt(issuedAt),
    expiresAt: BigInt(expiresAt),
    challenge: inner.buffer,
    account,
    disclose: disclose.join(',')
  });
  message.signWithKey(key);
  return { message, uri: encodeFabricUri(message), nonce, expiresAt };
}

/**
 * Read a `PASSPORT_SIGN_REQUEST`: device signature, window, and the challenge.
 * Whether the author may ask (a paired device in the identity cluster) and
 * whether the nonce is fresh are the desktop app's checks.
 * @param {string|Buffer|Message} input
 * @param {Object} [options]
 * @param {number} [options.now]
 * @param {number} [options.maxTtlMs]
 * @returns {{ ok: true, author: string, origin: string, nonce: string, issuedAt: number, expiresAt: number, account: number, disclose: string[], challenge: object, challengeHash: string, challengeBuffer: Buffer }|{ ok: false, error: string }}
 */
function readSignRequest (input, options = {}) {
  const decoded = decodeInput(input, { allowedTypes: ['PASSPORT_SIGN_REQUEST'] });
  if (!decoded.ok) return decoded;
  const fields = decoded.message.toFields();
  if (!fields) return { ok: false, error: 'malformed PASSPORT_SIGN_REQUEST body' };
  if (Number(fields.v) !== PASSPORT_VERSION) return { ok: false, error: `unsupported Passport version ${fields.v}` };
  const origin = normalizeOrigin(fields.origin);
  if (!origin) return { ok: false, error: 'invalid origin' };
  const nonce = String(fields.nonce || '');
  if (!NONCE_PATTERN.test(nonce)) return { ok: false, error: 'invalid nonce' };
  const issuedAt = toMillis(fields.issuedAt);
  const expiresAt = toMillis(fields.expiresAt);
  const windowError = checkWindow(issuedAt, expiresAt, options);
  if (windowError) return { ok: false, error: `sign request ${windowError}` };
  const inner = readChallenge(fields.challenge, options);
  if (!inner.ok) return { ok: false, error: `challenge: ${inner.error}` };
  if (inner.challenge.origin !== origin) return { ok: false, error: 'the challenge names a different origin' };
  if (expiresAt > inner.challenge.expiresAt) return { ok: false, error: 'sign request outlives its challenge' };
  const disclose = normalizeDisclosures(fields.disclose);
  if (!disclose) return { ok: false, error: 'unknown disclosure' };
  for (const item of disclose) {
    if (!inner.challenge.request.includes(item)) return { ok: false, error: `the challenge did not ask for ${item}` };
  }
  const account = Number(fields.account);
  if (!Number.isInteger(account) || account < 0 || account >= 0x80000000) return { ok: false, error: 'invalid account' };
  return {
    ok: true,
    author: decoded.author,
    origin,
    nonce,
    issuedAt,
    expiresAt,
    account,
    disclose,
    challenge: inner.challenge,
    challengeHash: inner.hash,
    challengeBuffer: inner.buffer
  };
}

/**
 * Six-digit code both devices show while pairing, so the user can check they
 * are linking the two devices they think they are. Order-independent; takes
 * compressed or x-only pubkeys.
 * @param {string} a Pubkey hex.
 * @param {string} b Pubkey hex.
 * @returns {string}
 */
function pairingCode (a, b) {
  const xOnly = (pubkey) => {
    const hex = String(pubkey || '').toLowerCase();
    if (/^0[23][0-9a-f]{64}$/.test(hex)) return hex.slice(2);
    if (/^[0-9a-f]{64}$/.test(hex)) return hex;
    throw new TypeError('pairingCode: pubkeys must be hex');
  };
  const [first, second] = [xOnly(a), xOnly(b)].sort();
  if (first === second) throw new Error('pairingCode: a device cannot pair with itself');
  const digest = crypto.createHash('sha256').update(`fabric-pairing:1\n${first}\n${second}`, 'utf8').digest();
  return String(digest.readUInt32BE(0) % 1000000).padStart(6, '0');
}

module.exports = {
  PASSPORT_VERSION,
  PASSPORT_DEFAULT_TTL_MS,
  PASSPORT_MAX_TTL_MS,
  PASSPORT_CLOCK_SKEW_MS,
  PASSPORT_SIGNERS,
  PASSPORT_DISCLOSURES,
  PASSPORT_MAX_PURPOSE_LENGTH,
  normalizeOrigin,
  createNonce,
  challengeHash,
  cosignerScope,
  createChallenge,
  readChallenge,
  signAssertion,
  verifyAssertion,
  createSignRequest,
  readSignRequest,
  pairingCode
};
