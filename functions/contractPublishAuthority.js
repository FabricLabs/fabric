'use strict';

/**
 * CONTRACT_PUBLISH authority lists — shared by Peer ingest and Hub Accept.
 * @module functions/contractPublishAuthority
 */

/**
 * @param {string|null|undefined} pk
 * @returns {string}
 */
function normalizePeerPubkeyHex (pk) {
  if (pk == null) return '';
  if (Buffer.isBuffer(pk)) {
    const h = pk.toString('hex').toLowerCase();
    if (pk.length === 32) return h;
    if (pk.length === 33 && (h.startsWith('02') || h.startsWith('03'))) return h.slice(2);
    return h;
  }
  const s = String(pk).trim();
  const h = (s.startsWith('0x') || s.startsWith('0X')) ? s.slice(2) : s;
  const lo = h.toLowerCase();
  if (lo.length === 66 && (lo.startsWith('02') || lo.startsWith('03'))) return lo.slice(2);
  return lo;
}

/**
 * Pubkeys declared as patch authorities on a CONTRACT_PUBLISH body.
 * @param {object} object
 * @returns {Set<string>}
 */
function collectContractAuthorityPubkeys (object) {
  const set = new Set();
  const add = (hex) => {
    const h = normalizePeerPubkeyHex(hex);
    if (/^[0-9a-f]{64}$/.test(h) || /^[0-9a-f]{66}$/.test(h)) set.add(h);
  };
  const addList = (list) => {
    if (!Array.isArray(list)) return;
    for (const entry of list) {
      if (typeof entry === 'string') add(entry);
      else if (entry && typeof entry === 'object') {
        add(entry.pubkey || entry.publicKey || entry.id);
      }
    }
  };
  const def = object && typeof object === 'object' ? object : {};
  addList(def.validators);
  addList(def.parties);
  addList(def.owners);
  addList(def.authorities);
  if (Array.isArray(def.members)) {
    addList(def.members);
  } else if (def.members && typeof def.members === 'object') {
    addList(def.members.signers);
    addList(def.members.validators);
    addList(def.members.parties);
    addList(def.members.owners);
    addList(def.members.authorities);
  }
  if (def.spendPolicy && typeof def.spendPolicy === 'object') {
    addList(def.spendPolicy.validators);
    addList(def.spendPolicy.parties);
  }
  if (def.proposedPolicy && typeof def.proposedPolicy === 'object') {
    addList(def.proposedPolicy.validators);
    addList(def.proposedPolicy.parties);
    addList(def.proposedPolicy.signers);
  }
  return set;
}

/**
 * Whether pubkeyHex is present in an authority set (x-only ↔ compressed tolerant).
 * @param {Set<string>} authorities
 * @param {string} pubkeyHex
 * @returns {boolean}
 */
function authoritySetHasPubkey (authorities, pubkeyHex) {
  const h = normalizePeerPubkeyHex(pubkeyHex);
  if (!h || !authorities || !authorities.size) return false;
  if (authorities.has(h)) return true;
  if (h.length === 64) {
    for (const entry of authorities) {
      if (typeof entry === 'string' && entry.length === 66 && entry.slice(2) === h) return true;
    }
  } else if (h.length === 66) {
    const xOnly = h.slice(2);
    if (authorities.has(xOnly)) return true;
  }
  return false;
}

/**
 * Whether a wire signer is listed in contract authority arrays.
 *
 * Empty authority set → any signer (open genesis / observe-only publish).
 * Non-empty authority set → AMP wire signer **must** be present and listed
 * (fail closed: missing signer used to return true and looked like authz was
 * complete while unsigned frames could still register).
 *
 * @param {object} object
 * @param {string|null} signerPubkeyHex
 * @returns {boolean}
 */
function contractPublishSignerAuthorized (object, signerPubkeyHex = null) {
  const authorities = collectContractAuthorityPubkeys(object);
  if (!authorities.size) return true;
  const pub = normalizePeerPubkeyHex(signerPubkeyHex);
  if (!pub) return false;
  return authoritySetHasPubkey(authorities, pub);
}

module.exports = {
  normalizePeerPubkeyHex,
  collectContractAuthorityPubkeys,
  authoritySetHasPubkey,
  contractPublishSignerAuthorized
};
