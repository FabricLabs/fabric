'use strict';

/**
 * End-to-end confidentiality for onion-routed chat (`P2P_FORWARD` + `P2P_CHAT_MESSAGE`).
 *
 * `P2P_FORWARD` nests cleartext AMP frames; a curious relay can recurse into
 * nested inners. Seal the chat body to the final path recipient with the same
 * participant ECDH wrap used by GroupChat v2 so intermediates only see ciphertext.
 *
 * @module functions/onionChatSeal
 * @private
 */

const {
  SEAL_SCHEME_PARTICIPANT,
  pubkeyXOnly,
  sealParticipantGroupChatBody,
  openParticipantGroupChatBody
} = require('./groupChatSeal');

/** Wire marker for sealed onion chat UTF-8 bodies (not a legacy chat envelope). */
const ONION_CHAT_SEAL_TYPE = 'FabricOnionChatSeal';
const ONION_CHAT_SEAL_VERSION = 1;

/**
 * @param {*} text
 * @returns {object|null}
 */
function parseOnionChatSeal (text) {
  const trimmed = String(text || '').trim();
  if (!trimmed.startsWith('{')) return null;
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch (_) {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  if (parsed['@type'] !== ONION_CHAT_SEAL_TYPE) return null;
  if (Number(parsed.v) !== ONION_CHAT_SEAL_VERSION) return null;
  if (parsed.scheme !== SEAL_SCHEME_PARTICIPANT) return null;
  if (!parsed.ephemeralPub || !parsed.nonce || !parsed.ciphertext) return null;
  if (!Array.isArray(parsed.wraps) || !parsed.wraps.length) return null;
  return parsed;
}

/**
 * @param {*} text
 * @returns {boolean}
 */
function isOnionChatSeal (text) {
  return !!parseOnionChatSeal(text);
}

/**
 * Seal plaintext for one or more recipient pubkeys (typically the onion path tip).
 * @param {string} plaintext
 * @param {string|string[]} recipientPubkeys x-only or compressed hex
 * @returns {string} UTF-8 JSON body for `P2P_CHAT_MESSAGE`
 */
function sealOnionChatText (plaintext, recipientPubkeys) {
  const body = plaintext != null ? String(plaintext) : '';
  if (!body.trim()) throw new Error('sealOnionChatText: plaintext required');
  const members = Array.isArray(recipientPubkeys) ? recipientPubkeys : [recipientPubkeys];
  const seal = sealParticipantGroupChatBody({
    body,
    memberPubkeys: members
  });
  return JSON.stringify({
    '@type': ONION_CHAT_SEAL_TYPE,
    v: ONION_CHAT_SEAL_VERSION,
    scheme: seal.scheme,
    ephemeralPub: seal.ephemeralPub,
    wraps: seal.wraps,
    nonce: seal.nonce,
    ciphertext: seal.ciphertext
  });
}

/**
 * Try to open a sealed onion chat body with the local key.
 * @param {string} text wire body
 * @param {object} opts
 * @param {object|Buffer|string} opts.keyOrPrivate Fabric Key or 32-byte priv
 * @param {string} [opts.pubkey] optional reader pubkey hint
 * @returns {{ sealed: boolean, opened: boolean, text: string|null }}
 */
function tryOpenOnionChatText (text, opts = {}) {
  const seal = parseOnionChatSeal(text);
  if (!seal) {
    return { sealed: false, opened: false, text: text != null ? String(text) : null };
  }
  try {
    const opened = openParticipantGroupChatBody(seal, {
      keyOrPrivate: opts.keyOrPrivate != null ? opts.keyOrPrivate : opts.key,
      pubkey: opts.pubkey
    });
    return { sealed: true, opened: true, text: opened };
  } catch (_) {
    return { sealed: true, opened: false, text: null };
  }
}

/**
 * X-only hex for the last onion hop (final deliverer).
 * @param {Array<*>} path
 * @returns {string|null}
 */
function onionPathRecipientXOnly (path) {
  if (!Array.isArray(path) || !path.length) return null;
  const tip = path[path.length - 1];
  if (Buffer.isBuffer(tip)) return tip.toString('hex').toLowerCase();
  return pubkeyXOnly(tip);
}

module.exports = {
  ONION_CHAT_SEAL_TYPE,
  ONION_CHAT_SEAL_VERSION,
  isOnionChatSeal,
  parseOnionChatSeal,
  sealOnionChatText,
  tryOpenOnionChatText,
  onionPathRecipientXOnly
};
