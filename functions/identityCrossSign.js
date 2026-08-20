'use strict';

/**
 * @fileoverview Canonical IdentityCrossSign / IdentityCrossSignRevoke strings.
 * Browser-safe (no Node built-ins). Site-login / device-link HTTP stays in
 * `@fabric/http`; this module is the gossiped BIP340 message after countersign.
 */

const CROSS_SIGN_PREFIX = 'fabric:identity-cross-sign:1';
const REVOKE_PREFIX = 'fabric:identity-cross-sign-revoke:1';
const SIGN_TYPE = 'IdentityCrossSign';
const REVOKE_TYPE = 'IdentityCrossSignRevoke';

function _normHex (value) {
  return String(value || '').trim().toLowerCase().replace(/^0x/, '');
}

function _normNonce (nonce) {
  const n = _normHex(nonce);
  if (!/^[a-f0-9]{64}$/.test(n)) return null;
  return n;
}

/** Compressed 33-byte (02/03 + 32) or x-only 32-byte hex. Rejects `:` so fields cannot collide. */
function _normPubkey (value) {
  const s = _normHex(value);
  if (/^0[23][a-f0-9]{64}$/.test(s)) return s;
  if (/^[a-f0-9]{64}$/.test(s)) return s;
  return null;
}

/**
 * Canonical BIP340 message: A attests that B is the same actor.
 * @param {string} nonce 64-hex from the device-link session
 * @param {string} localPubkey signing device pubkey
 * @param {string} peerPubkey linked device pubkey
 * @returns {string|null}
 */
function buildCrossSignMessage (nonce, localPubkey, peerPubkey) {
  const n = _normNonce(nonce);
  const local = _normPubkey(localPubkey);
  const peer = _normPubkey(peerPubkey);
  if (!n || !local || !peer) return null;
  return `${CROSS_SIGN_PREFIX}:${n}:${local}:${peer}`;
}

/**
 * Canonical BIP340 message: either side splits the A↔B edge.
 * @param {string} nonce
 * @param {string} localPubkey
 * @param {string} peerPubkey
 * @returns {string|null}
 */
function buildRevokeMessage (nonce, localPubkey, peerPubkey) {
  const n = _normNonce(nonce);
  const local = _normPubkey(localPubkey);
  const peer = _normPubkey(peerPubkey);
  if (!n || !local || !peer) return null;
  return `${REVOKE_PREFIX}:${n}:${local}:${peer}`;
}

function parsePrefixed (msg, prefix) {
  const s = String(msg || '');
  const head = prefix + ':';
  if (!s.startsWith(head)) return null;
  const rest = s.slice(head.length);
  const nonce = rest.slice(0, 64);
  if (!/^[a-f0-9]{64}$/i.test(nonce) || rest[64] !== ':') return null;
  const after = rest.slice(65);
  const i = after.indexOf(':');
  if (i <= 0) return null;
  const localPubkey = _normPubkey(after.slice(0, i));
  const peerPubkey = _normPubkey(after.slice(i + 1));
  if (!localPubkey || !peerPubkey) return null;
  return { nonce: nonce.toLowerCase(), localPubkey, peerPubkey };
}

function parseCrossSignMessage (msg) {
  return parsePrefixed(msg, CROSS_SIGN_PREFIX);
}

function parseRevokeMessage (msg) {
  return parsePrefixed(msg, REVOKE_PREFIX);
}

/**
 * @param {string} type
 * @param {object} [fields]
 * @returns {object}
 */
function _typedObject (type, fields = {}) {
  return {
    type,
    '@type': type,
    localPubkey: _normPubkey(fields.localPubkey) || '',
    peerPubkey: _normPubkey(fields.peerPubkey) || '',
    nonce: _normNonce(fields.nonce) || '',
    createdAt: fields.createdAt || new Date().toISOString(),
    signature: fields.signature || null,
    pubkeyHex: fields.pubkeyHex || null,
    identity: fields.identity || null
  };
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

module.exports = {
  CROSS_SIGN_PREFIX,
  REVOKE_PREFIX,
  SIGN_TYPE,
  REVOKE_TYPE,
  buildCrossSignMessage,
  buildRevokeMessage,
  parseCrossSignMessage,
  parseRevokeMessage,
  buildCrossSignObject,
  buildRevokeObject,
  isCrossSignType
};
