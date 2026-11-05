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
 * - Passport asks another participant it holds a grant from (a desktop app, a
 *   Hub) to answer for it with a `DELEGATION_REQUEST` embedding the challenge
 *   (`types/delegation.js`); the answer names the asker as `device`.
 *
 * Every frame carries `origin`, `nonce`, `issuedAt`, and `expiresAt`; readers
 * refuse lifetimes over {@link PASSPORT_MAX_TTL_MS}. Redeeming a nonce once is
 * the caller's job. These frames cross trust boundaries as `fabric:` strings
 * and are never relayed on the mesh.
 *
 * Peer sessions (`v: 3`) sign in to a peer named by its key instead of a web
 * origin. The signer opens the connection and sends `PASSPORT_CONNECT` with a
 * fresh `clientNonce`; the peer answers with a `PASSPORT_CHALLENGE` it signs,
 * naming itself as `peer`. The assertion names that `peer` as its audience and
 * a `sessionKey` the signer generated; the peer confirms with a signed
 * `PASSPORT_SESSION`, and from then on accepts frames signed by `sessionKey`
 * as that identity. `PASSPORT_RESUME` answers a later challenge with the
 * session key to re-bind a new connection.
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
  shareableAccountXpub,
  walletDescriptors,
  cosignerProof,
  verifyCosignerProof
} = require('./accountKeys');
const { PASSPORT_MAX_TTL_MS, PASSPORT_SESSION_MAX_TTL_MS } = require('../constants');

/** Protocol version carried in every frame. */
const PASSPORT_VERSION = 2;
/** Default lifetime of a challenge or assertion. */
const PASSPORT_DEFAULT_TTL_MS = 2 * 60 * 1000;
/** Allowed clock difference between signer and verifier. */
const PASSPORT_CLOCK_SKEW_MS = 30 * 1000;
/** Signer labels an assertion may carry. */
const PASSPORT_SIGNERS = Object.freeze(['passport', 'hub', 'gooncitizen']);
/** What a challenge may ask the user to share. */
const PASSPORT_DISCLOSURES = Object.freeze(['wallet', 'cosigner']);
/** Longest `purpose` text. */
const PASSPORT_MAX_PURPOSE_LENGTH = 140;
/** Version of peer-session frames (sign in to a peer by its key). */
const PASSPORT_PEER_VERSION = 3;
/** Default lifetime of a peer session. */
const PASSPORT_SESSION_DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
/** Most origins a peer may list as its homes. */
const PASSPORT_MAX_HOMES = 16;

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
 * @private
 * @param {*} value
 * @returns {string|null} Lowercase compressed pubkey hex, or null.
 */
function compressedPubkey (value) {
  const text = String(value == null ? '' : value).toLowerCase();
  return PUBKEY_PATTERN.test(text) ? text : null;
}

/**
 * @private
 * @param {Key} key
 * @returns {string}
 */
function keyPubkey (key) {
  const pubkey = compressedPubkey(key && key.pubkey);
  if (!pubkey) throw new TypeError('key has no compressed pubkey');
  return pubkey;
}

/**
 * Origins a peer says it serves, normalized and deduplicated.
 * @private
 * @param {*} value Comma list or array.
 * @returns {string[]|null} null when one is not an http(s) origin or there are too many.
 */
function normalizeHomes (value) {
  if (value == null || value === '') return [];
  const items = Array.isArray(value) ? value : String(value).split(',');
  const out = [];
  for (const item of items) {
    const text = String(item).trim();
    if (!text) continue;
    const origin = normalizeOrigin(text);
    if (!origin) return null;
    if (!out.includes(origin)) out.push(origin);
  }
  return out.length > PASSPORT_MAX_HOMES ? null : out;
}

/**
 * @private
 * @param {number|undefined} ttlMs
 * @returns {number}
 */
function sessionTtl (ttlMs) {
  const n = Number(ttlMs);
  if (!Number.isFinite(n) || n <= 0) return PASSPORT_SESSION_DEFAULT_TTL_MS;
  return Math.min(Math.floor(n), PASSPORT_SESSION_MAX_TTL_MS);
}

/**
 * @private
 * @param {*} value Buffer or hex.
 * @returns {string}
 */
function hex32 (value) {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return Buffer.from(value).toString('hex');
  return String(value || '').toLowerCase();
}

/**
 * @private
 * @param {string} value
 * @returns {boolean}
 */
function isHash (value) {
  return NONCE_PATTERN.test(value) && !/^0+$/.test(value);
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
 * Ask a peer for a sign-in challenge (`PASSPORT_CONNECT`, unsigned). The
 * signer sends it on a connection it opened to the peer.
 * @param {Object} [params]
 * @param {string} [params.clientNonce] 64 hex characters (generated when omitted).
 * @param {string} [params.peer] Compressed pubkey of the peer the signer expects.
 * @param {string} [params.origin] The page that asked for the sign-in (informational).
 * @param {string[]} [params.request] Ask the peer to request `wallet` and/or `cosigner`.
 * @param {number} [params.ttlMs]
 * @param {number} [params.now]
 * @returns {{ message: Message, uri: string, clientNonce: string, peer: (string|null), issuedAt: number, expiresAt: number }}
 */
function createConnect (params = {}) {
  const clientNonce = params.clientNonce != null ? String(params.clientNonce).toLowerCase() : createNonce();
  if (!NONCE_PATTERN.test(clientNonce)) throw new TypeError('clientNonce must be 32 bytes of hex');
  let peer = '';
  if (params.peer) {
    peer = compressedPubkey(params.peer);
    if (!peer) throw new TypeError('createConnect: peer must be a compressed pubkey');
  }
  let origin = '';
  if (params.origin) {
    origin = normalizeOrigin(params.origin);
    if (!origin) throw new TypeError('createConnect: origin must be http(s)');
  }
  const request = normalizeDisclosures(params.request);
  if (!request) throw new TypeError(`request may only list ${PASSPORT_DISCLOSURES.join(', ')}`);
  const issuedAt = Number.isFinite(params.now) ? params.now : Date.now();
  const expiresAt = issuedAt + clampTtl(params.ttlMs);
  const message = Message.fromFields('PASSPORT_CONNECT', {
    v: PASSPORT_PEER_VERSION,
    clientNonce,
    issuedAt: BigInt(issuedAt),
    expiresAt: BigInt(expiresAt),
    peer,
    origin,
    request: request.join(',')
  });
  return { message, uri: encodeFabricUri(message), clientNonce, peer: peer || null, issuedAt, expiresAt };
}

/**
 * Read a `PASSPORT_CONNECT`.
 * @param {string|Buffer|Message} input
 * @param {Object} [options]
 * @param {number} [options.now]
 * @returns {{ ok: true, connect: { v: number, clientNonce: string, peer: (string|null), origin: (string|null), request: string[], issuedAt: number, expiresAt: number }, buffer: Buffer, message: Message }|{ ok: false, error: string }}
 */
function readConnect (input, options = {}) {
  const decoded = decodeInput(input, { allowedTypes: ['PASSPORT_CONNECT'], allowUnsigned: true });
  if (!decoded.ok) return decoded;
  const fields = decoded.message.toFields();
  if (!fields) return { ok: false, error: 'malformed PASSPORT_CONNECT body' };
  if (Number(fields.v) !== PASSPORT_PEER_VERSION) return { ok: false, error: `unsupported Passport version ${fields.v}` };
  const clientNonce = String(fields.clientNonce || '');
  if (!NONCE_PATTERN.test(clientNonce)) return { ok: false, error: 'invalid clientNonce' };
  const issuedAt = toMillis(fields.issuedAt);
  const expiresAt = toMillis(fields.expiresAt);
  const windowError = checkWindow(issuedAt, expiresAt, options);
  if (windowError) return { ok: false, error: `connect ${windowError}` };
  let peer = null;
  if (fields.peer) {
    peer = compressedPubkey(fields.peer);
    if (!peer) return { ok: false, error: 'invalid peer' };
  }
  let origin = null;
  if (fields.origin) {
    origin = normalizeOrigin(fields.origin);
    if (!origin) return { ok: false, error: 'invalid origin' };
  }
  const request = normalizeDisclosures(fields.request);
  if (!request) return { ok: false, error: 'unknown disclosure requested' };
  return {
    ok: true,
    connect: { v: PASSPORT_PEER_VERSION, clientNonce, peer, origin, request, issuedAt, expiresAt },
    buffer: decoded.buffer,
    message: decoded.message
  };
}

/**
 * Build a peer `PASSPORT_CHALLENGE` (`v: 3`), signed by the peer, answering a
 * `PASSPORT_CONNECT`.
 * @param {Object} params
 * @param {string} params.clientNonce From the signer's `PASSPORT_CONNECT`.
 * @param {string} [params.nonce] 64 hex characters (generated when omitted).
 * @param {string} [params.origin] The page the signer named, echoed (optional).
 * @param {string[]} [params.homes] Origins this peer serves; the signer may show them.
 * @param {string} [params.purpose]
 * @param {string} [params.network]
 * @param {string[]} [params.request]
 * @param {number} [params.ttlMs]
 * @param {number} [params.now]
 * @param {Key} key The peer's identity key.
 * @returns {{ message: Message, uri: string, hash: string, nonce: string, peer: string, clientNonce: string, issuedAt: number, expiresAt: number, network: (string|null), request: string[] }}
 */
function createPeerChallenge (params = {}, key) {
  assertSigningKey(key);
  const peer = keyPubkey(key);
  const clientNonce = String(params.clientNonce || '').toLowerCase();
  if (!NONCE_PATTERN.test(clientNonce)) throw new TypeError('createPeerChallenge: clientNonce required');
  const nonce = params.nonce != null ? String(params.nonce).toLowerCase() : createNonce();
  if (!NONCE_PATTERN.test(nonce)) throw new TypeError('nonce must be 32 bytes of hex');
  let origin = '';
  if (params.origin) {
    origin = normalizeOrigin(params.origin);
    if (!origin) throw new TypeError('createPeerChallenge: origin must be http(s)');
  }
  const homes = normalizeHomes(params.homes);
  if (!homes) throw new TypeError(`homes must be at most ${PASSPORT_MAX_HOMES} http(s) origins`);
  const purpose = params.purpose != null ? String(params.purpose).slice(0, PASSPORT_MAX_PURPOSE_LENGTH) : '';
  const network = optionalNetwork(params.network);
  const request = normalizeDisclosures(params.request);
  if (!request) throw new TypeError(`request may only list ${PASSPORT_DISCLOSURES.join(', ')}`);
  const issuedAt = Number.isFinite(params.now) ? params.now : Date.now();
  const expiresAt = issuedAt + clampTtl(params.ttlMs);
  const message = Message.fromFields('PASSPORT_CHALLENGE', {
    v: PASSPORT_PEER_VERSION,
    origin,
    nonce,
    issuedAt: BigInt(issuedAt),
    expiresAt: BigInt(expiresAt),
    purpose,
    network: network || '',
    request: request.join(','),
    peer,
    clientNonce,
    homes: homes.join(',')
  });
  message.signWithKey(key);
  return {
    message,
    uri: encodeFabricUri(message),
    hash: challengeHash(message),
    nonce,
    peer,
    clientNonce,
    issuedAt,
    expiresAt,
    network,
    request
  };
}

/**
 * Read a `PASSPORT_CHALLENGE`. A v2 challenge's `origin` is only what the site
 * claims; the signer compares it with the origin it saw. A v3 (peer) challenge
 * must be signed by the `peer` it names and echo the signer's `clientNonce`.
 * @param {string|Buffer|Message} input
 * @param {Object} [options]
 * @param {string} [options.peer] v3: the peer the signer expects.
 * @param {string} [options.clientNonce] v3: the nonce the signer sent.
 * @param {number} [options.now]
 * @param {number} [options.maxTtlMs]
 * @returns {{ ok: true, challenge: { v: number, origin: (string|null), nonce: string, issuedAt: number, expiresAt: number, purpose: string, network: (string|null), request: string[], peer: (string|undefined), clientNonce: (string|undefined), homes: (string[]|undefined) }, hash: string, author: (string|null), buffer: Buffer, message: Message }|{ ok: false, error: string }}
 */
function readChallenge (input, options = {}) {
  const decoded = decodeInput(input, { allowedTypes: ['PASSPORT_CHALLENGE'], allowUnsigned: true });
  if (!decoded.ok) return decoded;
  const fields = decoded.message.toFields();
  if (!fields) return { ok: false, error: 'malformed PASSPORT_CHALLENGE body' };
  const v = Number(fields.v);
  if (v !== PASSPORT_VERSION && v !== PASSPORT_PEER_VERSION) return { ok: false, error: `unsupported Passport version ${fields.v}` };
  let origin = null;
  if (v === PASSPORT_VERSION || fields.origin) {
    origin = normalizeOrigin(fields.origin);
    if (!origin) return { ok: false, error: 'invalid origin' };
  }
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
  const challenge = { v, origin, nonce, issuedAt, expiresAt, purpose, network, request };
  if (v === PASSPORT_PEER_VERSION) {
    const peer = compressedPubkey(fields.peer);
    if (!peer) return { ok: false, error: 'invalid peer' };
    if (!decoded.author || peer.slice(2) !== decoded.author) return { ok: false, error: 'a peer challenge must be signed by its peer' };
    const clientNonce = String(fields.clientNonce || '');
    if (!NONCE_PATTERN.test(clientNonce)) return { ok: false, error: 'invalid clientNonce' };
    const homes = normalizeHomes(fields.homes);
    if (!homes) return { ok: false, error: 'invalid homes' };
    if (options.peer && compressedPubkey(options.peer) !== peer) return { ok: false, error: 'challenge is from another peer' };
    if (options.clientNonce && !sameString(clientNonce, String(options.clientNonce).toLowerCase())) {
      return { ok: false, error: 'clientNonce mismatch' };
    }
    Object.assign(challenge, { peer, clientNonce, homes });
  } else if (fields.peer || fields.clientNonce || fields.homes) {
    return { ok: false, error: 'a v2 challenge carries peer fields' };
  }
  return {
    ok: true,
    challenge,
    hash: crypto.createHash('sha256').update(decoded.buffer).digest('hex'),
    author: decoded.author,
    buffer: decoded.buffer,
    message: decoded.message
  };
}

/**
 * Wallet disclosure for an assertion: both account xpubs for `network`
 * (depth, parent fingerprint, and child number zeroed) and their watch
 * descriptors, without key origins.
 * @private
 * @param {{ segwit: { xpub: string }, standard: { xpub: string } }} wallet
 * @param {string} network
 * @returns {{ segwit: { xpub: string }, standard: { xpub: string }, receive: string, descriptors: object }}
 */
function walletDisclosure (wallet, network) {
  if (!wallet || !wallet.segwit || !wallet.standard) throw new TypeError('wallet with segwit and standard accounts required');
  const segwit = { xpub: shareableAccountXpub(wallet.segwit.xpub, network) };
  const standard = { xpub: shareableAccountXpub(wallet.standard.xpub, network) };
  return { segwit, standard, receive: 'segwit', descriptors: walletDescriptors({ segwit, standard }) };
}

/**
 * Sign a `PASSPORT_ASSERTION` answering a challenge.
 * @param {Object} params
 * @param {string|Buffer|Message} params.challenge The site's or peer's `PASSPORT_CHALLENGE`.
 * @param {string} [params.origin] The origin the signer saw (never page-supplied).
 *   Required for a v2 challenge; for a v3 (peer) challenge it names the page
 *   that asked, when there is one.
 * @param {string} [params.peer] v3: the peer the signer meant to sign in to.
 * @param {string} [params.sessionKey] v3, required: compressed pubkey whose
 *   signatures will speak for this identity on the peer.
 * @param {string} params.signer One of {@link PASSPORT_SIGNERS}.
 * @param {string} params.network The network whose paths the identity was derived on;
 *   must equal the challenge's when it names one.
 * @param {string[]} [params.disclose] What the user agreed to share; each must be requested.
 * @param {{ segwit: { xpub: string }, standard: { xpub: string } }} [params.wallet] Needed to disclose `wallet`.
 * @param {Key} [params.cosignerKey] Needed to disclose `cosigner`.
 * @param {string} [params.device] Compressed pubkey of the participant that asked (delegated sign-ins).
 * @param {number} [params.ttlMs]
 * @param {number} [params.now]
 * @param {Key} key The identity's private key.
 * @returns {{ message: Message, uri: string, challengeHash: string, identity: { id: string, pubkey: string }, network: string, disclosed: string[], expiresAt: number, peer: (string|null), sessionKey: (string|null) }}
 */
function signAssertion (params = {}, key) {
  assertSigningKey(key);
  let origin = null;
  if (params.origin != null && params.origin !== '') {
    origin = normalizeOrigin(params.origin);
    if (!origin) throw new TypeError('signAssertion: http(s) origin required');
  }
  const read = readChallenge(params.challenge, { now: params.now, peer: params.peer });
  if (!read.ok) throw new Error(`signAssertion: ${read.error}`);
  const challenge = read.challenge;
  const peerMode = challenge.v === PASSPORT_PEER_VERSION;
  if (!peerMode) {
    if (params.peer) throw new Error('signAssertion: not a peer challenge');
    if (!origin) throw new TypeError('signAssertion: http(s) origin required');
    if (challenge.origin !== origin) throw new Error('signAssertion: the challenge names a different origin');
  } else if (origin && challenge.origin && challenge.origin !== origin) {
    throw new Error('signAssertion: the challenge names a different origin');
  }
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
  let sessionKey = '';
  if (peerMode) {
    sessionKey = compressedPubkey(params.sessionKey);
    if (!sessionKey) throw new TypeError('signAssertion: a peer sign-in needs a compressed sessionKey');
    if (sessionKey.slice(2) === pubkey.slice(2)) throw new Error('signAssertion: the session key is the identity key');
  }
  const scope = peerMode ? peerCosignerScope(challenge.peer, hash) : cosignerScope(origin, hash);

  let wallet = '';
  if (disclose.includes('wallet')) {
    wallet = JSON.stringify(walletDisclosure(params.wallet, network));
  }
  let cosigner = '';
  if (disclose.includes('cosigner')) {
    const cosignerKey = params.cosignerKey;
    if (!cosignerKey || !cosignerKey.private) throw new TypeError('signAssertion: cosignerKey required to disclose cosigner');
    const proof = cosignerProof(cosignerKey, { identityPubkey: pubkey, scope });
    cosigner = JSON.stringify({ pubkey: String(cosignerKey.pubkey).toLowerCase(), proof });
  }

  const issuedAt = Number.isFinite(params.now) ? params.now : Date.now();
  const expiresAt = Math.min(issuedAt + clampTtl(params.ttlMs), challenge.expiresAt);
  const message = Message.fromFields('PASSPORT_ASSERTION', {
    v: challenge.v,
    origin: origin || challenge.origin || '',
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
    cosigner,
    peer: peerMode ? challenge.peer : '',
    sessionKey
  });
  message.signWithKey(key);
  return {
    message,
    uri: encodeFabricUri(message),
    challengeHash: hash,
    identity: { id: identityId, pubkey },
    network,
    disclosed: disclose,
    expiresAt,
    peer: peerMode ? challenge.peer : null,
    sessionKey: sessionKey || null
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
 * Scope a cosigner proof to one peer sign-in.
 * @param {string} peer Compressed pubkey of the peer.
 * @param {string} hash Challenge hash, hex.
 * @returns {string}
 */
function peerCosignerScope (peer, hash) {
  return `passport:peer:${peer}:${hash}`;
}

/**
 * Constant-time string equality.
 * @private
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function sameString (a, b) {
  const digest = (value) => crypto.createHash('sha256').update(String(value)).digest();
  return crypto.timingSafeEqual(digest(a), digest(b));
}

/**
 * Verify a `PASSPORT_ASSERTION` for a site (v2, by `origin`) or a peer (v3, by `peer`).
 * @param {string|Buffer|Message} input
 * @param {Object} expected What the site stored when it issued the challenge.
 * @param {string} [expected.origin] v2: the site's own origin.
 * @param {string} [expected.peer] v3: this peer's own compressed pubkey (the audience).
 * @param {string} expected.nonce
 * @param {string} expected.challengeHash
 * @param {string} [expected.network] Required when the challenge named one.
 * @param {string[]} [expected.allow] What the challenge asked for; anything else disclosed is refused.
 * @param {number} [expected.challengeExpiresAt] The assertion may not outlive it.
 * @param {string[]} [expected.signers] Accept only these signer labels.
 * @param {number} [expected.now]
 * @param {number} [expected.maxTtlMs]
 * @returns {{ ok: true, identity: { id: string, pubkey: string }, network: string, signer: string, device: (string|null), wallet: (object|null), cosigner: (object|null), issuedAt: number, expiresAt: number, peer: (string|undefined), sessionKey: (string|undefined), origin: (string|null|undefined) }|{ ok: false, error: string }}
 */
function verifyAssertion (input, expected = {}) {
  const peerMode = expected.peer != null && expected.peer !== '';
  let origin = null;
  let peer = null;
  if (peerMode) {
    peer = compressedPubkey(expected.peer);
    if (!peer) return { ok: false, error: 'expected peer must be a compressed pubkey' };
  } else {
    origin = normalizeOrigin(expected.origin);
    if (!origin) return { ok: false, error: 'expected origin required' };
  }
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
  if (Number(fields.v) !== (peerMode ? PASSPORT_PEER_VERSION : PASSPORT_VERSION)) {
    return { ok: false, error: `unsupported Passport version ${fields.v}` };
  }
  if (peerMode) {
    if (compressedPubkey(fields.peer) !== peer) return { ok: false, error: 'peer mismatch' };
  } else {
    if (normalizeOrigin(fields.origin) !== origin) return { ok: false, error: 'origin mismatch' };
    if (fields.peer || fields.sessionKey) return { ok: false, error: 'a v2 assertion carries peer fields' };
  }
  if (!sameString(fields.nonce, expected.nonce)) return { ok: false, error: 'nonce mismatch' };
  const hash = Buffer.from(fields.challengeHash || []).toString('hex');
  if (!sameString(hash, expectedHash)) return { ok: false, error: 'challengeHash mismatch' };

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

  let sessionKey = null;
  if (peerMode) {
    sessionKey = compressedPubkey(fields.sessionKey);
    if (!sessionKey) return { ok: false, error: 'invalid sessionKey' };
    if (sessionKey.slice(2) === pubkey.slice(2)) return { ok: false, error: 'session key is the identity key' };
  }

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
    const scope = peerMode ? peerCosignerScope(peer, hash) : cosignerScope(origin, hash);
    const checked = readCosignerDisclosure(fields.cosigner, { identityPubkey: pubkey, scope });
    if (!checked.ok) return checked;
    cosigner = checked.cosigner;
  }

  const out = {
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
  if (peerMode) {
    out.peer = peer;
    out.sessionKey = sessionKey;
    out.origin = normalizeOrigin(fields.origin) || null;
  }
  return out;
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
    return { ok: false, error: 'wallet xpubs must be shareable account xpubs for the assertion network' };
  }
  if (JSON.stringify(wallet.descriptors) !== JSON.stringify(parsed.descriptors)) {
    return { ok: false, error: 'wallet descriptors do not match the xpubs' };
  }
  return { ok: true, wallet };
}

/**
 * @private
 * @param {string} text
 * @param {{ identityPubkey: string, scope: string }} context
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
    scope: context.scope,
    proof: parsed.proof
  });
  if (!valid) return { ok: false, error: 'cosigner proof does not verify for this sign-in' };
  return { ok: true, cosigner: { pubkey: cosignerPubkey, proof: String(parsed.proof).toLowerCase() } };
}

/** Longest refusal text. */
const PASSPORT_MAX_ERROR_LENGTH = 200;
/**
 * Say why a peer refused a frame (`PASSPORT_REFUSED`). Signed when `key` is given.
 * @param {Object} params
 * @param {string} params.error Short reason.
 * @param {string|Buffer|Message} [params.answers] The refused frame, or its sha256 hex.
 * @param {number} [params.now]
 * @param {Key} [key] The peer's key.
 * @returns {{ message: Message, uri: string }}
 */
function createRefusal (params = {}, key = null) {
  let answers = '';
  if (params.answers instanceof Message || Buffer.isBuffer(params.answers)) {
    const buffer = params.answers instanceof Message ? params.answers.toBuffer() : params.answers;
    answers = crypto.createHash('sha256').update(buffer).digest('hex');
  } else if (params.answers) {
    answers = hex32(params.answers);
    if (!NONCE_PATTERN.test(answers)) throw new TypeError('createRefusal: answers must be a frame or its hash');
  }
  const message = Message.fromFields('PASSPORT_REFUSED', {
    v: PASSPORT_PEER_VERSION,
    answers: answers ? Buffer.from(answers, 'hex') : Buffer.alloc(32),
    error: String(params.error || 'refused').slice(0, PASSPORT_MAX_ERROR_LENGTH),
    issuedAt: BigInt(Number.isFinite(params.now) ? params.now : Date.now())
  });
  if (key) {
    assertSigningKey(key);
    message.signWithKey(key);
  }
  return { message, uri: encodeFabricUri(message) };
}

/**
 * Read a `PASSPORT_REFUSED`.
 * @param {string|Buffer|Message} input
 * @returns {{ ok: true, error: string, answers: (string|null), author: (string|null) }|{ ok: false, error: string }}
 */
function readRefusal (input) {
  const decoded = decodeInput(input, { allowedTypes: ['PASSPORT_REFUSED'], allowUnsigned: true });
  if (!decoded.ok) return decoded;
  const fields = decoded.message.toFields();
  if (!fields) return { ok: false, error: 'malformed PASSPORT_REFUSED body' };
  const answers = hex32(fields.answers);
  return {
    ok: true,
    error: String(fields.error || 'refused').slice(0, PASSPORT_MAX_ERROR_LENGTH),
    answers: isHash(answers) ? answers : null,
    author: decoded.author
  };
}

/**
 * Confirm a peer session (`PASSPORT_SESSION`), signed by the peer: from now
 * on `sessionKey` speaks for `pubkey` on this peer until `expiresAt`.
 * @param {Object} params
 * @param {string} params.assertionHash sha256 of the assertion frame, hex.
 * @param {string} params.pubkey The identity's compressed pubkey.
 * @param {string} params.sessionKey The session key the assertion named.
 * @param {string} [params.sessionId] 64 hex characters (generated when omitted).
 * @param {number} [params.ttlMs] Default {@link PASSPORT_SESSION_DEFAULT_TTL_MS}.
 * @param {number} [params.now]
 * @param {Key} key The peer's identity key.
 * @returns {{ message: Message, uri: string, sessionId: string, peer: string, identity: { id: string, pubkey: string }, sessionKey: string, issuedAt: number, expiresAt: number }}
 */
function createPeerSession (params = {}, key) {
  assertSigningKey(key);
  const peer = keyPubkey(key);
  const assertionHash = hex32(params.assertionHash);
  if (!isHash(assertionHash)) throw new TypeError('createPeerSession: assertionHash required');
  const pubkey = compressedPubkey(params.pubkey);
  if (!pubkey) throw new TypeError('createPeerSession: compressed identity pubkey required');
  const sessionKey = compressedPubkey(params.sessionKey);
  if (!sessionKey) throw new TypeError('createPeerSession: compressed sessionKey required');
  if (sessionKey.slice(2) === pubkey.slice(2)) throw new Error('createPeerSession: the session key is the identity key');
  const sessionId = params.sessionId != null ? hex32(params.sessionId) : createNonce();
  if (!isHash(sessionId)) throw new TypeError('sessionId must be 32 bytes of hex');
  const identityId = fabricIdentityIdFromPubkeyHex(pubkey);
  const issuedAt = Number.isFinite(params.now) ? params.now : Date.now();
  const expiresAt = issuedAt + sessionTtl(params.ttlMs);
  const message = Message.fromFields('PASSPORT_SESSION', {
    v: PASSPORT_PEER_VERSION,
    sessionId: Buffer.from(sessionId, 'hex'),
    assertionHash: Buffer.from(assertionHash, 'hex'),
    pubkey,
    identityId,
    sessionKey,
    issuedAt: BigInt(issuedAt),
    expiresAt: BigInt(expiresAt)
  });
  message.signWithKey(key);
  return {
    message,
    uri: encodeFabricUri(message),
    sessionId,
    peer,
    identity: { id: identityId, pubkey },
    sessionKey,
    issuedAt,
    expiresAt
  };
}

/**
 * Read a `PASSPORT_SESSION`.
 * @param {string|Buffer|Message} input
 * @param {Object} [options]
 * @param {string} [options.peer] The peer that must have signed it.
 * @param {string} [options.sessionKey] The session key it must confirm.
 * @param {string} [options.assertionHash] The assertion it must answer.
 * @param {number} [options.now]
 * @returns {{ ok: true, session: { sessionId: string, assertionHash: string, identity: { id: string, pubkey: string }, sessionKey: string, issuedAt: number, expiresAt: number }, author: string, hash: string }|{ ok: false, error: string }}
 */
function readPeerSession (input, options = {}) {
  const decoded = decodeInput(input, { allowedTypes: ['PASSPORT_SESSION'] });
  if (!decoded.ok) return decoded;
  const fields = decoded.message.toFields();
  if (!fields) return { ok: false, error: 'malformed PASSPORT_SESSION body' };
  if (Number(fields.v) !== PASSPORT_PEER_VERSION) return { ok: false, error: `unsupported Passport version ${fields.v}` };
  if (options.peer) {
    const peer = compressedPubkey(options.peer);
    if (!peer || peer.slice(2) !== decoded.author) return { ok: false, error: 'session is from another peer' };
  }
  const sessionId = hex32(fields.sessionId);
  if (!isHash(sessionId)) return { ok: false, error: 'missing sessionId' };
  const assertionHash = hex32(fields.assertionHash);
  if (!isHash(assertionHash)) return { ok: false, error: 'missing assertionHash' };
  if (options.assertionHash && !sameString(assertionHash, hex32(options.assertionHash))) {
    return { ok: false, error: 'session answers another assertion' };
  }
  const pubkey = compressedPubkey(fields.pubkey);
  if (!pubkey) return { ok: false, error: 'invalid pubkey' };
  let identityId;
  try {
    identityId = fabricIdentityIdFromPubkeyHex(pubkey);
  } catch (_) {
    return { ok: false, error: 'invalid pubkey' };
  }
  if (String(fields.identityId) !== identityId) return { ok: false, error: 'identity id does not match pubkey' };
  const sessionKey = compressedPubkey(fields.sessionKey);
  if (!sessionKey) return { ok: false, error: 'invalid sessionKey' };
  if (sessionKey.slice(2) === pubkey.slice(2)) return { ok: false, error: 'session key is the identity key' };
  if (options.sessionKey && compressedPubkey(options.sessionKey) !== sessionKey) {
    return { ok: false, error: 'session confirms another session key' };
  }
  const issuedAt = toMillis(fields.issuedAt);
  const expiresAt = toMillis(fields.expiresAt);
  const windowError = checkWindow(issuedAt, expiresAt, Object.assign({}, options, { maxTtlMs: Infinity }));
  if (windowError && windowError !== 'lifetime too long') return { ok: false, error: `session ${windowError}` };
  if (expiresAt - issuedAt > PASSPORT_SESSION_MAX_TTL_MS) return { ok: false, error: 'session lifetime too long' };
  return {
    ok: true,
    session: { sessionId, assertionHash, identity: { id: identityId, pubkey }, sessionKey, issuedAt, expiresAt },
    author: decoded.author,
    hash: crypto.createHash('sha256').update(decoded.buffer).digest('hex')
  };
}

/**
 * Re-bind a session on a new connection (`PASSPORT_RESUME`): answer the peer's
 * fresh v3 challenge with the session key instead of the identity key.
 * @param {Object} params
 * @param {string} params.sessionId
 * @param {string|Buffer|Message} params.challenge The peer's v3 challenge on the new connection.
 * @param {string} [params.peer] The peer expected.
 * @param {number} [params.ttlMs]
 * @param {number} [params.now]
 * @param {Key} sessionKey The session's private key.
 * @returns {{ message: Message, uri: string, sessionId: string, challengeHash: string, expiresAt: number }}
 */
function createResume (params = {}, sessionKey) {
  assertSigningKey(sessionKey);
  const sessionId = hex32(params.sessionId);
  if (!isHash(sessionId)) throw new TypeError('createResume: sessionId required');
  const read = readChallenge(params.challenge, { now: params.now, peer: params.peer });
  if (!read.ok) throw new Error(`createResume: ${read.error}`);
  if (read.challenge.v !== PASSPORT_PEER_VERSION) throw new Error('createResume: not a peer challenge');
  const issuedAt = Number.isFinite(params.now) ? params.now : Date.now();
  const expiresAt = Math.min(issuedAt + clampTtl(params.ttlMs), read.challenge.expiresAt);
  const message = Message.fromFields('PASSPORT_RESUME', {
    v: PASSPORT_PEER_VERSION,
    sessionId: Buffer.from(sessionId, 'hex'),
    peer: read.challenge.peer,
    nonce: read.challenge.nonce,
    challengeHash: Buffer.from(read.hash, 'hex'),
    issuedAt: BigInt(issuedAt),
    expiresAt: BigInt(expiresAt)
  });
  message.signWithKey(sessionKey);
  return { message, uri: encodeFabricUri(message), sessionId, challengeHash: read.hash, expiresAt };
}

/**
 * Read a `PASSPORT_RESUME` against the challenge this peer issued on the
 * connection. Whether the author is the session's key is the caller's check
 * (or pass `expected.sessionKey`).
 * @param {string|Buffer|Message} input
 * @param {Object} expected
 * @param {string} expected.peer This peer's compressed pubkey.
 * @param {string} expected.nonce
 * @param {string} expected.challengeHash
 * @param {number} [expected.challengeExpiresAt]
 * @param {string} [expected.sessionKey]
 * @param {number} [expected.now]
 * @returns {{ ok: true, sessionId: string, author: string, expiresAt: number }|{ ok: false, error: string }}
 */
function readResume (input, expected = {}) {
  const peer = compressedPubkey(expected.peer);
  if (!peer) return { ok: false, error: 'expected peer must be a compressed pubkey' };
  if (!expected.nonce) return { ok: false, error: 'expected nonce required' };
  const expectedHash = String(expected.challengeHash || '').toLowerCase();
  if (!NONCE_PATTERN.test(expectedHash)) return { ok: false, error: 'expected challengeHash required' };
  const decoded = decodeInput(input, { allowedTypes: ['PASSPORT_RESUME'] });
  if (!decoded.ok) return decoded;
  const fields = decoded.message.toFields();
  if (!fields) return { ok: false, error: 'malformed PASSPORT_RESUME body' };
  if (Number(fields.v) !== PASSPORT_PEER_VERSION) return { ok: false, error: `unsupported Passport version ${fields.v}` };
  if (compressedPubkey(fields.peer) !== peer) return { ok: false, error: 'peer mismatch' };
  if (!sameString(fields.nonce, expected.nonce)) return { ok: false, error: 'nonce mismatch' };
  if (!sameString(hex32(fields.challengeHash), expectedHash)) return { ok: false, error: 'challengeHash mismatch' };
  const issuedAt = toMillis(fields.issuedAt);
  const expiresAt = toMillis(fields.expiresAt);
  const windowError = checkWindow(issuedAt, expiresAt, expected);
  if (windowError) return { ok: false, error: `resume ${windowError}` };
  if (Number.isFinite(expected.challengeExpiresAt) && expiresAt > expected.challengeExpiresAt) {
    return { ok: false, error: 'resume outlives its challenge' };
  }
  const sessionId = hex32(fields.sessionId);
  if (!isHash(sessionId)) return { ok: false, error: 'missing sessionId' };
  if (expected.sessionKey) {
    const sessionKey = compressedPubkey(expected.sessionKey);
    if (!sessionKey || sessionKey.slice(2) !== decoded.author) return { ok: false, error: 'resume is not signed by the session key' };
  }
  return { ok: true, sessionId, author: decoded.author, expiresAt };
}

module.exports = {
  PASSPORT_VERSION,
  PASSPORT_PEER_VERSION,
  PASSPORT_SESSION_DEFAULT_TTL_MS,
  PASSPORT_SESSION_MAX_TTL_MS,
  PASSPORT_MAX_HOMES,
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
  peerCosignerScope,
  createChallenge,
  readChallenge,
  signAssertion,
  verifyAssertion,
  createConnect,
  readConnect,
  createPeerChallenge,
  createPeerSession,
  readPeerSession,
  createResume,
  readResume,
  createRefusal,
  readRefusal
};
