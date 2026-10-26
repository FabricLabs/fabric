'use strict';

/**
 * @fileoverview Canonical IdentityCrossSign / IdentityCrossSignRevoke strings.
 * Browser-safe (no Node built-ins). Site-login / device-link HTTP stays in
 * `@fabric/http`; this module is the gossiped BIP340 message after countersign.
 *
 * Each string names the device-link session and the Hub origin it was made
 * on, and is signed over `taggedHash(CROSS_SIGN_TAG | REVOKE_TAG, utf8)`, so a
 * cross-sign is valid for one session on one Hub and for nothing else.
 */

const CROSS_SIGN_PREFIX = 'fabric:identity-cross-sign:2';
const REVOKE_PREFIX = 'fabric:identity-cross-sign-revoke:2';
const SIGNING_TAGS = require('./signingTags');

const CROSS_SIGN_TAG = SIGNING_TAGS.IDENTITY_CROSS_SIGN;
const REVOKE_TAG = SIGNING_TAGS.IDENTITY_CROSS_SIGN_REVOKE;
const SIGN_TYPE = 'IdentityCrossSign';
const REVOKE_TYPE = 'IdentityCrossSignRevoke';

const SESSION_ID_PATTERN = /^[a-f0-9]{48}$/;
const NONCE_PATTERN = /^[a-f0-9]{64}$/;
const PUBKEY_PATTERN = /^0[23][a-f0-9]{64}$/;
const TIME_PATTERN = /^[0-9]{1,16}$/;

function _normHex (value) {
  return String(value || '').trim().toLowerCase().replace(/^0x/, '');
}

function _normSessionId (value) {
  const s = _normHex(value);
  return SESSION_ID_PATTERN.test(s) ? s : null;
}

function _normNonce (value) {
  const s = _normHex(value);
  return NONCE_PATTERN.test(s) ? s : null;
}

/** Compressed 33-byte hex only; no field can hold a `:`. */
function _normPubkey (value) {
  const s = _normHex(value);
  return PUBKEY_PATTERN.test(s) ? s : null;
}

/**
 * http(s) origin as the URL parser prints it (`scheme://host[:port]`).
 * @param {string} value
 * @returns {string|null}
 */
function normalizeCrossSignOrigin (value) {
  if (typeof value !== 'string' || !value.trim()) return null;
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

function _normTime (value) {
  const n = typeof value === 'number' ? value : Number(String(value || '').trim());
  if (!Number.isSafeInteger(n) || n <= 0) return null;
  const s = String(n);
  return TIME_PATTERN.test(s) ? s : null;
}

function _fields (fields = {}) {
  return {
    sessionId: _normSessionId(fields.sessionId),
    nonce: _normNonce(fields.nonce),
    localPubkey: _normPubkey(fields.localPubkey),
    peerPubkey: _normPubkey(fields.peerPubkey),
    origin: normalizeCrossSignOrigin(fields.origin)
  };
}

/**
 * Canonical message: A attests that B is the same actor, for one device-link
 * session on one Hub.
 * @param {Object} fields
 * @param {string} fields.sessionId 48-hex device-link session id
 * @param {string} fields.nonce 64-hex device-link nonce
 * @param {string} fields.localPubkey signing device pubkey (compressed)
 * @param {string} fields.peerPubkey linked device pubkey (compressed)
 * @param {string} fields.origin Hub origin the link was made on
 * @returns {string|null}
 */
function buildCrossSignMessage (fields = {}) {
  const f = _fields(fields);
  if (!f.sessionId || !f.nonce || !f.localPubkey || !f.peerPubkey || !f.origin) return null;
  if (f.localPubkey === f.peerPubkey) return null;
  return `${CROSS_SIGN_PREFIX}:${f.sessionId}:${f.nonce}:${f.localPubkey}:${f.peerPubkey}:${f.origin}`;
}

/**
 * Canonical message: either side splits the A↔B edge made in that session.
 * @param {Object} fields same as {@link buildCrossSignMessage} plus
 * @param {number} fields.revokedAt milliseconds since the epoch
 * @returns {string|null}
 */
function buildRevokeMessage (fields = {}) {
  const f = _fields(fields);
  const revokedAt = _normTime(fields.revokedAt);
  if (!f.sessionId || !f.nonce || !f.localPubkey || !f.peerPubkey || !f.origin || !revokedAt) return null;
  if (f.localPubkey === f.peerPubkey) return null;
  return `${REVOKE_PREFIX}:${f.sessionId}:${f.nonce}:${f.localPubkey}:${f.peerPubkey}:${revokedAt}:${f.origin}`;
}

function _parse (msg, prefix, withTime) {
  const s = String(msg || '');
  const head = prefix + ':';
  if (!s.startsWith(head)) return null;
  const parts = s.slice(head.length).split(':');
  const fixed = withTime ? 5 : 4;
  if (parts.length < fixed + 1) return null;
  const [sessionId, nonce, localPubkey, peerPubkey] = parts;
  const revokedAt = withTime ? parts[4] : null;
  const origin = parts.slice(fixed).join(':');
  const out = {
    sessionId: SESSION_ID_PATTERN.test(sessionId) ? sessionId : null,
    nonce: NONCE_PATTERN.test(nonce) ? nonce : null,
    localPubkey: PUBKEY_PATTERN.test(localPubkey) ? localPubkey : null,
    peerPubkey: PUBKEY_PATTERN.test(peerPubkey) ? peerPubkey : null,
    origin: normalizeCrossSignOrigin(origin) === origin ? origin : null
  };
  if (!out.sessionId || !out.nonce || !out.localPubkey || !out.peerPubkey || !out.origin) return null;
  if (withTime) {
    if (_normTime(revokedAt) !== revokedAt) return null;
    out.revokedAt = Number(revokedAt);
  }
  return out;
}

function parseCrossSignMessage (msg) {
  return _parse(msg, CROSS_SIGN_PREFIX, false);
}

function parseRevokeMessage (msg) {
  return _parse(msg, REVOKE_PREFIX, true);
}

/**
 * @param {string} type
 * @param {object} [fields]
 * @returns {object}
 */
function _typedObject (type, fields = {}) {
  const f = _fields(fields);
  const out = {
    type,
    '@type': type,
    sessionId: f.sessionId || '',
    nonce: f.nonce || '',
    localPubkey: f.localPubkey || '',
    peerPubkey: f.peerPubkey || '',
    origin: f.origin || '',
    createdAt: fields.createdAt || new Date().toISOString(),
    signature: fields.signature || null,
    pubkeyHex: fields.pubkeyHex || null,
    identity: fields.identity || null
  };
  if (type === REVOKE_TYPE) out.revokedAt = Number(_normTime(fields.revokedAt)) || null;
  return out;
}

/**
 * @param {object} [fields]
 * @returns {object}
 */
function buildCrossSignObject (fields = {}) {
  return _typedObject(SIGN_TYPE, fields);
}

/**
 * @param {object} [fields]
 * @returns {object}
 */
function buildRevokeObject (fields = {}) {
  return _typedObject(REVOKE_TYPE, fields);
}

function isCrossSignType (type) {
  const t = String(type || '');
  return t === SIGN_TYPE || t === REVOKE_TYPE;
}

/**
 * Hub / Peer CONTRACT_MESSAGE wraps the typed body as `{ type, object }`.
 * Returns the inner IdentityCrossSign fields, copying the wrapper type when
 * the inner payload omitted it.
 * @param {object} object
 * @returns {object}
 */
function coerceCrossSignObject (object) {
  if (!object || typeof object !== 'object') return object;
  const hasFields = !!(object.localPubkey || object.peerPubkey || object.signature);
  if (isCrossSignType(object.type || object['@type']) && hasFields) return object;
  const inner = object.object;
  if (!inner || typeof inner !== 'object') return object;
  const type = inner.type || inner['@type'] || object.type || object['@type'];
  if (!isCrossSignType(type) && !(inner.localPubkey || inner.signature)) return object;
  return Object.assign({}, inner, {
    type: type || inner.type,
    '@type': inner['@type'] || type
  });
}

module.exports = {
  CROSS_SIGN_PREFIX,
  REVOKE_PREFIX,
  CROSS_SIGN_TAG,
  REVOKE_TAG,
  SIGN_TYPE,
  REVOKE_TYPE,
  normalizeCrossSignOrigin,
  buildCrossSignMessage,
  buildRevokeMessage,
  parseCrossSignMessage,
  parseRevokeMessage,
  buildCrossSignObject,
  buildRevokeObject,
  coerceCrossSignObject,
  isCrossSignType
};
