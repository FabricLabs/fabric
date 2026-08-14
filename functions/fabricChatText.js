'use strict';

/**
 * Shared shoutbox text / author extraction for the Fabric TUI, Hub UI, and apps.
 *
 * Mesh wire (`P2P_CHAT_MESSAGE`): body = raw UTF-8 text; author = AMP signature.
 * Peer emits `{ text, type: 'P2P_CHAT_MESSAGE' }` plus meta `{ signer }`.
 * Hub SPA / WS may still cache `{ actor, object.content }` — that is the HTTP
 * edge, not the P2P body. `@fabric/http/functions/fabricChatNormalize` maps
 * both shapes into the Hub cache object.
 */

/**
 * @param {*} hex
 * @returns {string|null} lowercase 64-hex x-only, or null
 */
function pubkeyXOnly (hex) {
  const s = String(hex || '').toLowerCase().replace(/^0x/, '');
  if (/^0[23][0-9a-f]{64}$/.test(s)) return s.slice(2);
  if (/^[0-9a-f]{64}$/.test(s)) return s;
  return null;
}

/**
 * Extract displayable text from a chat payload or Peer chat event.
 * @param {object|string|null|undefined} chat
 * @returns {string}
 */
function chatTextOf (chat) {
  if (chat == null) return '';
  if (typeof chat === 'string') return chat;
  if (typeof chat !== 'object') return '';
  if (chat.text != null && String(chat.text).trim()) return String(chat.text);
  const obj = chat.object && typeof chat.object === 'object' ? chat.object : {};
  if (obj.content != null && String(obj.content).trim()) return String(obj.content);
  if (obj.body != null && String(obj.body).trim()) return String(obj.body);
  if (chat.content != null && String(chat.content).trim()) return String(chat.content);
  if (chat.body != null && String(chat.body).trim()) return String(chat.body);
  return '';
}

/**
 * Actor / author id (pubkey) from Hub UI shape or Peer meta/signer.
 * Prefers x-only when the value is a parseable secp256k1 pubkey hex.
 * @param {object|null|undefined} chat
 * @param {Object} [opts]
 * @param {string|null} [opts.defaultActorId]
 * @param {string|null} [opts.signer]
 * @returns {string|null}
 */
function chatActorIdOf (chat, opts = {}) {
  let raw = null;
  if (opts.signer) raw = String(opts.signer);
  else if (chat && typeof chat === 'object') {
    const actor = chat.actor && typeof chat.actor === 'object' ? chat.actor : {};
    raw = actor.id || actor.publicKey || actor.pubkey || null;
    if (!raw) {
      const obj = chat.object && typeof chat.object === 'object' ? chat.object : {};
      if (obj.author) raw = obj.author;
    }
  }
  if (!raw && opts.defaultActorId) raw = opts.defaultActorId;
  if (!raw) return null;
  const s = String(raw);
  const x = pubkeyXOnly(s);
  return x || s;
}

/**
 * Format a shoutbox line: nickname when known, else truncated pubkey.
 * @param {string|null|undefined} actorId
 * @param {string|null|undefined} alias
 * @param {string} text
 * @param {function} [truncate]
 * @returns {string}
 */
function formatChatLogLine (actorId, alias, text, truncate) {
  const nick = alias && String(alias).trim() ? String(alias).trim() : '';
  let label = nick;
  if (!label) {
    const id = actorId != null ? String(actorId) : '';
    const short = typeof truncate === 'function'
      ? truncate(id, 10, '…', 5)
      : (id.length > 10 ? id.slice(0, 5) + '…' + id.slice(-5) : id);
    label = '@' + short;
  }
  return `[${label}]: ${text}`;
}

module.exports = {
  pubkeyXOnly,
  chatTextOf,
  chatActorIdOf,
  formatChatLogLine
};
