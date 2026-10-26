'use strict';

/**
 * @fileoverview Sign / verify IdentityCrossSign bodies with protocol identity
 * Schnorr (`functions/fabricIdentitySchnorr`). AMP / envelope author is transport
 * only — the inner BIP340 over the canonical tagged string is the identity proof.
 */

const {
  buildFabricIdentitySignedPayload,
  resolveFabricSigningIdentity,
  verifyIdentitySchnorr
} = require('./fabricIdentitySchnorr');
const {
  SIGN_TYPE,
  REVOKE_TYPE,
  CROSS_SIGN_TAG,
  REVOKE_TAG,
  buildCrossSignMessage,
  buildRevokeMessage,
  buildCrossSignObject,
  buildRevokeObject,
  coerceCrossSignObject,
  parseCrossSignMessage,
  parseRevokeMessage
} = require('./identityCrossSign');
const { pubkeysMatch } = require('./pubkey');

function _messageFor (kind, rec) {
  return kind === REVOKE_TYPE ? buildRevokeMessage(rec) : buildCrossSignMessage(rec);
}

function _tagFor (kind) {
  return kind === REVOKE_TYPE ? REVOKE_TAG : CROSS_SIGN_TAG;
}

/**
 * @param {object} identity unlocked Fabric Identity, HD Key, or Passport
 *   `{ privateKeyHex, xpub }` leaf. Canonical `localPubkey` is the Fabric
 *   signing key (`fabricKey.pubkey`), never Bech32 `identity.id` or the
 *   HD master pubkey.
 * @param {object} fields `{ peerPubkey, nonce, sessionId, origin, createdAt?, revokedAt? }`
 *   `createdAt` is display metadata only — it is not in the canonical string
 *   and must not be treated as authenticated. `revokedAt` (revokes) is signed.
 * @param {string} [kind]
 * @returns {object}
 */
function signCrossSign (identity, fields, kind = SIGN_TYPE) {
  if (!fields || typeof fields !== 'object') {
    throw new Error('cross-sign fields required');
  }
  if (kind !== SIGN_TYPE && kind !== REVOKE_TYPE) {
    throw new Error('unknown cross-sign type');
  }
  const resolved = resolveFabricSigningIdentity(identity);
  const localPubkey = String(resolved.fabricKey.pubkey || '');
  const rec = {
    sessionId: fields.sessionId,
    nonce: fields.nonce,
    localPubkey,
    peerPubkey: fields.peerPubkey,
    origin: fields.origin,
    createdAt: fields.createdAt,
    revokedAt: kind === REVOKE_TYPE ? (fields.revokedAt || Date.now()) : undefined
  };
  const message = _messageFor(kind, rec);
  if (!message) throw new Error('invalid cross-sign fields');
  const signed = buildFabricIdentitySignedPayload(resolved, message, _tagFor(kind));
  return kind === REVOKE_TYPE
    ? buildRevokeObject(Object.assign({}, rec, signed))
    : buildCrossSignObject(Object.assign({}, rec, signed));
}

/**
 * @param {object} object gossip / HTTP body, or a CONTRACT_MESSAGE body wrapping one
 * @param {string} [_signerPubkey] AMP / envelope author when present (ignored)
 * @returns {{ ok: true, kind: string, record: object }|{ ok: false, error: string }}
 *   `record.createdAt` is copied from the body when present; it is not covered
 *   by the Schnorr signature.
 */
function verifyCrossSignObject (object, _signerPubkey) {
  object = coerceCrossSignObject(object);
  if (!object || typeof object !== 'object') {
    return { ok: false, error: 'cross-sign object required' };
  }
  const kind = object.type || object['@type'];
  if (kind !== SIGN_TYPE && kind !== REVOKE_TYPE) {
    return { ok: false, error: 'unknown cross-sign type' };
  }
  const rec = {
    sessionId: object.sessionId,
    nonce: object.nonce,
    localPubkey: object.localPubkey,
    peerPubkey: object.peerPubkey,
    origin: object.origin,
    revokedAt: object.revokedAt
  };
  const message = _messageFor(kind, rec);
  if (!message) return { ok: false, error: 'invalid cross-sign fields' };
  // The record is read back from the signed string, so an alias of a field
  // (`0x`, whitespace, case) verifies as the canonical link a revoke names.
  const signed = kind === REVOKE_TYPE ? parseRevokeMessage(message) : parseCrossSignMessage(message);
  if (!signed) return { ok: false, error: 'invalid cross-sign fields' };
  if (!pubkeysMatch(object.pubkeyHex, signed.localPubkey)) {
    return { ok: false, error: 'pubkey does not match localPubkey' };
  }
  const checked = verifyIdentitySchnorr(
    message,
    object.signature,
    object.pubkeyHex,
    object.identity,
    _tagFor(kind)
  );
  if (!checked.ok) return { ok: false, error: checked.error || 'signature failed' };
  const record = {
    sessionId: signed.sessionId,
    nonce: signed.nonce,
    localPubkey: signed.localPubkey,
    peerPubkey: signed.peerPubkey,
    origin: signed.origin,
    createdAt: object.createdAt || null
  };
  if (kind === REVOKE_TYPE) record.revokedAt = signed.revokedAt;
  return { ok: true, kind, record };
}

module.exports = {
  signCrossSign,
  verifyCrossSignObject
};
