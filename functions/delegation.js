'use strict';

/**
 * @fileoverview Delegation: one Fabric key holder asks another to sign.
 *
 * Participants (Passport, a Hub, GoonCitizen, any Fabric key) never share
 * keys or storage. Everything between them is a signed Fabric Message frame,
 * carried as a `fabric:` string through a rendezvous or a mailbox:
 *
 * - Pairing, so each learns the other's key: `DELEGATION_LINK_OFFER` commits
 *   to the initiator's nonce, `DELEGATION_LINK_ANSWER` brings the responder's
 *   nonce, `DELEGATION_LINK_REVEAL` opens the commitment. Both screens then
 *   show the same six-digit code ({@link sas}); neither side could choose its
 *   nonce after seeing the other's, so a relay in the middle matches it with
 *   odds of one in a million.
 * - `DELEGATION_GRANT`: the author lets `grantee` ask it to sign, for listed
 *   scopes (`identity`, `passport`, `federation`, `message`) and optional
 *   origins / networks. It discloses the author's cosigner key with a proof,
 *   so grants are enough to build a shared federation wallet. A grant runs
 *   one way; two `identity` grants, one each way, mean "the same person".
 * - `DELEGATION_REVOKE` withdraws a grant.
 * - `DELEGATION_REQUEST` embeds one frame for the target to sign: a
 *   `PASSPORT_CHALLENGE` (answered with a `PASSPORT_ASSERTION`), a federation
 *   `CONTRACT_MESSAGE` (an invite or a withdrawal request), or an unsigned
 *   chat / generic message. The target answers with a `DELEGATION_RESULT`
 *   holding the answer frame or a refusal.
 * - `DELEGATION_MAILBOX_FETCH` proves a reader holds the key whose mail it asks for.
 *
 * Authority always comes from the recipient's own grants ({@link authorize});
 * a rendezvous or mailbox only carries frames.
 *
 * @module functions/delegation
 */

const crypto = require('crypto');
const Actor = require('../types/actor');
const Message = require('../types/message');
const { encodeFabricUri, decodeFabricUri } = require('./fabricUri');
const { normalizeAccountNetwork, cosignerProof, verifyCosignerProof } = require('./accountKeys');
const { normalizeOrigin, readChallenge, signAssertion, PASSPORT_DISCLOSURES } = require('./passport');
const {
  DELEGATION_LINK_MAX_TTL_MS,
  DELEGATION_REQUEST_MAX_TTL_MS
} = require('../constants');

/** Protocol version carried in every frame. */
const DELEGATION_VERSION = 1;
/** What a grant may allow. */
const DELEGATION_SCOPES = Object.freeze(['identity', 'passport', 'federation', 'message']);
/** Default lifetime of a pairing frame or a mailbox read. */
const DELEGATION_LINK_TTL_MS = 2 * 60 * 1000;
/** Default lifetime of a request. */
const DELEGATION_REQUEST_TTL_MS = 10 * 60 * 1000;
/** Allowed clock difference between participants. */
const DELEGATION_CLOCK_SKEW_MS = 30 * 1000;
/** Longest label or purpose text. */
const DELEGATION_MAX_LABEL = 64;
const DELEGATION_MAX_PURPOSE = 140;
/** Federation message types a delegate may be asked to answer. */
const FEDERATION_REQUEST_TYPES = Object.freeze(['FederationInvite', 'FederationWithdrawalRequest']);
/** Frame types a `message` grant lets the grantee have signed (never protocol frames). */
const MESSAGE_SCOPE_TYPES = Object.freeze(['GENERIC_MESSAGE', 'P2P_CHAT_MESSAGE', 'CHAT_MESSAGE']);

/** @private */
const COMMIT_TAG = 'fabric-pairing:2:commit';
/** @private */
const SAS_TAG = 'fabric-pairing:2:sas';
/** @private */
const HEX32 = /^[0-9a-f]{64}$/;
/** @private */
const COMPRESSED = /^0[23][0-9a-f]{64}$/;
/** @private */
const ZERO32 = '0'.repeat(64);

/**
 * sha256 of a frame, hex: the id every participant uses for it.
 * @param {string|Buffer|Message} frame `fabric:` string, frame bytes, or Message.
 * @returns {string}
 */
function frameHash (frame) {
  return sha256(frameBuffer(frame)).toString('hex');
}

/** @private */
function sha256 (data) {
  return crypto.createHash('sha256').update(data).digest();
}

/** @private */
function frameBuffer (frame) {
  if (frame instanceof Message) return frame.toBuffer();
  if (Buffer.isBuffer(frame) || frame instanceof Uint8Array) return Buffer.from(frame);
  const decoded = decodeFabricUri(String(frame || ''), { allowUnsigned: true, allowUnknownTypes: true });
  if (!decoded.ok) throw new TypeError(`frame: ${decoded.error}`);
  return decoded.buffer;
}

/** @private */
function decodeFrame (input, types, options = {}) {
  let uri = input;
  if (input instanceof Message) uri = encodeFabricUri(input.toBuffer());
  else if (Buffer.isBuffer(input) || input instanceof Uint8Array) uri = encodeFabricUri(Buffer.from(input));
  return decodeFabricUri(uri, Object.assign({ allowedTypes: types }, options));
}

/**
 * x-only hex of a compressed or x-only pubkey.
 * @param {string} pubkey
 * @returns {string|null}
 */
function xOnly (pubkey) {
  const hex = String(pubkey || '').trim().toLowerCase();
  if (COMPRESSED.test(hex)) return hex.slice(2);
  if (HEX32.test(hex)) return hex;
  return null;
}

/** @private */
function compressed (pubkey) {
  const hex = String(pubkey || '').trim().toLowerCase();
  return COMPRESSED.test(hex) ? hex : null;
}

/** @private */
function assertSigningKey (key) {
  if (!key || !key.private || typeof key.signSchnorrHash !== 'function') {
    throw new TypeError('a private signing Key is required');
  }
}

/** @private */
function keyPubkey (key) {
  const pubkey = compressed(key.pubkey);
  if (!pubkey) throw new TypeError('the signing key has no compressed pubkey');
  return pubkey;
}

/** @private */
function randomHex32 () {
  return Buffer.from(Actor.randomBytes(32)).toString('hex');
}

/** @private */
function toMillis (value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

/** @private */
function hexOf (value) {
  return Buffer.isBuffer(value) ? value.toString('hex') : String(value || '');
}

/** @private */
function clampTtl (ttlMs, fallback, max) {
  const n = Number(ttlMs);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

/** @private */
function checkWindow (issuedAt, expiresAt, maxTtl, options = {}) {
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const skew = Number.isFinite(options.clockSkewMs) ? options.clockSkewMs : DELEGATION_CLOCK_SKEW_MS;
  if (!issuedAt) return 'missing issuedAt';
  if (!expiresAt) return 'missing expiresAt';
  if (expiresAt <= issuedAt) return 'expires before it is issued';
  if (expiresAt <= now - skew) return 'expired';
  if (issuedAt > now + skew) return 'issued in the future';
  if (expiresAt - issuedAt > maxTtl) return 'lifetime too long';
  return null;
}

/** @private */
function checkIssued (issuedAt, options = {}) {
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const skew = Number.isFinite(options.clockSkewMs) ? options.clockSkewMs : DELEGATION_CLOCK_SKEW_MS;
  if (!issuedAt) return 'missing issuedAt';
  if (issuedAt > now + skew) return 'issued in the future';
  return null;
}

/**
 * Label as shown and signed: no control or bidi characters, at most 64 characters.
 * @param {string} label
 * @returns {string}
 */
function cleanLabel (label) {
  return String(label == null ? '' : label)
    .replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .trim()
    .slice(0, DELEGATION_MAX_LABEL);
}

/**
 * Browser extension origin (`chrome-extension://<id>`, `moz-extension://<uuid>`), or null.
 * @param {string} value
 * @returns {string|null}
 */
function normalizeExtensionOrigin (value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  let url;
  try {
    url = new URL(value.trim());
  } catch (_) {
    return null;
  }
  if (url.protocol !== 'chrome-extension:' && url.protocol !== 'moz-extension:') return null;
  if (!url.host || !/^[a-z0-9-]{8,64}$/i.test(url.host)) return null;
  return `${url.protocol}//${url.host.toLowerCase()}`;
}

/** @private */
function list (value) {
  if (value == null || value === '') return [];
  const items = Array.isArray(value) ? value : String(value).split(',');
  return items.map((item) => String(item).trim()).filter(Boolean);
}

/** @private */
function normalizeScopes (value) {
  const items = list(value);
  for (const item of items) {
    if (!DELEGATION_SCOPES.includes(item)) throw new TypeError(`unknown scope: ${item}`);
  }
  return DELEGATION_SCOPES.filter((scope) => items.includes(scope));
}

/** @private */
function normalizeOrigins (value) {
  const out = [];
  for (const item of list(value)) {
    const origin = normalizeOrigin(item);
    if (!origin) throw new TypeError(`invalid origin: ${item}`);
    if (!out.includes(origin)) out.push(origin);
  }
  return out.sort();
}

/** @private */
function normalizeNetworks (value) {
  const out = [];
  for (const item of list(value)) {
    const network = normalizeAccountNetwork(item);
    if (!out.includes(network)) out.push(network);
  }
  return out.sort();
}

/**
 * Commitment an offer carries: sha256 over the tag, the initiator's x-only
 * pubkey, and its secret nonce.
 * @param {string} initiator Pubkey hex.
 * @param {string} nonce 64 hex.
 * @returns {string}
 */
function commitment (initiator, nonce) {
  const x = xOnly(initiator);
  if (!x) throw new TypeError('commitment: initiator pubkey required');
  if (!HEX32.test(String(nonce))) throw new TypeError('commitment: nonce must be 32 bytes of hex');
  return sha256(`${COMMIT_TAG}\n${x}\n${nonce}`).toString('hex');
}

/**
 * The six-digit code both sides show once the reveal is in.
 * @param {Object} params
 * @param {string} params.initiator Pubkey hex (offer author).
 * @param {string} params.responder Pubkey hex (answer author).
 * @param {string} params.initiatorNonce
 * @param {string} params.responderNonce
 * @param {string} params.linkId Offer frame hash.
 * @returns {string}
 */
function sas (params = {}) {
  const a = xOnly(params.initiator);
  const b = xOnly(params.responder);
  if (!a || !b) throw new TypeError('sas: both pubkeys required');
  if (a === b) throw new Error('sas: a key cannot pair with itself');
  for (const value of [params.initiatorNonce, params.responderNonce, params.linkId]) {
    if (!HEX32.test(String(value))) throw new TypeError('sas: nonces and linkId must be 32 bytes of hex');
  }
  const digest = sha256(`${SAS_TAG}\n${a}\n${b}\n${params.initiatorNonce}\n${params.responderNonce}\n${params.linkId}`);
  return String(digest.readUInt32BE(0) % 1000000).padStart(6, '0');
}

/**
 * Start pairing.
 * @param {Object} params
 * @param {string} params.origin The rendezvous (Hub) the frames go through.
 * @param {string} [params.label] What this participant calls itself.
 * @param {string} [params.network]
 * @param {string} [params.nonce] Secret nonce (generated when omitted); keep it for the reveal.
 * @param {number} [params.ttlMs]
 * @param {number} [params.now]
 * @param {Key} key
 * @returns {{ message: Message, uri: string, linkId: string, nonce: string, commitment: string, expiresAt: number }}
 */
function createLinkOffer (params = {}, key) {
  assertSigningKey(key);
  const origin = normalizeOrigin(params.origin);
  if (!origin) throw new TypeError('createLinkOffer: http(s) origin required');
  const nonce = params.nonce != null ? String(params.nonce).toLowerCase() : randomHex32();
  const commit = commitment(key.pubkey, nonce);
  const network = params.network ? normalizeAccountNetwork(params.network) : '';
  const issuedAt = Number.isFinite(params.now) ? params.now : Date.now();
  const expiresAt = issuedAt + clampTtl(params.ttlMs, DELEGATION_LINK_TTL_MS, DELEGATION_LINK_MAX_TTL_MS);
  const message = Message.fromFields('DELEGATION_LINK_OFFER', {
    v: DELEGATION_VERSION,
    pubkey: keyPubkey(key),
    origin,
    label: cleanLabel(params.label),
    network,
    commitment: Buffer.from(commit, 'hex'),
    issuedAt: BigInt(issuedAt),
    expiresAt: BigInt(expiresAt)
  });
  message.signWithKey(key);
  return { message, uri: encodeFabricUri(message), linkId: frameHash(message), nonce, commitment: commit, expiresAt };
}

/**
 * Read a `DELEGATION_LINK_OFFER`.
 * @param {string|Buffer|Message} input
 * @param {{ now: (number|undefined) }} [options]
 * @returns {{ ok: true, offer: { origin: string, label: string, network: (string|null), commitment: string, issuedAt: number, expiresAt: number }, author: string, pubkey: string, linkId: string, buffer: Buffer }|{ ok: false, error: string }}
 */
function readLinkOffer (input, options = {}) {
  const decoded = decodeFrame(input, ['DELEGATION_LINK_OFFER']);
  if (!decoded.ok) return decoded;
  const fields = decoded.message.toFields();
  if (!fields) return { ok: false, error: 'malformed DELEGATION_LINK_OFFER body' };
  if (Number(fields.v) !== DELEGATION_VERSION) return { ok: false, error: `unsupported delegation version ${fields.v}` };
  const pubkey = compressed(fields.pubkey);
  if (!pubkey || pubkey.slice(2) !== decoded.author) return { ok: false, error: 'pubkey does not match the frame author' };
  const origin = normalizeOrigin(fields.origin);
  if (!origin) return { ok: false, error: 'invalid origin' };
  let network = null;
  if (fields.network) {
    try {
      network = normalizeAccountNetwork(fields.network);
    } catch (_) {
      return { ok: false, error: 'unknown network' };
    }
  }
  const issuedAt = toMillis(fields.issuedAt);
  const expiresAt = toMillis(fields.expiresAt);
  const windowError = checkWindow(issuedAt, expiresAt, DELEGATION_LINK_MAX_TTL_MS, options);
  if (windowError) return { ok: false, error: `offer ${windowError}` };
  const commit = hexOf(fields.commitment);
  if (!HEX32.test(commit) || commit === ZERO32) return { ok: false, error: 'missing commitment' };
  return {
    ok: true,
    offer: { origin, label: cleanLabel(fields.label), network, commitment: commit, issuedAt, expiresAt },
    author: decoded.author,
    pubkey,
    linkId: sha256(decoded.buffer).toString('hex'),
    buffer: decoded.buffer
  };
}

/**
 * Answer an offer with this participant's nonce (picked after the commitment is fixed).
 * @param {Object} params
 * @param {string|Buffer|Message} params.offer
 * @param {string} [params.label]
 * @param {string} [params.nonce]
 * @param {number} [params.ttlMs]
 * @param {number} [params.now]
 * @param {Key} key
 * @returns {{ message: Message, uri: string, hash: string, linkId: string, nonce: string, initiator: string, expiresAt: number }}
 */
function createLinkAnswer (params = {}, key) {
  assertSigningKey(key);
  const read = readLinkOffer(params.offer, { now: params.now });
  if (!read.ok) throw new Error(`createLinkAnswer: ${read.error}`);
  if (read.author === xOnly(key.pubkey)) throw new Error('createLinkAnswer: a key cannot pair with itself');
  const nonce = params.nonce != null ? String(params.nonce).toLowerCase() : randomHex32();
  if (!HEX32.test(nonce)) throw new TypeError('nonce must be 32 bytes of hex');
  const issuedAt = Number.isFinite(params.now) ? params.now : Date.now();
  const expiresAt = Math.min(issuedAt + clampTtl(params.ttlMs, DELEGATION_LINK_TTL_MS, DELEGATION_LINK_MAX_TTL_MS), read.offer.expiresAt + DELEGATION_LINK_MAX_TTL_MS);
  const message = Message.fromFields('DELEGATION_LINK_ANSWER', {
    v: DELEGATION_VERSION,
    pubkey: keyPubkey(key),
    offer: Buffer.from(read.linkId, 'hex'),
    nonce: Buffer.from(nonce, 'hex'),
    label: cleanLabel(params.label),
    issuedAt: BigInt(issuedAt),
    expiresAt: BigInt(expiresAt)
  });
  message.signWithKey(key);
  return { message, uri: encodeFabricUri(message), hash: frameHash(message), linkId: read.linkId, nonce, initiator: read.author, expiresAt };
}

/**
 * Read a `DELEGATION_LINK_ANSWER`.
 * @param {string|Buffer|Message} input
 * @param {{ now: (number|undefined) }} [options]
 * @returns {{ ok: true, answer: { offer: string, nonce: string, label: string, issuedAt: number, expiresAt: number }, author: string, pubkey: string, hash: string, buffer: Buffer }|{ ok: false, error: string }}
 */
function readLinkAnswer (input, options = {}) {
  const decoded = decodeFrame(input, ['DELEGATION_LINK_ANSWER']);
  if (!decoded.ok) return decoded;
  const fields = decoded.message.toFields();
  if (!fields) return { ok: false, error: 'malformed DELEGATION_LINK_ANSWER body' };
  if (Number(fields.v) !== DELEGATION_VERSION) return { ok: false, error: `unsupported delegation version ${fields.v}` };
  const pubkey = compressed(fields.pubkey);
  if (!pubkey || pubkey.slice(2) !== decoded.author) return { ok: false, error: 'pubkey does not match the frame author' };
  const issuedAt = toMillis(fields.issuedAt);
  const expiresAt = toMillis(fields.expiresAt);
  const windowError = checkWindow(issuedAt, expiresAt, DELEGATION_LINK_MAX_TTL_MS, options);
  if (windowError) return { ok: false, error: `answer ${windowError}` };
  const offer = hexOf(fields.offer);
  const nonce = hexOf(fields.nonce);
  if (!HEX32.test(offer) || offer === ZERO32) return { ok: false, error: 'missing offer hash' };
  if (!HEX32.test(nonce) || nonce === ZERO32) return { ok: false, error: 'missing nonce' };
  return {
    ok: true,
    answer: { offer, nonce, label: cleanLabel(fields.label), issuedAt, expiresAt },
    author: decoded.author,
    pubkey,
    hash: sha256(decoded.buffer).toString('hex'),
    buffer: decoded.buffer
  };
}

/**
 * Open the commitment once the answer is in.
 * @param {Object} params
 * @param {string|Buffer|Message} params.offer This participant's own offer.
 * @param {string|Buffer|Message} params.answer
 * @param {string} params.nonce The secret nonce the offer committed to.
 * @param {number} [params.ttlMs]
 * @param {number} [params.now]
 * @param {Key} key
 * @returns {{ message: Message, uri: string, hash: string, linkId: string, sas: string, responder: string }}
 */
function createLinkReveal (params = {}, key) {
  assertSigningKey(key);
  const offer = readLinkOffer(params.offer, { now: params.now });
  if (!offer.ok) throw new Error(`createLinkReveal: ${offer.error}`);
  if (offer.author !== xOnly(key.pubkey)) throw new Error('createLinkReveal: not this key\'s offer');
  const answer = readLinkAnswer(params.answer, { now: params.now });
  if (!answer.ok) throw new Error(`createLinkReveal: ${answer.error}`);
  if (answer.answer.offer !== offer.linkId) throw new Error('createLinkReveal: the answer is for another offer');
  if (answer.author === offer.author) throw new Error('createLinkReveal: a key cannot pair with itself');
  const nonce = String(params.nonce || '').toLowerCase();
  if (commitment(key.pubkey, nonce) !== offer.offer.commitment) throw new Error('createLinkReveal: nonce does not open the commitment');
  const issuedAt = Number.isFinite(params.now) ? params.now : Date.now();
  const expiresAt = issuedAt + clampTtl(params.ttlMs, DELEGATION_LINK_TTL_MS, DELEGATION_LINK_MAX_TTL_MS);
  const message = Message.fromFields('DELEGATION_LINK_REVEAL', {
    v: DELEGATION_VERSION,
    answer: Buffer.from(answer.hash, 'hex'),
    nonce: Buffer.from(nonce, 'hex'),
    issuedAt: BigInt(issuedAt),
    expiresAt: BigInt(expiresAt)
  });
  message.signWithKey(key);
  const code = sas({
    initiator: offer.author,
    responder: answer.author,
    initiatorNonce: nonce,
    responderNonce: answer.answer.nonce,
    linkId: offer.linkId
  });
  return { message, uri: encodeFabricUri(message), hash: frameHash(message), linkId: offer.linkId, sas: code, responder: answer.author };
}

/**
 * Read a `DELEGATION_LINK_REVEAL`.
 * @param {string|Buffer|Message} input
 * @param {{ now: (number|undefined) }} [options]
 * @returns {{ ok: true, reveal: { answer: string, nonce: string, issuedAt: number, expiresAt: number }, author: string, hash: string, buffer: Buffer }|{ ok: false, error: string }}
 */
function readLinkReveal (input, options = {}) {
  const decoded = decodeFrame(input, ['DELEGATION_LINK_REVEAL']);
  if (!decoded.ok) return decoded;
  const fields = decoded.message.toFields();
  if (!fields) return { ok: false, error: 'malformed DELEGATION_LINK_REVEAL body' };
  if (Number(fields.v) !== DELEGATION_VERSION) return { ok: false, error: `unsupported delegation version ${fields.v}` };
  const issuedAt = toMillis(fields.issuedAt);
  const expiresAt = toMillis(fields.expiresAt);
  const windowError = checkWindow(issuedAt, expiresAt, DELEGATION_LINK_MAX_TTL_MS, options);
  if (windowError) return { ok: false, error: `reveal ${windowError}` };
  const answer = hexOf(fields.answer);
  const nonce = hexOf(fields.nonce);
  if (!HEX32.test(answer) || answer === ZERO32) return { ok: false, error: 'missing answer hash' };
  if (!HEX32.test(nonce)) return { ok: false, error: 'missing nonce' };
  return {
    ok: true,
    reveal: { answer, nonce, issuedAt, expiresAt },
    author: decoded.author,
    hash: sha256(decoded.buffer).toString('hex'),
    buffer: decoded.buffer
  };
}

/**
 * Check a whole pairing transcript and compute its code. Each side runs this
 * on the three frames before showing the code.
 * @param {Object} frames
 * @param {string|Buffer|Message} frames.offer
 * @param {string|Buffer|Message} frames.answer
 * @param {string|Buffer|Message} frames.reveal
 * @param {{ now: (number|undefined) }} [options]
 * @returns {{ ok: true, linkId: string, revealHash: string, initiator: string, responder: string, pubkeys: { initiator: string, responder: string }, sas: string, origin: string, network: (string|null), labels: { initiator: string, responder: string } }|{ ok: false, error: string }}
 */
function verifyLink (frames = {}, options = {}) {
  const offer = readLinkOffer(frames.offer, options);
  if (!offer.ok) return offer;
  const answer = readLinkAnswer(frames.answer, options);
  if (!answer.ok) return answer;
  const reveal = readLinkReveal(frames.reveal, options);
  if (!reveal.ok) return reveal;
  if (answer.answer.offer !== offer.linkId) return { ok: false, error: 'the answer is for another offer' };
  if (reveal.reveal.answer !== answer.hash) return { ok: false, error: 'the reveal is for another answer' };
  if (reveal.author !== offer.author) return { ok: false, error: 'the reveal is not from the offer\'s author' };
  if (answer.author === offer.author) return { ok: false, error: 'a key cannot pair with itself' };
  if (commitment(offer.author, reveal.reveal.nonce) !== offer.offer.commitment) {
    return { ok: false, error: 'the reveal does not open the offer\'s commitment' };
  }
  return {
    ok: true,
    linkId: offer.linkId,
    revealHash: reveal.hash,
    initiator: offer.author,
    responder: answer.author,
    pubkeys: { initiator: offer.pubkey, responder: answer.pubkey },
    sas: sas({
      initiator: offer.author,
      responder: answer.author,
      initiatorNonce: reveal.reveal.nonce,
      responderNonce: answer.answer.nonce,
      linkId: offer.linkId
    }),
    origin: offer.offer.origin,
    network: offer.offer.network,
    labels: { initiator: offer.offer.label, responder: answer.answer.label }
  };
}

/**
 * Scope a grant's cosigner proof to that grant.
 * @param {{ grantee: string, link: string, issuedAt: number }} grant
 * @returns {string}
 */
function grantCosignerScope (grant) {
  return `delegation:${xOnly(grant.grantee)}:${grant.link || '-'}:${grant.issuedAt}`;
}

/**
 * Let `grantee` ask this key to sign.
 * @param {Object} params
 * @param {string} params.grantee Compressed pubkey.
 * @param {string[]} params.scopes Any of {@link DELEGATION_SCOPES}.
 * @param {string[]} [params.origins] Limit `passport` requests to these sites.
 * @param {string[]} [params.networks] Limit requests to these networks.
 * @param {string} [params.link] Reveal hash of the pairing it follows.
 * @param {Key} [params.cosignerKey] Disclose this participant's cosigner key.
 * @param {string} [params.extensionOrigin] The author's browser extension origin (Passport).
 * @param {string} [params.label]
 * @param {number} [params.now]
 * @param {Key} key The granting identity key.
 * @returns {{ message: Message, uri: string, hash: string, scopes: string[] }}
 */
function createGrant (params = {}, key) {
  assertSigningKey(key);
  const pubkey = keyPubkey(key);
  const grantee = compressed(params.grantee);
  if (!grantee) throw new TypeError('createGrant: compressed grantee pubkey required');
  if (grantee.slice(2) === pubkey.slice(2)) throw new Error('createGrant: a key cannot grant itself');
  const scopes = normalizeScopes(params.scopes);
  if (!scopes.length) throw new TypeError('createGrant: at least one scope required');
  const origins = normalizeOrigins(params.origins);
  const networks = normalizeNetworks(params.networks);
  const link = params.link ? String(params.link).toLowerCase() : '';
  if (link && !HEX32.test(link)) throw new TypeError('createGrant: link must be a reveal hash');
  let extensionOrigin = '';
  if (params.extensionOrigin) {
    extensionOrigin = normalizeExtensionOrigin(params.extensionOrigin);
    if (!extensionOrigin) throw new TypeError('createGrant: invalid extension origin');
  }
  const issuedAt = Number.isFinite(params.now) ? params.now : Date.now();
  let cosigner = '';
  let proof = '';
  if (params.cosignerKey) {
    cosigner = keyPubkey(params.cosignerKey);
    if (cosigner === pubkey) throw new Error('createGrant: the cosigner key is the identity key');
    proof = cosignerProof(params.cosignerKey, { identityPubkey: pubkey, scope: grantCosignerScope({ grantee, link, issuedAt }) });
  }
  const message = Message.fromFields('DELEGATION_GRANT', {
    v: DELEGATION_VERSION,
    pubkey,
    grantee,
    link,
    scopes: scopes.join(','),
    origins: origins.join(','),
    networks: networks.join(','),
    cosigner,
    cosignerProof: proof,
    extensionOrigin,
    label: cleanLabel(params.label),
    issuedAt: BigInt(issuedAt)
  });
  message.signWithKey(key);
  return { message, uri: encodeFabricUri(message), hash: frameHash(message), scopes };
}

/**
 * Read a `DELEGATION_GRANT`, checking its cosigner proof.
 * @param {string|Buffer|Message} input
 * @param {{ now: (number|undefined) }} [options]
 * @returns {{ ok: true, grant: { grantor: string, grantee: string, link: (string|null), scopes: string[], origins: string[], networks: string[], cosigner: (string|null), extensionOrigin: (string|null), label: string, issuedAt: number }, author: string, hash: string, buffer: Buffer }|{ ok: false, error: string }}
 */
function readGrant (input, options = {}) {
  const decoded = decodeFrame(input, ['DELEGATION_GRANT']);
  if (!decoded.ok) return decoded;
  const fields = decoded.message.toFields();
  if (!fields) return { ok: false, error: 'malformed DELEGATION_GRANT body' };
  if (Number(fields.v) !== DELEGATION_VERSION) return { ok: false, error: `unsupported delegation version ${fields.v}` };
  const grantor = compressed(fields.pubkey);
  if (!grantor || grantor.slice(2) !== decoded.author) return { ok: false, error: 'pubkey does not match the frame author' };
  const grantee = compressed(fields.grantee);
  if (!grantee) return { ok: false, error: 'invalid grantee' };
  if (grantee.slice(2) === grantor.slice(2)) return { ok: false, error: 'a key cannot grant itself' };
  let scopes;
  let origins;
  let networks;
  try {
    scopes = normalizeScopes(fields.scopes);
    origins = normalizeOrigins(fields.origins);
    networks = normalizeNetworks(fields.networks);
  } catch (err) {
    return { ok: false, error: err.message };
  }
  if (!scopes.length) return { ok: false, error: 'grant has no scope' };
  const link = String(fields.link || '');
  if (link && !HEX32.test(link)) return { ok: false, error: 'invalid link' };
  const issuedAt = toMillis(fields.issuedAt);
  const issuedError = checkIssued(issuedAt, options);
  if (issuedError) return { ok: false, error: `grant ${issuedError}` };
  let cosigner = null;
  if (fields.cosigner) {
    cosigner = compressed(fields.cosigner);
    if (!cosigner) return { ok: false, error: 'invalid cosigner pubkey' };
    if (cosigner === grantor) return { ok: false, error: 'cosigner key is the identity key' };
    const valid = verifyCosignerProof({
      cosigner,
      identityPubkey: grantor,
      scope: grantCosignerScope({ grantee, link, issuedAt }),
      proof: fields.cosignerProof
    });
    if (!valid) return { ok: false, error: 'cosigner proof does not verify for this grant' };
  }
  let extensionOrigin = null;
  if (fields.extensionOrigin) {
    extensionOrigin = normalizeExtensionOrigin(fields.extensionOrigin);
    if (!extensionOrigin) return { ok: false, error: 'invalid extension origin' };
  }
  return {
    ok: true,
    grant: { grantor, grantee, link: link || null, scopes, origins, networks, cosigner, extensionOrigin, label: cleanLabel(fields.label), issuedAt },
    author: decoded.author,
    hash: sha256(decoded.buffer).toString('hex'),
    buffer: decoded.buffer
  };
}

/**
 * Withdraw a grant this key made.
 * @param {Object} params
 * @param {string} params.grant Grant hash (or the grant frame).
 * @param {number} [params.now]
 * @param {Key} key
 * @returns {{ message: Message, uri: string, hash: string, grant: string }}
 */
function createRevoke (params = {}, key) {
  assertSigningKey(key);
  let grant = String(params.grant || '').toLowerCase();
  if (!HEX32.test(grant)) {
    const read = readGrant(params.grant);
    if (!read.ok) throw new Error(`createRevoke: ${read.error}`);
    if (read.author !== xOnly(key.pubkey)) throw new Error('createRevoke: only the grantor revokes a grant');
    grant = read.hash;
  }
  const issuedAt = Number.isFinite(params.now) ? params.now : Date.now();
  const message = Message.fromFields('DELEGATION_REVOKE', {
    v: DELEGATION_VERSION,
    grant: Buffer.from(grant, 'hex'),
    issuedAt: BigInt(issuedAt)
  });
  message.signWithKey(key);
  return { message, uri: encodeFabricUri(message), hash: frameHash(message), grant };
}

/**
 * Read a `DELEGATION_REVOKE`. The caller checks its author made the grant.
 * @param {string|Buffer|Message} input
 * @param {{ now: (number|undefined) }} [options]
 * @returns {{ ok: true, revoke: { grant: string, issuedAt: number }, author: string, hash: string, buffer: Buffer }|{ ok: false, error: string }}
 */
function readRevoke (input, options = {}) {
  const decoded = decodeFrame(input, ['DELEGATION_REVOKE']);
  if (!decoded.ok) return decoded;
  const fields = decoded.message.toFields();
  if (!fields) return { ok: false, error: 'malformed DELEGATION_REVOKE body' };
  if (Number(fields.v) !== DELEGATION_VERSION) return { ok: false, error: `unsupported delegation version ${fields.v}` };
  const grant = hexOf(fields.grant);
  if (!HEX32.test(grant) || grant === ZERO32) return { ok: false, error: 'missing grant hash' };
  const issuedAt = toMillis(fields.issuedAt);
  const issuedError = checkIssued(issuedAt, options);
  if (issuedError) return { ok: false, error: `revoke ${issuedError}` };
  return { ok: true, revoke: { grant, issuedAt }, author: decoded.author, hash: sha256(decoded.buffer).toString('hex'), buffer: decoded.buffer };
}

/** @private Parse a CONTRACT_MESSAGE body (legacy JSON or `{ contract, payload }` fields). */
function contractBody (message) {
  const parsed = Message.tryParseMessageBody(message);
  if (!parsed.ok) return null;
  let value = parsed.value;
  if (parsed.encoding === 'fields' && typeof value.payload === 'string') {
    try {
      value = Object.assign({ contract: value.contract }, JSON.parse(value.payload));
    } catch (_) {
      return null;
    }
  }
  return value && typeof value === 'object' ? value : null;
}

/**
 * What an embedded frame asks for, and under which scope.
 * @param {Buffer} buffer Inner frame bytes.
 * @param {Object} [options]
 * @returns {{ ok: true, scope: string, type: string, hash: string, author: (string|null), buffer: Buffer, challenge: (object|undefined), body: (object|undefined), network: (string|null) }|{ ok: false, error: string }}
 */
function readInnerFrame (buffer, options = {}) {
  if (!buffer || !buffer.length) return { ok: false, error: 'no frame to sign' };
  const decoded = decodeFrame(buffer, null, { allowUnsigned: true });
  if (!decoded.ok) return { ok: false, error: `inner frame: ${decoded.error}` };
  const hash = sha256(decoded.buffer).toString('hex');
  if (decoded.type === 'PASSPORT_CHALLENGE') {
    const read = readChallenge(decoded.buffer, options);
    if (!read.ok) return { ok: false, error: `challenge: ${read.error}` };
    return { ok: true, scope: 'passport', type: decoded.type, hash, author: decoded.author, buffer: decoded.buffer, challenge: read.challenge, network: read.challenge.network };
  }
  if (decoded.type === 'CONTRACT_MESSAGE') {
    if (!decoded.signed) return { ok: false, error: 'a federation message must be signed by its sender' };
    const body = contractBody(decoded.message);
    if (!body || !FEDERATION_REQUEST_TYPES.includes(body.type)) return { ok: false, error: 'only federation invites and withdrawal requests can be delegated' };
    const network = body.descriptor && body.descriptor.network ? String(body.descriptor.network) : null;
    return { ok: true, scope: 'federation', type: body.type, hash, author: decoded.author, buffer: decoded.buffer, body, network };
  }
  if (MESSAGE_SCOPE_TYPES.includes(decoded.type)) {
    if (decoded.signed) return { ok: false, error: 'a message to sign must be unsigned' };
    return { ok: true, scope: 'message', type: decoded.type, hash, author: null, buffer: decoded.buffer, network: null };
  }
  return { ok: false, error: `${decoded.type} frames cannot be delegated` };
}

/**
 * Ask `target` to sign one frame, under the grant it made to this key.
 * @param {Object} params
 * @param {string} params.target Compressed pubkey of the participant asked.
 * @param {string} params.grant Hash of the target's grant to this key.
 * @param {string|Buffer|Message} params.request The frame to sign.
 * @param {string} [params.origin] The origin this participant saw (Passport challenges).
 * @param {number} [params.account=0] Account index the target signs with.
 * @param {string[]} [params.disclose] What the user agreed to share (Passport challenges).
 * @param {string} [params.purpose] Short text shown to the target's user.
 * @param {number} [params.ttlMs]
 * @param {number} [params.now]
 * @param {Key} key
 * @returns {{ message: Message, uri: string, hash: string, nonce: string, scope: string, expiresAt: number }}
 */
function createRequest (params = {}, key) {
  assertSigningKey(key);
  const pubkey = keyPubkey(key);
  const target = compressed(params.target);
  if (!target) throw new TypeError('createRequest: compressed target pubkey required');
  if (target.slice(2) === pubkey.slice(2)) throw new Error('createRequest: a key cannot ask itself');
  const grant = String(params.grant || '').toLowerCase();
  if (!HEX32.test(grant)) throw new TypeError('createRequest: grant hash required');
  const inner = readInnerFrame(frameBuffer(params.request), { now: params.now });
  if (!inner.ok) throw new Error(`createRequest: ${inner.error}`);
  let origin = '';
  let disclose = [];
  const issuedAt = Number.isFinite(params.now) ? params.now : Date.now();
  let expiresAt = issuedAt + clampTtl(params.ttlMs, DELEGATION_REQUEST_TTL_MS, DELEGATION_REQUEST_MAX_TTL_MS);
  if (inner.scope === 'passport') {
    origin = normalizeOrigin(params.origin);
    if (!origin) throw new TypeError('createRequest: the origin this participant saw is required');
    if (inner.challenge.origin !== origin) throw new Error('createRequest: the challenge names a different origin');
    disclose = list(params.disclose);
    for (const item of disclose) {
      if (!PASSPORT_DISCLOSURES.includes(item)) throw new TypeError(`createRequest: unknown disclosure ${item}`);
      if (!inner.challenge.request.includes(item)) throw new Error(`createRequest: the challenge did not ask for ${item}`);
    }
    expiresAt = Math.min(expiresAt, inner.challenge.expiresAt);
  }
  const account = params.account != null ? Number(params.account) : 0;
  if (!Number.isInteger(account) || account < 0 || account >= 0x80000000) throw new RangeError('account must be a BIP32 child index');
  const nonce = randomHex32();
  const message = Message.fromFields('DELEGATION_REQUEST', {
    v: DELEGATION_VERSION,
    pubkey,
    target,
    grant: Buffer.from(grant, 'hex'),
    nonce: Buffer.from(nonce, 'hex'),
    request: inner.buffer,
    origin,
    account,
    disclose: disclose.join(','),
    purpose: params.purpose != null ? cleanLabel(String(params.purpose)).slice(0, DELEGATION_MAX_PURPOSE) : '',
    issuedAt: BigInt(issuedAt),
    expiresAt: BigInt(expiresAt)
  });
  message.signWithKey(key);
  return { message, uri: encodeFabricUri(message), hash: frameHash(message), nonce, scope: inner.scope, expiresAt };
}

/**
 * Read a `DELEGATION_REQUEST` and the frame it embeds. Whether the author may
 * ask is {@link authorize}'s check, against the target's own grants.
 * @param {string|Buffer|Message} input
 * @param {{ now: (number|undefined) }} [options]
 * @returns {{ ok: true, request: { requester: string, target: string, grant: string, nonce: string, origin: (string|null), account: number, disclose: string[], purpose: string, issuedAt: number, expiresAt: number }, scope: string, inner: object, author: string, hash: string, buffer: Buffer }|{ ok: false, error: string }}
 */
function readRequest (input, options = {}) {
  const decoded = decodeFrame(input, ['DELEGATION_REQUEST']);
  if (!decoded.ok) return decoded;
  const fields = decoded.message.toFields();
  if (!fields) return { ok: false, error: 'malformed DELEGATION_REQUEST body' };
  if (Number(fields.v) !== DELEGATION_VERSION) return { ok: false, error: `unsupported delegation version ${fields.v}` };
  const requester = compressed(fields.pubkey);
  if (!requester || requester.slice(2) !== decoded.author) return { ok: false, error: 'pubkey does not match the frame author' };
  const target = compressed(fields.target);
  if (!target) return { ok: false, error: 'invalid target' };
  if (target.slice(2) === requester.slice(2)) return { ok: false, error: 'a key cannot ask itself' };
  const grant = hexOf(fields.grant);
  if (!HEX32.test(grant) || grant === ZERO32) return { ok: false, error: 'missing grant hash' };
  const nonce = hexOf(fields.nonce);
  if (!HEX32.test(nonce) || nonce === ZERO32) return { ok: false, error: 'missing nonce' };
  const issuedAt = toMillis(fields.issuedAt);
  const expiresAt = toMillis(fields.expiresAt);
  const windowError = checkWindow(issuedAt, expiresAt, DELEGATION_REQUEST_MAX_TTL_MS, options);
  if (windowError) return { ok: false, error: `request ${windowError}` };
  const inner = readInnerFrame(Buffer.from(fields.request || []), options);
  if (!inner.ok) return inner;
  let origin = null;
  let disclose = [];
  if (inner.scope === 'passport') {
    origin = normalizeOrigin(fields.origin);
    if (!origin) return { ok: false, error: 'invalid origin' };
    if (inner.challenge.origin !== origin) return { ok: false, error: 'the challenge names a different origin' };
    if (expiresAt > inner.challenge.expiresAt) return { ok: false, error: 'request outlives its challenge' };
    disclose = list(fields.disclose);
    for (const item of disclose) {
      if (!PASSPORT_DISCLOSURES.includes(item) || !inner.challenge.request.includes(item)) {
        return { ok: false, error: `the challenge did not ask for ${item}` };
      }
    }
  } else if (fields.origin || fields.disclose) {
    return { ok: false, error: 'origin and disclose apply to Passport challenges only' };
  }
  const account = Number(fields.account);
  if (!Number.isInteger(account) || account < 0 || account >= 0x80000000) return { ok: false, error: 'invalid account' };
  const purpose = String(fields.purpose || '');
  if (purpose.length > DELEGATION_MAX_PURPOSE) return { ok: false, error: 'purpose too long' };
  return {
    ok: true,
    request: { requester, target, grant, nonce, origin, account, disclose, purpose: cleanLabel(purpose), issuedAt, expiresAt },
    scope: inner.scope,
    inner,
    author: decoded.author,
    hash: sha256(decoded.buffer).toString('hex'),
    buffer: decoded.buffer
  };
}

/**
 * May this request be acted on? Checks it against the recipient's own grants:
 * the named grant exists, was made by the target to the requester, is not
 * revoked, covers the request's scope, and its origins / networks allow it.
 * @param {Object} read An `ok` {@link readRequest} result.
 * @param {Array<Object>} grants Grants the recipient made (read).
 * @param {Object} [options]
 * @param {Set<string>|string[]} [options.revoked] Revoked grant hashes.
 * @param {Function} [options.networkOf] `(read) => network` for frames that do not name one (a withdrawal names only its federation id).
 * @returns {{ ok: true, grant: object, scope: string }|{ ok: false, error: string }}
 */
function authorize (read, grants = [], options = {}) {
  if (!read || !read.ok) return { ok: false, error: 'unreadable request' };
  const revoked = options.revoked instanceof Set ? options.revoked : new Set(options.revoked || []);
  const found = (grants || []).find((g) => g && g.ok && g.hash === read.request.grant);
  if (!found) return { ok: false, error: 'no grant from this participant covers the request' };
  if (revoked.has(found.hash)) return { ok: false, error: 'the grant was revoked' };
  const grant = found.grant;
  if (grant.grantor.slice(2) !== read.request.target.slice(2)) return { ok: false, error: 'the grant is not this participant\'s' };
  if (grant.grantee.slice(2) !== read.author) return { ok: false, error: 'the grant is for another participant' };
  if (!grant.scopes.includes(read.scope)) return { ok: false, error: `the grant does not cover ${read.scope}` };
  if (read.scope === 'passport' && grant.origins.length && !grant.origins.includes(read.inner.challenge.origin)) {
    return { ok: false, error: `the grant does not cover ${read.inner.challenge.origin}` };
  }
  if (grant.networks.length) {
    let network = read.inner.network;
    if (!network && typeof options.networkOf === 'function') network = options.networkOf(read) || null;
    // A listed network is an allowlist, not a hint. A challenge that omits
    // network, and every message frame, would otherwise be signed for whatever
    // network the host passes.
    if (!network) {
      return {
        ok: false,
        error: read.scope === 'federation'
          ? 'the grant names networks and the federation is unknown here'
          : 'the grant names networks and this request does not'
      };
    }
    let normalized = null;
    try {
      normalized = normalizeAccountNetwork(network);
    } catch (_) {
      return { ok: false, error: `unknown network ${network}` };
    }
    if (!grant.networks.includes(normalized)) {
      return { ok: false, error: `the grant does not cover ${network}` };
    }
  }
  return { ok: true, grant: found, scope: read.scope };
}

/**
 * Answer (or refuse) a request.
 * @param {Object} params
 * @param {string} params.request Request hash.
 * @param {string|Buffer|Message} [params.answer] The signed answer frame.
 * @param {string} [params.refusal] Why it was refused (when there is no answer).
 * @param {string} [params.rule] Id of the rule that decided, if one did.
 * @param {number} [params.now]
 * @param {Key} key
 * @returns {{ message: Message, uri: string, hash: string }}
 */
function createResult (params = {}, key) {
  assertSigningKey(key);
  const request = String(params.request || '').toLowerCase();
  if (!HEX32.test(request)) throw new TypeError('createResult: request hash required');
  const answer = params.answer != null ? frameBuffer(params.answer) : Buffer.alloc(0);
  const refusal = params.refusal != null ? cleanLabel(String(params.refusal)).slice(0, DELEGATION_MAX_PURPOSE) : '';
  if (!answer.length && !refusal) throw new TypeError('createResult: an answer or a refusal is required');
  if (answer.length && refusal) throw new TypeError('createResult: an answer and a refusal are exclusive');
  const issuedAt = Number.isFinite(params.now) ? params.now : Date.now();
  const message = Message.fromFields('DELEGATION_RESULT', {
    v: DELEGATION_VERSION,
    request: Buffer.from(request, 'hex'),
    answer,
    refusal,
    rule: params.rule ? cleanLabel(String(params.rule)) : '',
    issuedAt: BigInt(issuedAt)
  });
  message.signWithKey(key);
  return { message, uri: encodeFabricUri(message), hash: frameHash(message) };
}

/**
 * Read a `DELEGATION_RESULT`. The answer frame is decoded (signature checked);
 * whether it answers the request is the requester's check.
 * @param {string|Buffer|Message} input
 * @param {{ now: (number|undefined) }} [options]
 * @returns {{ ok: true, result: { request: string, answer: (object|null), refusal: (string|null), rule: (string|null), issuedAt: number }, author: string, hash: string, buffer: Buffer }|{ ok: false, error: string }}
 */
function readResult (input, options = {}) {
  const decoded = decodeFrame(input, ['DELEGATION_RESULT']);
  if (!decoded.ok) return decoded;
  const fields = decoded.message.toFields();
  if (!fields) return { ok: false, error: 'malformed DELEGATION_RESULT body' };
  if (Number(fields.v) !== DELEGATION_VERSION) return { ok: false, error: `unsupported delegation version ${fields.v}` };
  const request = hexOf(fields.request);
  if (!HEX32.test(request) || request === ZERO32) return { ok: false, error: 'missing request hash' };
  const issuedAt = toMillis(fields.issuedAt);
  const issuedError = checkIssued(issuedAt, options);
  if (issuedError) return { ok: false, error: `result ${issuedError}` };
  const raw = Buffer.from(fields.answer || []);
  const refusal = String(fields.refusal || '');
  if (raw.length && refusal) return { ok: false, error: 'a result carries an answer or a refusal, not both' };
  if (!raw.length && !refusal) return { ok: false, error: 'a result needs an answer or a refusal' };
  let answer = null;
  if (raw.length) {
    const inner = decodeFrame(raw, null);
    if (!inner.ok) return { ok: false, error: `answer: ${inner.error}` };
    answer = { type: inner.type, author: inner.author, buffer: inner.buffer, uri: encodeFabricUri(inner.buffer), hash: sha256(inner.buffer).toString('hex') };
  }
  return {
    ok: true,
    result: { request, answer, refusal: refusal || null, rule: fields.rule ? String(fields.rule) : null, issuedAt },
    author: decoded.author,
    hash: sha256(decoded.buffer).toString('hex'),
    buffer: decoded.buffer
  };
}

/**
 * Prove this key may read its mailbox.
 * @param {Object} [params]
 * @param {number} [params.since] Mailbox sequence to read after.
 * @param {number} [params.ttlMs]
 * @param {number} [params.now]
 * @param {Key} key
 * @returns {{ message: Message, uri: string, nonce: string }}
 */
function createMailboxFetch (params = {}, key) {
  assertSigningKey(key);
  const issuedAt = Number.isFinite(params.now) ? params.now : Date.now();
  const expiresAt = issuedAt + clampTtl(params.ttlMs, DELEGATION_LINK_TTL_MS, DELEGATION_LINK_MAX_TTL_MS);
  const nonce = randomHex32();
  const message = Message.fromFields('DELEGATION_MAILBOX_FETCH', {
    v: DELEGATION_VERSION,
    pubkey: keyPubkey(key),
    since: BigInt(Math.max(0, Math.floor(Number(params.since) || 0))),
    nonce: Buffer.from(nonce, 'hex'),
    issuedAt: BigInt(issuedAt),
    expiresAt: BigInt(expiresAt)
  });
  message.signWithKey(key);
  return { message, uri: encodeFabricUri(message), nonce };
}

/**
 * Read a `DELEGATION_MAILBOX_FETCH`. Spending the nonce once is the mailbox's job.
 * @param {string|Buffer|Message} input
 * @param {{ now: (number|undefined) }} [options]
 * @returns {{ ok: true, pubkey: string, since: number, nonce: string, expiresAt: number }|{ ok: false, error: string }}
 */
function readMailboxFetch (input, options = {}) {
  const decoded = decodeFrame(input, ['DELEGATION_MAILBOX_FETCH']);
  if (!decoded.ok) return decoded;
  const fields = decoded.message.toFields();
  if (!fields) return { ok: false, error: 'malformed DELEGATION_MAILBOX_FETCH body' };
  if (Number(fields.v) !== DELEGATION_VERSION) return { ok: false, error: `unsupported delegation version ${fields.v}` };
  const pubkey = compressed(fields.pubkey);
  if (!pubkey || pubkey.slice(2) !== decoded.author) return { ok: false, error: 'pubkey does not match the frame author' };
  const issuedAt = toMillis(fields.issuedAt);
  const expiresAt = toMillis(fields.expiresAt);
  const windowError = checkWindow(issuedAt, expiresAt, DELEGATION_LINK_MAX_TTL_MS, options);
  if (windowError) return { ok: false, error: `mailbox read ${windowError}` };
  const nonce = hexOf(fields.nonce);
  if (!HEX32.test(nonce) || nonce === ZERO32) return { ok: false, error: 'missing nonce' };
  return { ok: true, pubkey, since: toMillis(fields.since), nonce, expiresAt };
}

/**
 * Which pubkey a mailbox frame is addressed to.
 * @param {string|Buffer|Message} input A request, result, grant, revoke, or pairing frame.
 * @param {Object} [hints]
 * @param {string} [hints.to] Compressed pubkey for frames that do not name one (results, revokes).
 * @returns {{ ok: true, to: string, type: string, hash: string, buffer: Buffer }|{ ok: false, error: string }}
 */
function mailboxAddress (input, hints = {}) {
  const decoded = decodeFrame(input, ['DELEGATION_REQUEST', 'DELEGATION_RESULT', 'DELEGATION_GRANT', 'DELEGATION_REVOKE']);
  if (!decoded.ok) return decoded;
  const fields = decoded.message.toFields();
  if (!fields) return { ok: false, error: 'malformed body' };
  let to = null;
  if (decoded.type === 'DELEGATION_REQUEST') to = compressed(fields.target);
  else if (decoded.type === 'DELEGATION_GRANT') to = compressed(fields.grantee);
  else to = compressed(hints.to);
  if (!to) return { ok: false, error: 'recipient pubkey required' };
  return { ok: true, to, type: decoded.type, hash: sha256(decoded.buffer).toString('hex'), buffer: decoded.buffer };
}

/**
 * Pubkeys linked to `self` as the same person: both have an unrevoked
 * `identity` grant to the other.
 * @param {string} self Pubkey hex.
 * @param {Array<Object>} grants Every grant known (made and received).
 * @param {Set<string>|string[]} [revoked]
 * @returns {string[]} Compressed pubkeys.
 */
function identityPeers (self, grants = [], revoked = []) {
  const me = xOnly(self);
  const gone = revoked instanceof Set ? revoked : new Set(revoked || []);
  const live = (grants || []).filter((g) => g && g.ok && !gone.has(g.hash) && g.grant.scopes.includes('identity'));
  const given = new Map();
  const received = new Map();
  for (const g of live) {
    if (g.grant.grantor.slice(2) === me) given.set(g.grant.grantee.slice(2), g.grant.grantee);
    if (g.grant.grantee.slice(2) === me) received.set(g.grant.grantor.slice(2), g.grant.grantor);
  }
  return [...given.keys()].filter((x) => received.has(x)).map((x) => received.get(x)).sort();
}

/**
 * What a recipient shows its user for a request. Every app renders this one shape.
 * @param {Object} read An `ok` {@link readRequest} result.
 * @param {Object} [context]
 * @param {string} [context.label] What this participant calls the requester.
 * @returns {{ kind: string, title: string, summary: string, from: { pubkey: string, label: string }, scope: string, priority: string, actions: string[], expiresAt: number, request: string }}
 */
function notificationFor (read, context = {}) {
  if (!read || !read.ok) throw new TypeError('notificationFor: a read request is required');
  const label = cleanLabel(context.label) || `${read.request.requester.slice(2, 10)}…`;
  let title = 'Sign a message';
  let summary = read.request.purpose || '';
  if (read.scope === 'passport') {
    const host = new URL(read.inner.challenge.origin).host;
    title = `Sign in to ${host}`;
    summary = read.inner.challenge.purpose || summary || `${label} asks you to sign in to ${host} for it.`;
  } else if (read.scope === 'federation') {
    const body = read.inner.body;
    if (body.type === 'FederationWithdrawalRequest') {
      title = `Co-sign a withdrawal of ${Number(body.amountSats)} sats`;
      summary = `To ${String(body.destinationAddress)} (fee ${Number(body.feeSats)} sats).`;
    } else {
      title = body.name ? `Join the shared wallet "${cleanLabel(body.name)}"` : 'Join a shared wallet';
      const validators = body.descriptor && Array.isArray(body.descriptor.validators) ? body.descriptor.validators.length : 0;
      const threshold = body.descriptor && body.descriptor.threshold;
      summary = threshold ? `${threshold} of ${validators} signers.` : summary;
    }
  } else if (!summary) {
    summary = `${label} asks you to sign a ${read.inner.type} message.`;
  }
  return {
    kind: 'DelegationRequest',
    title,
    summary,
    from: { pubkey: read.request.requester, label },
    scope: read.scope,
    priority: 'high',
    actions: ['sign', 'decline'],
    expiresAt: read.request.expiresAt,
    request: read.hash
  };
}

/**
 * Answer a Passport challenge request: sign the assertion for the origin the
 * requester saw, naming the requester as `device`.
 * @param {Object} read An `ok` passport-scope {@link readRequest} result.
 * @param {Object} params
 * @param {string} params.signer Passport signer label (`hub`, `gooncitizen`, `passport`).
 * @param {string} params.network
 * @param {Object} [params.wallet] To disclose `wallet`.
 * @param {Key} [params.cosignerKey] To disclose `cosigner`.
 * @param {number} [params.now]
 * @param {Key} key The identity key that answers.
 * @returns {Object}
 */
function answerPassport (read, params = {}, key) {
  if (!read || !read.ok || read.scope !== 'passport') throw new TypeError('answerPassport: a passport request is required');
  return signAssertion({
    challenge: read.inner.buffer,
    origin: read.request.origin,
    signer: params.signer,
    network: params.network,
    disclose: read.request.disclose,
    wallet: params.wallet,
    cosignerKey: params.cosignerKey,
    device: read.request.requester,
    now: params.now
  }, key);
}

/**
 * Sign a `message`-scope request's frame as this key.
 * @param {Object} read
 * @param {Key} key
 * @returns {Message}
 */
function answerMessage (read, key) {
  if (!read || !read.ok || read.scope !== 'message') throw new TypeError('answerMessage: a message request is required');
  assertSigningKey(key);
  return Message.fromBuffer(Buffer.from(read.inner.buffer)).signWithKey(key);
}

/**
 * The kind of frame `input` is, when it is a delegation frame.
 * @param {string|Buffer|Message} input
 * @returns {string|null}
 */
function delegationType (input) {
  try {
    const decoded = decodeFrame(input, null, { allowUnsigned: true });
    return decoded.ok && /^DELEGATION_/.test(decoded.type) ? decoded.type : null;
  } catch (_) {
    return null;
  }
}

module.exports = {
  DELEGATION_VERSION,
  DELEGATION_SCOPES,
  DELEGATION_LINK_TTL_MS,
  DELEGATION_REQUEST_TTL_MS,
  DELEGATION_CLOCK_SKEW_MS,
  FEDERATION_REQUEST_TYPES,
  MESSAGE_SCOPE_TYPES,
  frameHash,
  xOnly,
  cleanLabel,
  normalizeExtensionOrigin,
  commitment,
  sas,
  createLinkOffer,
  readLinkOffer,
  createLinkAnswer,
  readLinkAnswer,
  createLinkReveal,
  readLinkReveal,
  verifyLink,
  grantCosignerScope,
  createGrant,
  readGrant,
  createRevoke,
  readRevoke,
  readInnerFrame,
  createRequest,
  readRequest,
  authorize,
  createResult,
  readResult,
  createMailboxFetch,
  readMailboxFetch,
  mailboxAddress,
  identityPeers,
  notificationFor,
  answerPassport,
  answerMessage,
  delegationType
};
