'use strict';

/**
 * @fileoverview Sign / verify IdentityCrossSign bodies with protocol identity
 * Schnorr (`functions/fabricIdentitySchnorr`). AMP / envelope author is transport
 * only — the inner BIP340 over the canonical string is the identity proof.
 */

const {
  buildFabricIdentitySignedPayload,
  verifyIdentitySchnorr
} = require('./fabricIdentitySchnorr');
const {
  SIGN_TYPE,
  REVOKE_TYPE,
  buildCrossSignMessage,
  buildRevokeMessage,
  buildCrossSignObject,
  buildRevokeObject
} = require('./identityCrossSign');

function pubkeyXOnly (hex) {
  const s = String(hex || '').toLowerCase().replace(/^0x/, '');
  if (/^0[23][0-9a-f]{64}$/.test(s)) return s.slice(2);
  if (/^[0-9a-f]{64}$/.test(s)) return s;
  return null;
}

function pubkeysMatch (a, b) {
  const xa = pubkeyXOnly(a);
  const xb = pubkeyXOnly(b);
  return !!(xa && xb && xa === xb);
}

function _messageFor (kind, rec) {
  if (kind === REVOKE_TYPE) {
    return buildRevokeMessage(rec.nonce, rec.localPubkey, rec.peerPubkey);
  }
  return buildCrossSignMessage(rec.nonce, rec.localPubkey, rec.peerPubkey);
}

/**
 * @param {object} identity unlocked Fabric identity (xprv / mnemonic)
 * @param {object} fields { peerPubkey, nonce, createdAt? }
 * @param {string} [kind]
 * @returns {object}
 */
function signCrossSign (identity, fields, kind = SIGN_TYPE) {
  const localPubkey = identity && (identity.pubkey || identity.id);
  const rec = {
    localPubkey,
    peerPubkey: fields.peerPubkey,
    nonce: fields.nonce,
    createdAt: fields.createdAt
  };
  const message = _messageFor(kind, rec);
  if (!message) throw new Error('invalid cross-sign fields');
  const signed = buildFabricIdentitySignedPayload(identity, message);
  const base = kind === REVOKE_TYPE
    ? buildRevokeObject(Object.assign({}, rec, signed))
    : buildCrossSignObject(Object.assign({}, rec, signed));
  return base;
}

/**
 * @param {object} object gossip / HTTP body
 * @param {string} [_signerPubkey] AMP / envelope author when present (ignored)
 * @returns {{ ok: true, kind: string, record: object }|{ ok: false, error: string }}
 */
function verifyCrossSignObject (object, _signerPubkey) {
  if (!object || typeof object !== 'object') {
    return { ok: false, error: 'cross-sign object required' };
  }
  const kind = object.type || object['@type'];
  if (kind !== SIGN_TYPE && kind !== REVOKE_TYPE) {
    return { ok: false, error: 'unknown cross-sign type' };
  }
  const localPubkey = object.localPubkey || object.pubkeyHex;
  const peerPubkey = object.peerPubkey;
  const nonce = object.nonce;
  const message = _messageFor(kind, { localPubkey, peerPubkey, nonce });
  if (!message) return { ok: false, error: 'invalid cross-sign fields' };
  const checked = verifyIdentitySchnorr(
    message,
    object.signature,
    object.pubkeyHex || localPubkey,
    object.identity
  );
  if (!checked.ok) return { ok: false, error: checked.error || 'signature failed' };
  if (!pubkeysMatch(checked.key && checked.key.pubkey, localPubkey) &&
    !pubkeysMatch(object.pubkeyHex, localPubkey)) {
    return { ok: false, error: 'pubkey does not match localPubkey' };
  }
  return {
    ok: true,
    kind,
    record: {
      localPubkey,
      peerPubkey,
      nonce,
      createdAt: object.createdAt || null
    }
  };
}

module.exports = {
  signCrossSign,
  verifyCrossSignObject,
  pubkeysMatch
};
