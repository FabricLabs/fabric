'use strict';

/**
 * Tip-bound group chat sealing.
 *
 * Chat contract namespace = existing group Federation `contractId` (genesis Actor id).
 * Cipher key = HKDF-SHA256 over the peer's latest received ContractStateTip
 * (contractId + clock + stateDigest) with salt from sorted member x-only pubkeys.
 *
 * This gives participants who share a tip a deterministic AES-256-GCM key.
 * It is **not** forward-secret against hubs that also hold that tip+roster;
 * it removes cleartext from the mesh for observers without the tip.
 *
 * @module functions/groupChatSeal
 */

const crypto = require('crypto');
const HKDF = require('../types/hkdf');
const { tipDigestHex } = require('./contractStateSigning');

const SEAL_SCHEME = 'aes-256-gcm-groupchat-v1';
const HKDF_INFO_PREFIX = 'FabricGroupChat/v1/aes-256-gcm';
const SALT_LABEL = 'FabricGroupChat/v1';

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
 * Sorted unique x-only member list for salt.
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
 * Derive 32-byte AES key for a contract timeline tip.
 * @param {object} opts
 * @param {string} opts.contractId Group Federation contract id (chat contract)
 * @param {number} opts.clock Tip clock
 * @param {string} opts.stateDigest Tip stateDigest (hex)
 * @param {Iterable<*>} opts.memberPubkeys Members entitled to decrypt at this tip
 * @returns {Buffer} 32-byte key
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
 * @param {string} plaintextUtf8
 * @param {Buffer} key32
 * @returns {{ nonce: string, ciphertext: string }}
 */
function aesGcmSealUtf8 (plaintextUtf8, key32) {
  const key = Buffer.isBuffer(key32) ? key32 : Buffer.from(String(key32), 'hex');
  if (key.length !== 32) throw new Error('aesGcmSealUtf8: key must be 32 bytes');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([
    cipher.update(Buffer.from(String(plaintextUtf8), 'utf8')),
    cipher.final()
  ]);
  const tag = cipher.getAuthTag();
  return {
    nonce: iv.toString('base64'),
    ciphertext: Buffer.concat([enc, tag]).toString('base64')
  };
}

/**
 * @param {{ nonce: string, ciphertext: string }} sealed
 * @param {Buffer} key32
 * @returns {string} utf8 plaintext
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
 * Seal a GroupChat plaintext body for a tip.
 * @param {object} opts
 * @param {string} opts.body Plaintext message
 * @param {string} opts.contractId
 * @param {number} opts.clock
 * @param {string} opts.stateDigest
 * @param {Iterable<*>} opts.memberPubkeys
 * @returns {{ scheme: string, basisClock: number, stateDigest: string, nonce: string, ciphertext: string }}
 */
function sealGroupChatBody (opts = {}) {
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
 * Open a sealed GroupChat body using a tip (must match seal.basisClock/stateDigest).
 * @param {object} seal
 * @param {object} tipOpts Same shape as deriveTimelineCipherKey
 * @returns {string}
 */
function openGroupChatBody (seal, tipOpts = {}) {
  if (!seal || seal.scheme !== SEAL_SCHEME) {
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
 * True when payload carries a v1 group-chat seal.
 * @param {object|null|undefined} object
 * @returns {boolean}
 */
function isSealedGroupChat (object) {
  return !!(object && object.seal && object.seal.scheme === SEAL_SCHEME);
}

module.exports = {
  SEAL_SCHEME,
  pubkeyXOnly,
  sortedMemberXOnlys,
  chatSealSalt,
  deriveTimelineCipherKey,
  sealGroupChatBody,
  openGroupChatBody,
  isSealedGroupChat,
  aesGcmSealUtf8,
  aesGcmOpenUtf8
};
