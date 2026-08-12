'use strict';

/**
 * Group / pair chat sealing for Application Resource Contracts.
 *
 * **v1 (interim):** tip-bound HKDF — cipher key from ContractStateTip + roster.
 * Observers without the tip cannot read cleartext, but any tip holder (incl. a
 * journaling hub) can derive the same key.
 *
 * **v2 (hub-blind target):** random content key, AES-GCM body, per-recipient
 * ECDH wraps (ephemeral secp256k1 × participant pubkey). Tip/roster may still
 * appear as public metadata; they are **not** IKM for content.
 *
 * @module functions/groupChatSeal
 */

const crypto = require('crypto');
const { secp256k1 } = require('@noble/curves/secp256k1.js');
const HKDF = require('../types/hkdf');
const Key = require('../types/key');
const { tipDigestHex } = require('./contractStateSigning');

/** Tip-bound interim scheme (not hub-blind). */
const SEAL_SCHEME = 'aes-256-gcm-groupchat-v1';
/** Participant-key hub-blind scheme. */
const SEAL_SCHEME_PARTICIPANT = 'aes-256-gcm-participant-v1';

const HKDF_INFO_PREFIX = 'FabricGroupChat/v1/aes-256-gcm';
const SALT_LABEL = 'FabricGroupChat/v1';
const PARTICIPANT_WRAP_LABEL = 'FabricGroupChat/participant-v1/wrap';
const PARTICIPANT_SALT_LABEL = 'FabricGroupChat/participant-v1';

/**
 * Normalize to lowercase 64-hex x-only (accepts compressed 02/03||x).
 * @param {*} hex
 * @returns {string|null}
 */
function pubkeyXOnly (hex) {
  const s = String(hex || '').toLowerCase().replace(/^0x/, '');
  if (/^0[23][0-9a-f]{64}$/.test(s)) return s.slice(2);
  if (/^[0-9a-f]{64}$/.test(s)) return s;
  return null;
}

/**
 * Compressed 33-byte pubkey hex from x-only or compressed input.
 * @param {*} hex
 * @returns {string|null}
 */
function pubkeyCompressed (hex) {
  const s = String(hex || '').toLowerCase().replace(/^0x/, '');
  if (/^0[23][0-9a-f]{64}$/.test(s)) return s;
  const x = pubkeyXOnly(s);
  if (!x) return null;
  const Point = secp256k1.ProjectivePoint || secp256k1.Point;
  for (const prefix of ['02', '03']) {
    const cand = prefix + x;
    try {
      if (Point && typeof Point.fromHex === 'function') {
        Point.fromHex(cand);
        return cand;
      }
      if (Point && typeof Point.fromBytes === 'function') {
        Point.fromBytes(Buffer.from(cand, 'hex'));
        return cand;
      }
      // Last resort: ECDH probe with fixed priv (valid curve scalar).
      secp256k1.getSharedSecret(Buffer.alloc(32, 1), Buffer.from(cand, 'hex'), true);
      return cand;
    } catch (_) { /* try other parity */ }
  }
  throw new Error('pubkeyCompressed: x-only does not lift to a curve point');
}

/**
 * Sorted unique x-only member list for salt / wrap recipients.
 * @param {Iterable<*>} pubkeys
 * @returns {string[]}
 */
function sortedMemberXOnlys (pubkeys) {
  const set = new Set();
  for (const pk of pubkeys || []) {
    const x = pubkeyXOnly(pk);
    if (x) set.add(x);
  }
  return Array.from(set).sort();
}

/**
 * Salt for HKDF: SHA-256(label || members || contractId).
 * @param {string} contractId
 * @param {Iterable<*>} memberPubkeys
 * @returns {Buffer}
 */
function chatSealSalt (contractId, memberPubkeys) {
  const members = sortedMemberXOnlys(memberPubkeys);
  const h = crypto.createHash('sha256');
  h.update(SALT_LABEL);
  h.update('\0');
  h.update(String(contractId || '').trim().toLowerCase());
  h.update('\0');
  h.update(members.join(','));
  return h.digest();
}

/**
 * Derive 32-byte AES key for a contract timeline tip (v1).
 * @param {object} opts
 * @returns {Buffer}
 */
function deriveTimelineCipherKey (opts = {}) {
  const contractId = String(opts.contractId || '').trim().toLowerCase();
  const clock = Number(opts.clock) || 0;
  const stateDigest = String(opts.stateDigest || '').trim().toLowerCase();
  if (!contractId) throw new Error('deriveTimelineCipherKey: contractId required');
  if (!/^[0-9a-f]{64}$/.test(stateDigest)) {
    throw new Error('deriveTimelineCipherKey: stateDigest must be 64-hex');
  }
  const members = sortedMemberXOnlys(opts.memberPubkeys);
  if (!members.length) {
    throw new Error('deriveTimelineCipherKey: at least one member pubkey required');
  }

  const ikmHex = tipDigestHex(contractId, clock, stateDigest);
  const salt = chatSealSalt(contractId, members);
  const info = Buffer.from(
    `${HKDF_INFO_PREFIX}|${contractId}|${clock}|${stateDigest}`,
    'utf8'
  );
  const hkdf = new HKDF({
    algorithm: 'sha256',
    initial: Buffer.from(ikmHex, 'hex'),
    salt
  });
  return hkdf.derive(info, 32);
}

/**
 * @param {string|Buffer} plaintextUtf8
 * @param {Buffer} key32
 * @returns {{ nonce: string, ciphertext: string }}
 */
function aesGcmSealUtf8 (plaintextUtf8, key32) {
  const key = Buffer.isBuffer(key32) ? key32 : Buffer.from(String(key32), 'hex');
  if (key.length !== 32) throw new Error('aesGcmSealUtf8: key must be 32 bytes');
  const iv = crypto.randomBytes(12);
  const plain = Buffer.isBuffer(plaintextUtf8)
    ? plaintextUtf8
    : Buffer.from(String(plaintextUtf8), 'utf8');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    nonce: iv.toString('base64'),
    ciphertext: Buffer.concat([enc, tag]).toString('base64')
  };
}

/**
 * @param {{ nonce: string, ciphertext: string }} sealed
 * @param {Buffer} key32
 * @returns {string}
 */
function aesGcmOpenUtf8 (sealed, key32) {
  const key = Buffer.isBuffer(key32) ? key32 : Buffer.from(String(key32), 'hex');
  if (key.length !== 32) throw new Error('aesGcmOpenUtf8: key must be 32 bytes');
  const iv = Buffer.from(String(sealed && sealed.nonce || ''), 'base64');
  const ct = Buffer.from(String(sealed && sealed.ciphertext || ''), 'base64');
  if (iv.length !== 12) throw new Error('aesGcmOpenUtf8: nonce must be 12 bytes');
  if (ct.length < 16) throw new Error('aesGcmOpenUtf8: ciphertext too short');
  const tag = ct.subarray(ct.length - 16);
  const data = ct.subarray(0, ct.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

/**
 * ECDH shared X (32 bytes) for secp256k1.
 * @param {Buffer|string} privateKey
 * @param {Buffer|string} publicKeyCompressed
 * @returns {Buffer}
 */
function ecdhSharedX (privateKey, publicKeyCompressed) {
  const priv = Buffer.isBuffer(privateKey) ? privateKey : Buffer.from(String(privateKey), 'hex');
  if (priv.length !== 32) throw new Error('ecdhSharedX: private key must be 32 bytes');
  const pubHex = pubkeyCompressed(publicKeyCompressed);
  if (!pubHex) throw new Error('ecdhSharedX: invalid public key');
  const ss = Buffer.from(secp256k1.getSharedSecret(priv, Buffer.from(pubHex, 'hex'), false));
  return ss.subarray(1, 33);
}

/**
 * @param {Buffer} sharedX
 * @param {string} recipientXOnly
 * @param {string} ephemeralPubHex
 * @returns {Buffer}
 */
function deriveParticipantWrapKey (sharedX, recipientXOnly, ephemeralPubHex) {
  const salt = crypto.createHash('sha256')
    .update(PARTICIPANT_SALT_LABEL)
    .update('\0')
    .update(String(recipientXOnly || '').toLowerCase())
    .update('\0')
    .update(String(ephemeralPubHex || '').toLowerCase())
    .digest();
  const info = Buffer.from(PARTICIPANT_WRAP_LABEL, 'utf8');
  const hkdf = new HKDF({
    algorithm: 'sha256',
    initial: sharedX,
    salt
  });
  return hkdf.derive(info, 32);
}

/**
 * Seal GroupChat with a random content key wrapped to each participant (v2).
 * @param {object} opts
 * @returns {object}
 */
function sealParticipantGroupChatBody (opts = {}) {
  const body = opts.body != null ? String(opts.body) : '';
  if (!body.trim()) throw new Error('sealParticipantGroupChatBody: body required');
  const recipients = sortedMemberXOnlys(opts.memberPubkeys);
  if (!recipients.length) {
    throw new Error('sealParticipantGroupChatBody: at least one member pubkey required');
  }

  const contentKey = crypto.randomBytes(32);
  const ephemeral = new Key();
  if (!ephemeral.private || !ephemeral.pubkey) {
    throw new Error('sealParticipantGroupChatBody: failed to mint ephemeral key');
  }
  const ephemeralPub = String(ephemeral.pubkey).toLowerCase();

  const wraps = [];
  for (const x of recipients) {
    const compressed = pubkeyCompressed(x);
    const shared = ecdhSharedX(ephemeral.private, compressed);
    const wrapKey = deriveParticipantWrapKey(shared, x, ephemeralPub);
    const wrapped = aesGcmSealUtf8(contentKey.toString('hex'), wrapKey);
    wraps.push({
      recipient: x,
      nonce: wrapped.nonce,
      ciphertext: wrapped.ciphertext
    });
  }

  const sealed = aesGcmSealUtf8(body, contentKey);
  const out = {
    scheme: SEAL_SCHEME_PARTICIPANT,
    ephemeralPub,
    wraps,
    nonce: sealed.nonce,
    ciphertext: sealed.ciphertext
  };
  if (opts.clock != null) out.basisClock = Number(opts.clock) || 0;
  if (opts.stateDigest != null) {
    out.stateDigest = String(opts.stateDigest).trim().toLowerCase();
  }
  if (opts.contractId != null) {
    out.contractId = String(opts.contractId).trim().toLowerCase();
  }
  return out;
}

/**
 * Open a v2 participant seal with the reader's private key.
 * @param {object} seal
 * @param {object} opts
 * @returns {string}
 */
function openParticipantGroupChatBody (seal, opts = {}) {
  if (!seal || seal.scheme !== SEAL_SCHEME_PARTICIPANT) {
    throw new Error('openParticipantGroupChatBody: unsupported or missing seal');
  }
  if (!Array.isArray(seal.wraps) || !seal.wraps.length) {
    throw new Error('openParticipantGroupChatBody: missing wraps');
  }
  const ephemeralPub = pubkeyCompressed(seal.ephemeralPub);
  if (!ephemeralPub) throw new Error('openParticipantGroupChatBody: bad ephemeralPub');

  let priv = null;
  let myX = pubkeyXOnly(opts.pubkey);
  const raw = opts.keyOrPrivate != null ? opts.keyOrPrivate : opts.key;
  if (raw && typeof raw === 'object' && raw.private) {
    priv = Buffer.isBuffer(raw.private) ? raw.private : Buffer.from(String(raw.private), 'hex');
    if (!myX && raw.pubkey) myX = pubkeyXOnly(raw.pubkey);
  } else if (Buffer.isBuffer(raw) || (typeof raw === 'string' && /^[0-9a-fA-F]{64}$/.test(raw))) {
    priv = Buffer.isBuffer(raw) ? raw : Buffer.from(raw, 'hex');
  } else if (raw && typeof raw === 'object' && (raw.xprv || raw.mnemonic)) {
    const k = new Key(raw.xprv ? { xprv: raw.xprv } : { mnemonic: raw.mnemonic });
    priv = Buffer.isBuffer(k.private) ? k.private : Buffer.from(String(k.private), 'hex');
    if (!myX) myX = pubkeyXOnly(k.pubkey);
  }
  if (!priv || priv.length !== 32) {
    throw new Error('openParticipantGroupChatBody: private key required');
  }
  if (!myX) {
    const pub = Buffer.from(secp256k1.getPublicKey(priv, true)).toString('hex');
    myX = pubkeyXOnly(pub);
  }

  const wrap = seal.wraps.find((w) => pubkeyXOnly(w && w.recipient) === myX);
  if (!wrap) throw new Error('openParticipantGroupChatBody: no wrap for reader');

  const shared = ecdhSharedX(priv, ephemeralPub);
  const wrapKey = deriveParticipantWrapKey(shared, myX, ephemeralPub.toLowerCase());
  const contentKeyHex = aesGcmOpenUtf8(wrap, wrapKey);
  if (!/^[0-9a-f]{64}$/i.test(contentKeyHex)) {
    throw new Error('openParticipantGroupChatBody: bad content key');
  }
  return aesGcmOpenUtf8(seal, Buffer.from(contentKeyHex, 'hex'));
}

/**
 * Seal a GroupChat plaintext body (v1 tip, or v2 when mode/scheme requests participant).
 * @param {object} opts
 * @returns {object}
 */
function sealGroupChatBody (opts = {}) {
  if (opts.mode === 'participant' || opts.scheme === SEAL_SCHEME_PARTICIPANT) {
    return sealParticipantGroupChatBody(opts);
  }
  const body = opts.body != null ? String(opts.body) : '';
  if (!body.trim()) throw new Error('sealGroupChatBody: body required');
  const key = deriveTimelineCipherKey(opts);
  const sealed = aesGcmSealUtf8(body, key);
  return {
    scheme: SEAL_SCHEME,
    basisClock: Number(opts.clock) || 0,
    stateDigest: String(opts.stateDigest || '').trim().toLowerCase(),
    nonce: sealed.nonce,
    ciphertext: sealed.ciphertext
  };
}

/**
 * Open a sealed GroupChat body (v1 tip or v2 participant).
 * @param {object} seal
 * @param {object} tipOpts
 * @returns {string}
 */
function openGroupChatBody (seal, tipOpts = {}) {
  if (!seal || !seal.scheme) {
    throw new Error('openGroupChatBody: unsupported or missing seal');
  }
  if (seal.scheme === SEAL_SCHEME_PARTICIPANT) {
    return openParticipantGroupChatBody(seal, tipOpts);
  }
  if (seal.scheme !== SEAL_SCHEME) {
    throw new Error('openGroupChatBody: unsupported or missing seal');
  }
  const clock = Number(tipOpts.clock);
  const digest = String(tipOpts.stateDigest || '').trim().toLowerCase();
  if (Number(seal.basisClock) !== clock) {
    throw new Error('openGroupChatBody: tip clock does not match seal.basisClock');
  }
  if (String(seal.stateDigest || '').toLowerCase() !== digest) {
    throw new Error('openGroupChatBody: tip stateDigest does not match seal');
  }
  const key = deriveTimelineCipherKey({
    contractId: tipOpts.contractId,
    clock,
    stateDigest: digest,
    memberPubkeys: tipOpts.memberPubkeys
  });
  return aesGcmOpenUtf8(seal, key);
}

/**
 * @param {object|null|undefined} object
 * @returns {boolean}
 */
function isSealedGroupChat (object) {
  const scheme = object && object.seal && object.seal.scheme;
  return scheme === SEAL_SCHEME || scheme === SEAL_SCHEME_PARTICIPANT;
}

/**
 * @param {object|null|undefined} sealOrObject
 * @returns {boolean}
 */
function isParticipantSealedGroupChat (sealOrObject) {
  const seal = sealOrObject && sealOrObject.seal ? sealOrObject.seal : sealOrObject;
  return !!(seal && seal.scheme === SEAL_SCHEME_PARTICIPANT);
}

module.exports = {
  SEAL_SCHEME,
  SEAL_SCHEME_PARTICIPANT,
  pubkeyXOnly,
  pubkeyCompressed,
  sortedMemberXOnlys,
  chatSealSalt,
  deriveTimelineCipherKey,
  ecdhSharedX,
  deriveParticipantWrapKey,
  sealGroupChatBody,
  sealParticipantGroupChatBody,
  openGroupChatBody,
  openParticipantGroupChatBody,
  isSealedGroupChat,
  isParticipantSealedGroupChat,
  aesGcmSealUtf8,
  aesGcmOpenUtf8
};
