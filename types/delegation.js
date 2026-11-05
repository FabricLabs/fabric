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
 * The frame builders and readers are statics on {@link Delegation} (and
 * plain properties of this module), so `require('@fabric/core/types/delegation').createGrant`
 * works without a participant.
 *
 * A `Delegation` instance is one participant's side: each participant
 * (Passport, a Hub, GoonCitizen) builds its own `Delegation` with its own
 * key and its own store; nothing is shared between them. It keeps
 * every delegation frame it sends or receives (replayable as a
 * `FabricMessageCollection`), its pairings, the grants it made and received,
 * revocations, and the requests it was asked and asked of others.
 *
 * Incoming frames go to {@link Delegation#receive}. An authorized request is
 * stored as pending and emitted as `request` with the notification to show;
 * the app answers with {@link Delegation#sign} or {@link Delegation#decline},
 * and sends the returned frames where they need to go (a rendezvous, a
 * mailbox, a loopback reply). This class never talks to the network itself.
 *
 * Events: `request` `{ hash, read, notification }`, `result` `{ hash, request, read }`,
 * `grant` `{ hash, read, direction }`, `revoke` `{ grant, hash }`,
 * `link` `{ linkId, sas, peer, role }`.
 *
 * @module types/delegation
 */

const crypto = require('crypto');
const EventEmitter = require('events');
const Actor = require('./actor');
const Message = require('./message');
const { encodeFabricUri, decodeFabricUri } = require('../functions/fabricUri');
const { normalizeAccountNetwork, cosignerProof, verifyCosignerProof } = require('../functions/accountKeys');
const { normalizeOrigin, readChallenge, signAssertion, PASSPORT_DISCLOSURES } = require('../functions/passport');
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
function sameNetwork (a, b) {
  try {
    return normalizeAccountNetwork(a) === normalizeAccountNetwork(b);
  } catch (_) {
    return false;
  }
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
 * @param {number} [max] Longest kept (purposes and refusals keep 140).
 * @returns {string}
 */
function cleanLabel (label, max = DELEGATION_MAX_LABEL) {
  return String(label == null ? '' : label)
    .replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .trim()
    .slice(0, max);
}

/**
 * Why a `FederationWithdrawalRequest` body cannot be shown to the co-signer,
 * or null. Its address and amounts go into the prompt as written, so the
 * address must be a plain base58 / bech32 string and the amounts whole sats.
 * @private
 * @param {Object} body
 * @returns {string|null}
 */
function withdrawalBodyError (body) {
  if (typeof body.requestId !== 'string' || !body.requestId.trim()) return 'malformed withdrawal request: requestId';
  if (typeof body.destinationAddress !== 'string' || !/^[A-Za-z0-9]{14,90}$/.test(body.destinationAddress)) {
    return 'malformed withdrawal request: destinationAddress';
  }
  for (const field of ['amountSats', 'feeSats']) {
    if (!Number.isSafeInteger(body[field]) || body[field] < 0) return `malformed withdrawal request: ${field}`;
  }
  return null;
}

/** Two ids that are both present and equal, ignoring case. */
function sameId (a, b) {
  const left = String(a || '').trim().toLowerCase();
  return left !== '' && left === String(b || '').trim().toLowerCase();
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
    if (body.type === 'FederationWithdrawalRequest') {
      const error = withdrawalBodyError(body);
      if (error) return { ok: false, error };
    }
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
    purpose: params.purpose != null ? cleanLabel(String(params.purpose), DELEGATION_MAX_PURPOSE) : '',
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
    request: { requester, target, grant, nonce, origin, account, disclose, purpose: cleanLabel(purpose, DELEGATION_MAX_PURPOSE), issuedAt, expiresAt },
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
    if (read.scope === 'federation' && read.inner.type === 'FederationWithdrawalRequest') {
      // A withdrawal spends a federation the host already holds: its network
      // is the host's record, never the body's own claim.
      const held = typeof options.networkOf === 'function' ? options.networkOf(read) || null : null;
      if (network && held && !sameNetwork(network, held)) return { ok: false, error: `the withdrawal names ${network} and the federation is on ${held}` };
      network = held;
    } else if (!network && typeof options.networkOf === 'function') network = options.networkOf(read) || null;
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
  const refusal = params.refusal != null ? cleanLabel(String(params.refusal), DELEGATION_MAX_PURPOSE) : '';
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
      const error = withdrawalBodyError(body);
      if (error) throw new TypeError(`notificationFor: ${error}`);
      title = `Co-sign a withdrawal of ${Number(body.amountSats)} sats`;
      summary = `To ${String(body.destinationAddress)} (fee ${Number(body.feeSats)} sats).`;
    } else {
      title = body.name ? `Join the shared wallet "${cleanLabel(body.name)}"` : 'Join a shared wallet';
      const validators = body.descriptor && Array.isArray(body.descriptor.validators) ? body.descriptor.validators.length : 0;
      const threshold = body.descriptor && body.descriptor.threshold;
      summary = Number.isSafeInteger(threshold) && threshold > 0 ? `${threshold} of ${validators} signers.` : summary;
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
 * Why an answer frame does not answer a request, or null when it does: a
 * Passport assertion over the request's challenge and origin, the request's
 * own message signed, or a federation reply for the same federation.
 * @param {Object} read An `ok` {@link readRequest} result.
 * @param {string|Buffer|Message} answer The answer frame.
 * @returns {string|null}
 */
function answerError (read, answer) {
  if (!read || !read.ok) return 'unreadable request';
  // Only a frame its author signed answers a request; an unsigned copy does not.
  let decoded = null;
  try {
    decoded = decodeFrame(Buffer.from(frameBuffer(answer)), null);
  } catch (_) {}
  if (!decoded || !decoded.ok) return `unreadable answer${decoded && decoded.error ? `: ${decoded.error}` : ''}`;
  const message = decoded.message;
  const inner = read.inner;
  if (read.scope === 'passport') {
    if (message.type !== 'PASSPORT_ASSERTION') return 'a passport request is answered with an assertion';
    const fields = message.toFields() || {};
    if (Buffer.from(fields.challengeHash || []).toString('hex') !== inner.hash) return 'the assertion is for another challenge';
    if (normalizeOrigin(fields.origin) !== read.request.origin) return 'the assertion is for another origin';
    return null;
  }
  if (read.scope === 'message') {
    const asked = Message.fromBuffer(Buffer.from(inner.buffer));
    if (message.type !== asked.type || !message.bodyBuffer.equals(asked.bodyBuffer)) return 'the answer signs another message';
    return null;
  }
  if (read.scope === 'federation') {
    const reply = message.type === 'CONTRACT_MESSAGE' ? contractBody(message) : null;
    const expected = inner.body.type === 'FederationInvite' ? 'FederationInviteResponse' : 'FederationWithdrawalSignature';
    if (!reply || reply.type !== expected) return `a ${inner.body.type} is answered with a ${expected}`;
    if (!sameId(reply.federationId, inner.body.federationId)) return 'the answer is for another federation';
    if (inner.body.type === 'FederationWithdrawalRequest' && !sameId(reply.requestId, inner.body.requestId)) {
      return 'the answer is for another withdrawal';
    }
    return null;
  }
  return `unknown scope ${read.scope}`;
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

/** @private Frame builders and readers, also published as statics on `Delegation`. */
const delegation = {
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
  answerError,
  delegationType
};


/** @private */
const STATE_VERSION = 1;
/** @private */
const DEFAULT_MAX_FRAMES = 2000;
/** @private */
const DEFAULT_MAX_PENDING = 200;

/**
 * Key-value store kept in memory; the default when none is given.
 * @private
 */
function memoryStore () {
  const map = new Map();
  return {
    async get (key) { return map.has(key) ? map.get(key) : null; },
    async set (key, value) { map.set(key, value); }
  };
}

/** @private */
function emptyState () {
  return {
    v: STATE_VERSION,
    links: {},
    given: {},
    received: {},
    revoked: {},
    inbox: {},
    outbox: {},
    frames: []
  };
}

/**
 * @classdesc A participant's delegation state on its own key and store.
 * @class Delegation
 * @extends EventEmitter
 */
class Delegation extends EventEmitter {
  /**
   * @param {Object} settings
   * @param {Key} settings.key This participant's identity key (private).
   * @param {Object} [settings.store] `{ get(key), set(key, value) }` (async); in memory when omitted.
   * @param {string} [settings.collection='delegations'] Store key for this participant's record.
   * @param {Function} [settings.now] Clock (ms).
   * @param {number} [settings.maxFrames=2000] Frames kept in the message store.
   * @param {number} [settings.maxPending=200] Pending requests kept.
   * @param {Function} [settings.networkOf] `(read) => network` for requests whose frame names none (federation withdrawals).
   */
  constructor (settings = {}) {
    super();
    if (!settings.key || !settings.key.private) throw new TypeError('Delegation: a private key is required');
    this.key = settings.key;
    this.store = settings.store || memoryStore();
    this.collection = settings.collection || 'delegations';
    this.settings = Object.assign({ maxFrames: DEFAULT_MAX_FRAMES, maxPending: DEFAULT_MAX_PENDING }, settings);
    this._now = typeof settings.now === 'function' ? settings.now : () => Date.now();
    this._state = null;
    this._queue = Promise.resolve();
  }

  /** Compressed pubkey of this participant. */
  get pubkey () {
    return String(this.key.pubkey).toLowerCase();
  }

  /** @private */
  _x () {
    return this.pubkey.slice(2);
  }

  /**
   * Load the stored record (called by every method; safe to call again).
   * @returns {Promise<Delegation>}
   */
  async load () {
    if (this._state) return this;
    let raw = null;
    try {
      raw = await this.store.get(this.collection);
    } catch (_) {
      raw = null;
    }
    let state = raw;
    if (typeof raw === 'string') {
      try {
        state = JSON.parse(raw);
      } catch (_) {
        state = null;
      }
    }
    this._state = state && state.v === STATE_VERSION ? Object.assign(emptyState(), state) : emptyState();
    return this;
  }

  /** @private Run `fn` alone, then persist. */
  _serial (fn) {
    const run = this._queue.then(async () => {
      await this.load();
      const out = await fn(this._state);
      await this.store.set(this.collection, JSON.stringify(this._state));
      return out;
    });
    this._queue = run.catch(() => {});
    return run;
  }

  /** @private */
  _record (state, buffer, direction) {
    const hash = delegation.frameHash(buffer);
    if (state.frames.some((f) => f.hash === hash)) return hash;
    state.frames.push({ hash, hex: Buffer.from(buffer).toString('hex'), type: delegation.delegationType(buffer), direction, at: this._now() });
    const max = this.settings.maxFrames;
    if (state.frames.length > max) state.frames.splice(0, state.frames.length - max);
    return hash;
  }

  /** @private */
  _opts () {
    return { now: this._now() };
  }

  /** @private */
  _grants (state, which) {
    return Object.values(state[which]).map((g) => delegation.readGrant(Buffer.from(g.hex, 'hex'), { now: this._now() }));
  }

  /** @private */
  _revokedSet (state) {
    return new Set(Object.keys(state.revoked));
  }

  // Pairing

  /**
   * Start pairing through a rendezvous.
   * @param {{ origin: string, label: (string|undefined), network: (string|undefined) }} params
   * @returns {Promise<{ uri: string, linkId: string, expiresAt: number }>}
   */
  async offer (params = {}) {
    return this._serial((state) => {
      const made = delegation.createLinkOffer(Object.assign({}, params, { now: this._now() }), this.key);
      state.links[made.linkId] = {
        role: 'initiator',
        status: 'offered',
        nonce: made.nonce,
        offer: made.message.toBuffer().toString('hex'),
        origin: params.origin,
        label: params.label || '',
        createdAt: this._now()
      };
      this._record(state, made.message.toBuffer(), 'out');
      return { uri: made.uri, linkId: made.linkId, expiresAt: made.expiresAt };
    });
  }

  /**
   * Answer another participant's offer.
   * @param {string|Buffer} offer
   * @param {{ label: (string|undefined) }} [params]
   * @returns {Promise<{ uri: string, linkId: string, peer: string, peerPubkey: string }>}
   */
  async answer (offer, params = {}) {
    return this._serial((state) => {
      const read = delegation.readLinkOffer(offer, this._opts());
      if (!read.ok) throw new Error(read.error);
      const made = delegation.createLinkAnswer({ offer, label: params.label, now: this._now() }, this.key);
      state.links[made.linkId] = {
        role: 'responder',
        status: 'answered',
        offer: read.buffer.toString('hex'),
        answer: made.message.toBuffer().toString('hex'),
        peer: read.author,
        peerPubkey: read.pubkey,
        origin: read.offer.origin,
        peerLabel: read.offer.label,
        label: params.label || '',
        createdAt: this._now()
      };
      this._record(state, read.buffer, 'in');
      this._record(state, made.message.toBuffer(), 'out');
      return { uri: made.uri, linkId: made.linkId, peer: read.author, peerPubkey: read.pubkey };
    });
  }

  /**
   * Code to show for a pairing once both nonces are known, or null.
   * @param {string} linkId
   * @returns {Promise<string|null>}
   */
  async sasFor (linkId) {
    await this.load();
    const link = this._state.links[linkId];
    return link && link.sas ? link.sas : null;
  }

  /**
   * The user confirmed both screens show the same code.
   * @param {string} linkId
   * @returns {Promise<{ linkId: string, peer: string, peerPubkey: (string|null), revealHash: string }>}
   */
  async confirmLink (linkId) {
    return this._serial((state) => {
      const link = state.links[linkId];
      if (!link || !link.sas) throw new Error('nothing to confirm for this pairing');
      link.status = 'confirmed';
      link.confirmedAt = this._now();
      delete link.nonce;
      return { linkId, peer: link.peer, peerPubkey: link.peerPubkey || null, revealHash: link.revealHash };
    });
  }

  /**
   * Pairings, newest first (no secrets).
   * @returns {Promise<object[]>}
   */
  async links () {
    await this.load();
    return Object.entries(this._state.links)
      .map(([linkId, l]) => ({ linkId, role: l.role, status: l.status, peer: l.peer || null, peerPubkey: l.peerPubkey || null, peerLabel: l.peerLabel || '', origin: l.origin, sas: l.sas || null, revealHash: l.revealHash || null, createdAt: l.createdAt }))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  // Grants

  /**
   * Let `grantee` ask this participant to sign.
   * @param {Object} params See {@link Delegation.createGrant}.
   * @returns {Promise<{ uri: string, hash: string }>}
   */
  async grant (params = {}) {
    return this._serial((state) => {
      const made = delegation.createGrant(Object.assign({}, params, { now: this._now() }), this.key);
      const read = delegation.readGrant(made.message, this._opts());
      if (!read.ok) throw new Error(read.error);
      state.given[read.hash] = { hex: read.buffer.toString('hex'), at: this._now() };
      this._record(state, read.buffer, 'out');
      this.emit('grant', { hash: read.hash, read, direction: 'given' });
      return { uri: made.uri, hash: read.hash };
    });
  }

  /**
   * Withdraw a grant this participant made.
   * @param {string} grantHash
   * @returns {Promise<{ uri: string, hash: string }>}
   */
  async revoke (grantHash) {
    return this._serial((state) => {
      const hash = String(grantHash || '').toLowerCase();
      if (!state.given[hash]) throw new Error('no such grant from this participant');
      const made = delegation.createRevoke({ grant: hash, now: this._now() }, this.key);
      state.revoked[hash] = { at: this._now(), frame: made.message.toBuffer().toString('hex') };
      for (const item of Object.values(state.inbox)) {
        if (item && item.status === 'pending' && item.grant === hash) item.status = 'revoked';
      }
      this._record(state, made.message.toBuffer(), 'out');
      this.emit('revoke', { grant: hash, hash: made.hash });
      return { uri: made.uri, hash: made.hash };
    });
  }

  /**
   * Grants this participant made (`given`) or holds from others (`received`), unrevoked unless asked.
   * @param {'given'|'received'} which
   * @param {{ revoked: (boolean|undefined) }} [options]
   * @returns {Promise<object[]>} `{ hash, uri, grant, revoked }`
   */
  async grants (which = 'given', options = {}) {
    await this.load();
    if (which !== 'given' && which !== 'received') throw new TypeError('grants: given or received');
    const revoked = this._revokedSet(this._state);
    return this._grants(this._state, which)
      .filter((g) => g.ok)
      .map((g) => ({ hash: g.hash, uri: encodeFabricUri(g.buffer), grant: g.grant, revoked: revoked.has(g.hash) }))
      .filter((g) => options.revoked || !g.revoked);
  }

  /**
   * Participants linked as the same person (mutual `identity` grants).
   * @returns {Promise<string[]>}
   */
  async identityPeers () {
    await this.load();
    const all = this._grants(this._state, 'given').concat(this._grants(this._state, 'received'));
    return delegation.identityPeers(this.pubkey, all, this._revokedSet(this._state));
  }

  /**
   * The unrevoked grant `grantor` made to this participant covering `scope`, if any.
   * @param {string} grantor Pubkey.
   * @param {string} scope
   * @returns {Promise<object|null>}
   */
  async grantFrom (grantor, scope) {
    const x = delegation.xOnly(grantor);
    const held = await this.grants('received');
    const matches = held.filter((g) => g.grant.grantor.slice(2) === x && g.grant.scopes.includes(scope));
    matches.sort((a, b) => b.grant.issuedAt - a.grant.issuedAt);
    return matches[0] || null;
  }

  // Requests

  /**
   * Ask `target` to sign a frame, under its newest grant covering the frame's scope.
   * @param {Object} params See `createRequest`; `grant` is found when omitted.
   * @returns {Promise<{ uri: string, hash: string, scope: string, expiresAt: number }>}
   */
  async request (params = {}) {
    let grant = params.grant;
    if (!grant) {
      const inner = delegation.readInnerFrame(Buffer.isBuffer(params.request) ? params.request : bufferOf(params.request), this._opts());
      if (!inner.ok) throw new Error(inner.error);
      const held = await this.grantFrom(params.target, inner.scope);
      if (!held) throw new Error(`no ${inner.scope} grant from that participant`);
      grant = held.hash;
    }
    return this._serial((state) => {
      const made = delegation.createRequest(Object.assign({}, params, { grant, now: this._now() }), this.key);
      state.outbox[made.hash] = { hex: made.message.toBuffer().toString('hex'), status: 'sent', at: this._now(), target: params.target, grant };
      this._record(state, made.message.toBuffer(), 'out');
      return { uri: made.uri, hash: made.hash, scope: made.scope, expiresAt: made.expiresAt };
    });
  }

  /**
   * Requests waiting for this participant's answer, oldest first.
   * @returns {Promise<Array<{ hash: string, read: object, notification: object, receivedAt: number }>>}
   */
  async pending () {
    await this.load();
    const out = [];
    for (const [hash, item] of Object.entries(this._state.inbox)) {
      if (item.status !== 'pending') continue;
      const read = delegation.readRequest(Buffer.from(item.hex, 'hex'), this._opts());
      if (!read.ok) continue;
      const auth = delegation.authorize(read, this._grants(this._state, 'given'), { revoked: this._revokedSet(this._state), networkOf: this.settings.networkOf });
      if (!auth.ok) continue;
      out.push({ hash, read, notification: delegation.notificationFor(read, { label: this._labelFor(this._state, read.request.requester) }), receivedAt: item.at });
    }
    return out.sort((a, b) => a.receivedAt - b.receivedAt);
  }

  /**
   * A request this participant received (any status).
   * @param {string} hash
   * @returns {Promise<{ hash: string, status: string, read: object, result: (string|null) }|null>}
   */
  async inboxItem (hash) {
    await this.load();
    const item = this._state.inbox[String(hash || '').toLowerCase()];
    if (!item) return null;
    return { hash, status: item.status, read: delegation.readRequest(Buffer.from(item.hex, 'hex'), { now: item.at }), result: item.result || null, rule: item.rule || null };
  }

  /**
   * A request this participant sent, with its result once it arrived.
   * @param {string} hash
   * @returns {Promise<{ hash: string, status: string, result: (object|null) }|null>}
   */
  async outboxItem (hash) {
    await this.load();
    const item = this._state.outbox[String(hash || '').toLowerCase()];
    if (!item) return null;
    const result = item.result ? delegation.readResult(Buffer.from(item.result, 'hex'), { now: item.resultAt }) : null;
    return { hash, status: item.status, result: result && result.ok ? result.result : null };
  }

  /**
   * Answer a pending request with a signed frame.
   * @param {string} requestHash
   * @param {string|Buffer|Message} answer
   * @param {{ rule: (string|undefined) }} [options]
   * @returns {Promise<{ uri: string, hash: string }>}
   */
  async sign (requestHash, answer, options = {}) {
    return this._answer(requestHash, { answer, rule: options.rule }, 'signed');
  }

  /**
   * Refuse a pending request.
   * @param {string} requestHash
   * @param {string} [reason]
   * @param {{ rule: (string|undefined) }} [options]
   * @returns {Promise<{ uri: string, hash: string }>}
   */
  async decline (requestHash, reason = 'declined', options = {}) {
    return this._answer(requestHash, { refusal: reason || 'declined', rule: options.rule }, 'declined');
  }

  /** @private */
  _answer (requestHash, fields, status) {
    return this._serial((state) => {
      const hash = String(requestHash || '').toLowerCase();
      const item = state.inbox[hash];
      if (!item) throw new Error('unknown request');
      if (item.status !== 'pending') throw new Error(`request is already ${item.status}`);
      const read = delegation.readRequest(Buffer.from(item.hex, 'hex'), this._opts());
      if (!read.ok) throw new Error(read.error);
      const auth = delegation.authorize(read, this._grants(state, 'given'), { revoked: this._revokedSet(state), networkOf: this.settings.networkOf });
      if (!auth.ok) throw new Error(auth.error);
      const made = delegation.createResult(Object.assign({ request: hash, now: this._now() }, fields), this.key);
      if (fields.answer) {
        const answered = delegation.readResult(made.message, this._opts());
        if (!answered.ok) throw new Error(answered.error);
        if (!this._signers(state, 'given', item.grant).has(answered.result.answer.author)) {
          throw new Error('the answer must be signed by this participant\'s identity or granted cosigner key');
        }
        // The requester runs the same check; an answer it would refuse is never recorded.
        const mismatch = answerError(read, answered.result.answer.buffer);
        if (mismatch) throw new Error(mismatch);
      }
      item.status = status;
      item.result = made.message.toBuffer().toString('hex');
      item.rule = fields.rule || null;
      item.answeredAt = this._now();
      this._record(state, made.message.toBuffer(), 'out');
      return { uri: made.uri, hash: made.hash };
    });
  }

  // Incoming

  /**
   * Take in any delegation frame addressed to this participant.
   * @param {string|Buffer|Message} input
   * @param {{ label: (string|undefined) }} [context]
   * @returns {Promise<object>} `{ ok, type, ... }`; `ok: false` with `error` when refused.
   */
  async receive (input, context = {}) {
    const type = delegation.delegationType(input);
    if (!type) return { ok: false, error: 'not a delegation frame' };
    switch (type) {
      case 'DELEGATION_LINK_ANSWER': return this._receiveAnswer(input);
      case 'DELEGATION_LINK_REVEAL': return this._receiveReveal(input);
      case 'DELEGATION_GRANT': return this._receiveGrant(input);
      case 'DELEGATION_REVOKE': return this._receiveRevoke(input);
      case 'DELEGATION_REQUEST': return this._receiveRequest(input, context);
      case 'DELEGATION_RESULT': return this._receiveResult(input);
      default: return { ok: false, error: `${type} is not received here` };
    }
  }

  /** @private */
  _receiveAnswer (input) {
    return this._serial((state) => {
      const read = delegation.readLinkAnswer(input, this._opts());
      if (!read.ok) return read;
      const link = state.links[read.answer.offer];
      if (!link || link.role !== 'initiator') return { ok: false, error: 'not an answer to this participant\'s offer' };
      if (link.status !== 'offered') return { ok: false, error: `pairing is already ${link.status}` };
      const made = delegation.createLinkReveal({ offer: Buffer.from(link.offer, 'hex'), answer: read.buffer, nonce: link.nonce, now: this._now() }, this.key);
      link.status = 'revealed';
      link.peer = read.author;
      link.peerPubkey = read.pubkey;
      link.peerLabel = read.answer.label;
      link.answer = read.buffer.toString('hex');
      link.reveal = made.message.toBuffer().toString('hex');
      link.revealHash = made.hash;
      link.sas = made.sas;
      this._record(state, read.buffer, 'in');
      this._record(state, made.message.toBuffer(), 'out');
      this.emit('link', { linkId: made.linkId, sas: made.sas, peer: read.author, role: 'initiator' });
      return { ok: true, type: 'DELEGATION_LINK_ANSWER', linkId: made.linkId, reveal: made.uri, sas: made.sas, peer: read.author, peerPubkey: read.pubkey, peerLabel: read.answer.label };
    });
  }

  /** @private */
  _receiveReveal (input) {
    return this._serial((state) => {
      const read = delegation.readLinkReveal(input, this._opts());
      if (!read.ok) return read;
      const entry = Object.entries(state.links).find(([, l]) => l.role === 'responder' && l.answer && delegation.frameHash(Buffer.from(l.answer, 'hex')) === read.reveal.answer);
      if (!entry) return { ok: false, error: 'not a reveal for this participant\'s answer' };
      const [linkId, link] = entry;
      if (link.status !== 'answered') return { ok: false, error: `pairing is already ${link.status}` };
      const checked = delegation.verifyLink({ offer: Buffer.from(link.offer, 'hex'), answer: Buffer.from(link.answer, 'hex'), reveal: read.buffer }, this._opts());
      if (!checked.ok) return checked;
      link.status = 'revealed';
      link.reveal = read.buffer.toString('hex');
      link.revealHash = checked.revealHash;
      link.sas = checked.sas;
      this._record(state, read.buffer, 'in');
      this.emit('link', { linkId, sas: checked.sas, peer: checked.initiator, role: 'responder' });
      return { ok: true, type: 'DELEGATION_LINK_REVEAL', linkId, sas: checked.sas, peer: checked.initiator, peerPubkey: checked.pubkeys.initiator, peerLabel: checked.labels.initiator };
    });
  }

  /** @private */
  _receiveGrant (input) {
    return this._serial((state) => {
      const read = delegation.readGrant(input, this._opts());
      if (!read.ok) return read;
      if (read.grant.grantee.slice(2) !== this._x()) return { ok: false, error: 'the grant is for another participant' };
      if (state.revoked[read.hash]) return { ok: false, error: 'the grant was revoked' };
      const fresh = !state.received[read.hash];
      state.received[read.hash] = { hex: read.buffer.toString('hex'), at: this._now() };
      this._record(state, read.buffer, 'in');
      if (fresh) this.emit('grant', { hash: read.hash, read, direction: 'received' });
      return { ok: true, type: 'DELEGATION_GRANT', hash: read.hash, grant: read.grant, fresh };
    });
  }

  /** @private */
  _receiveRevoke (input) {
    return this._serial((state) => {
      const read = delegation.readRevoke(input, this._opts());
      if (!read.ok) return read;
      const held = state.received[read.revoke.grant];
      if (!held) return { ok: false, error: 'unknown grant' };
      const grant = delegation.readGrant(Buffer.from(held.hex, 'hex'), { now: held.at });
      if (!grant.ok || grant.author !== read.author) return { ok: false, error: 'only the grantor revokes a grant' };
      if (!state.revoked[read.revoke.grant]) {
        state.revoked[read.revoke.grant] = { at: this._now(), frame: read.buffer.toString('hex') };
        this._record(state, read.buffer, 'in');
        this.emit('revoke', { grant: read.revoke.grant, hash: read.hash });
      }
      return { ok: true, type: 'DELEGATION_REVOKE', grant: read.revoke.grant };
    });
  }

  /** @private */
  _receiveRequest (input, context) {
    return this._serial((state) => {
      const read = delegation.readRequest(input, this._opts());
      if (!read.ok) return read;
      if (read.request.target.slice(2) !== this._x()) return { ok: false, error: 'the request is for another participant' };
      if (state.inbox[read.hash]) return { ok: true, type: 'DELEGATION_REQUEST', hash: read.hash, duplicate: true, status: state.inbox[read.hash].status };
      const auth = delegation.authorize(read, this._grants(state, 'given'), { revoked: this._revokedSet(state), networkOf: this.settings.networkOf });
      if (!auth.ok) return auth;
      const pendingCount = Object.values(state.inbox).filter((i) => i.status === 'pending').length;
      if (pendingCount >= this.settings.maxPending) return { ok: false, error: 'too many pending requests' };
      state.inbox[read.hash] = { hex: read.buffer.toString('hex'), status: 'pending', at: this._now(), grant: auth.grant.hash };
      this._record(state, read.buffer, 'in');
      const notification = delegation.notificationFor(read, { label: (context && context.label) || this._labelFor(state, read.request.requester) });
      this.emit('request', { hash: read.hash, read, grant: auth.grant, notification });
      return { ok: true, type: 'DELEGATION_REQUEST', hash: read.hash, scope: read.scope, notification };
    });
  }

  /** @private */
  _receiveResult (input) {
    return this._serial((state) => {
      const read = delegation.readResult(input, this._opts());
      if (!read.ok) return read;
      const out = state.outbox[read.result.request];
      if (!out) return { ok: false, error: 'not a result for this participant\'s request' };
      const target = out.target ? delegation.xOnly(out.target) : null;
      if (target && read.author !== target) return { ok: false, error: 'the result is not from the participant asked' };
      if (read.result.answer && !this._signers(state, 'received', out.grant, read.author).has(read.result.answer.author)) {
        return { ok: false, error: 'the answer is not signed by the participant asked' };
      }
      if (read.result.answer) {
        const asked = delegation.readRequest(Buffer.from(out.hex, 'hex'), Object.assign({}, this._opts(), { now: out.at }));
        const mismatch = asked.ok ? answerError(asked, read.result.answer.buffer) : `the request no longer reads: ${asked.error}`;
        if (mismatch) return { ok: false, error: mismatch };
      }
      if (out.status !== 'sent') return { ok: true, type: 'DELEGATION_RESULT', request: read.result.request, duplicate: true };
      out.status = read.result.answer ? 'signed' : 'declined';
      out.result = read.buffer.toString('hex');
      out.resultAt = this._now();
      this._record(state, read.buffer, 'in');
      this.emit('result', { hash: read.hash, request: read.result.request, read });
      return { ok: true, type: 'DELEGATION_RESULT', request: read.result.request, result: read.result };
    });
  }

  /**
   * x-only keys that may sign an answer under a grant: the grantor's identity
   * and the cosigner key the grant disclosed.
   * @private
   */
  _signers (state, which, grantHash, fallback) {
    const keys = new Set();
    const held = grantHash && state[which][grantHash];
    const read = held ? delegation.readGrant(Buffer.from(held.hex, 'hex'), { now: held.at }) : null;
    if (read && read.ok) {
      keys.add(read.grant.grantor.slice(2));
      if (read.grant.cosigner) keys.add(read.grant.cosigner.slice(2));
    } else if (which === 'given') {
      keys.add(this._x());
    } else if (fallback) {
      keys.add(delegation.xOnly(fallback));
    }
    return keys;
  }

  /** @private */
  _labelFor (state, pubkey) {
    const x = delegation.xOnly(pubkey);
    const link = Object.values(state.links).find((l) => l.peer === x && l.peerLabel);
    if (link) return link.peerLabel;
    const grant = this._grants(state, 'received').find((g) => g.ok && g.grant.grantor.slice(2) === x && g.grant.label);
    return grant ? grant.grant.label : '';
  }

  /**
   * Every frame this participant sent or received, oldest first, as
   * `FabricMessageCollection`-style records (`hash`, `hex`, `type`, `direction`, `at`).
   * @returns {Promise<object[]>}
   */
  async frames () {
    await this.load();
    return this._state.frames.slice();
  }
}

/** @private */
function bufferOf (input) {
  if (input && typeof input.toBuffer === 'function') return input.toBuffer();
  if (Buffer.isBuffer(input)) return input;
  const decoded = decodeFabricUri(String(input || ''), { allowUnsigned: true, allowUnknownTypes: true });
  if (!decoded.ok) throw new Error(decoded.error);
  return decoded.buffer;
}

Delegation.memoryStore = memoryStore;

Object.assign(Delegation, delegation);

module.exports = Delegation;
