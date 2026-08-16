'use strict';

/**
 * Mesh chat surface classification — gossip network stays primary; chat is
 * layered on top as either a public shoutbox or sealed confidential traffic
 * (first wave for future contract messaging).
 *
 * | Surface | Wire | Confidentiality |
 * |---------|------|-----------------|
 * | `shoutbox` | cleartext `P2P_CHAT_MESSAGE` flood | Public to mesh relays |
 * | `onion_seal` | `P2P_FORWARD` + sealed `P2P_CHAT_MESSAGE` body | E2E to path tip |
 * | `group_seal` | `CONTRACT_MESSAGE` GroupChat with seal | Members (v2 hub-blind) |
 * | `contract_cleartext` | GroupChat without seal | Relays can read |
 *
 * @module functions/fabricChatKind
 * @see PRIVACY.md
 * @see functions/onionChatSeal.js
 * @see functions/groupChatSeal.js
 */

const { isOnionChatSeal } = require('./onionChatSeal');
const {
  isSealedGroupChat,
  isParticipantSealedGroupChat
} = require('./groupChatSeal');

/** @enum {string} */
const CHAT_SURFACE = Object.freeze({
  SHOUTBOX: 'shoutbox',
  ONION_SEAL: 'onion_seal',
  GROUP_SEAL: 'group_seal',
  CONTRACT_CLEARTEXT: 'contract_cleartext',
  UNKNOWN: 'unknown'
});

function looksLikeGroupSeal (value) {
  if (!value || typeof value !== 'object') return false;
  if (isSealedGroupChat(value) || isParticipantSealedGroupChat(value)) return true;
  if (value.seal && (isSealedGroupChat(value) || isParticipantSealedGroupChat(value.seal))) {
    return true;
  }
  return false;
}

/**
 * Classify a UTF-8 chat body or GroupChat object for UI / policy.
 * @param {string|object|null|undefined} body
 * @param {Object} [opts]
 * @param {string} [opts.appType] CONTRACT_MESSAGE type (e.g. GroupChat)
 * @returns {string} one of {@link CHAT_SURFACE}
 */
function classifyChatSurface (body, opts = {}) {
  const appType = opts.appType != null ? String(opts.appType) : null;

  if (typeof body === 'string' || body == null) {
    if (isOnionChatSeal(body)) return CHAT_SURFACE.ONION_SEAL;
    if (appType === 'GroupChat') return CHAT_SURFACE.CONTRACT_CLEARTEXT;
    return CHAT_SURFACE.SHOUTBOX;
  }

  if (typeof body === 'object' && !Array.isArray(body)) {
    if (body['@type'] === 'FabricOnionChatSeal' || isOnionChatSeal(JSON.stringify(body))) {
      return CHAT_SURFACE.ONION_SEAL;
    }
    if (looksLikeGroupSeal(body) || looksLikeGroupSeal(body.object)) {
      return CHAT_SURFACE.GROUP_SEAL;
    }
    if (appType === 'GroupChat' || body.type === 'GroupChat' || body['@type'] === 'GroupChat') {
      return CHAT_SURFACE.CONTRACT_CLEARTEXT;
    }
  }

  return CHAT_SURFACE.UNKNOWN;
}

/**
 * True when the frame is public mesh flood (relays can read UTF-8).
 * @param {string|object|null|undefined} body
 * @param {Object} [opts]
 * @returns {boolean}
 */
function isPublicMeshShoutbox (body, opts = {}) {
  return classifyChatSurface(body, opts) === CHAT_SURFACE.SHOUTBOX;
}

/**
 * True when confidentiality is intended (onion seal or group participant/tip seal).
 * @param {string|object|null|undefined} body
 * @param {Object} [opts]
 * @returns {boolean}
 */
function isConfidentialChatSurface (body, opts = {}) {
  const kind = classifyChatSurface(body, opts);
  return kind === CHAT_SURFACE.ONION_SEAL || kind === CHAT_SURFACE.GROUP_SEAL;
}

/**
 * Short operator-facing label for UI chips.
 * @param {string} surface
 * @returns {string}
 */
function chatSurfaceLabel (surface) {
  switch (String(surface || '')) {
    case CHAT_SURFACE.SHOUTBOX:
      return 'Public mesh shoutbox';
    case CHAT_SURFACE.ONION_SEAL:
      return 'Onion-sealed chat';
    case CHAT_SURFACE.GROUP_SEAL:
      return 'Sealed group chat';
    case CHAT_SURFACE.CONTRACT_CLEARTEXT:
      return 'Group chat (cleartext at relays)';
    default:
      return 'Chat';
  }
}

module.exports = {
  CHAT_SURFACE,
  classifyChatSurface,
  isPublicMeshShoutbox,
  isConfidentialChatSurface,
  chatSurfaceLabel
};
