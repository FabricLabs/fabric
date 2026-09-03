'use strict';

/**
 * @fileoverview AMP header `parent` (32 bytes). Genesis is 32 zero bytes.
 * After genesis, parent SHOULD be the previous signed {@link Message#id}
 * (SHA-256 of the complete AMP frame). Parent is inside the Schnorr-signed
 * header, so it must be set before {@link Message#signWithKey}.
 *
 * Body integrity remains header `hash` = double-SHA256(body). Collection
 * records keep both: `hash` (body) and `id` (frame).
 *
 * @module functions/fabricMessageParent
 */

const Hash256 = require('../types/hash256');

/** 32 zero bytes as hex — genesis / no predecessor. */
const ZERO_PARENT = '00'.repeat(32);

/**
 * @param {*} value
 * @returns {boolean}
 */
function isZeroParent (value) {
  try {
    return normalizeParentHex(value) === ZERO_PARENT;
  } catch (_) {
    return false;
  }
}

/**
 * Normalize a parent pointer to lowercase 64-hex.
 * `null` / `undefined` / `''` → genesis zeros. A Message-like object uses
 * {@link Message#id} (must already be signed for a stable id).
 * @param {*} value hex, Buffer, Message, or `{ id: hex64 }`
 * @returns {string}
 */
function normalizeParentHex (value) {
  if (value == null || value === '') return ZERO_PARENT;
  if (typeof value === 'object' && !Buffer.isBuffer(value) && !(value instanceof Uint8Array)) {
    if (typeof value.id === 'string' && /^[0-9a-f]{64}$/i.test(value.id)) {
      return String(value.id).toLowerCase();
    }
    if (value.raw && Buffer.isBuffer(value.raw.parent) && value.raw.parent.length === 32) {
      return value.raw.parent.toString('hex');
    }
  }
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    if (value.length !== 32) throw new Error('Message parent must be 32 bytes');
    return Buffer.from(value).toString('hex');
  }
  const s = String(value).trim().toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]{64}$/.test(s)) throw new Error('Message parent must be 32-byte hex');
  return s;
}

/**
 * Header parent hex on a Message or record. Genesis when missing.
 * @param {object} [message]
 * @returns {string}
 */
function parentHexOf (message) {
  if (!message) return ZERO_PARENT;
  if (typeof message.parent === 'string' && /^[0-9a-f]{64}$/i.test(message.parent)) {
    return String(message.parent).toLowerCase();
  }
  const raw = message.raw && message.raw.parent;
  if (Buffer.isBuffer(raw) && raw.length === 32) return raw.toString('hex');
  return ZERO_PARENT;
}

/**
 * SHA-256 of the complete AMP frame (same as {@link Message#id}).
 * @param {object|Buffer} messageOrBuffer
 * @returns {string|null}
 */
function frameIdOf (messageOrBuffer) {
  if (!messageOrBuffer) return null;
  if (Buffer.isBuffer(messageOrBuffer)) return Hash256.digest(messageOrBuffer);
  if (typeof messageOrBuffer.toBuffer === 'function') {
    try {
      return Hash256.digest(messageOrBuffer.toBuffer());
    } catch (_) {
      return null;
    }
  }
  if (typeof messageOrBuffer.id === 'string' && /^[0-9a-f]{64}$/i.test(messageOrBuffer.id)) {
    return String(messageOrBuffer.id).toLowerCase();
  }
  return null;
}

/**
 * Write a 32-byte parent onto `message.raw.parent`.
 * @param {object} message
 * @param {*} parent
 * @returns {object} message
 */
function setMessageParent (message, parent) {
  if (!message || !message.raw) throw new Error('Message required');
  const hex = normalizeParentHex(parent);
  if (!Buffer.isBuffer(message.raw.parent) || message.raw.parent.length !== 32) {
    message.raw.parent = Buffer.alloc(32);
  }
  Buffer.from(hex, 'hex').copy(message.raw.parent);
  return message;
}

module.exports = {
  ZERO_PARENT,
  isZeroParent,
  normalizeParentHex,
  parentHexOf,
  frameIdOf,
  setMessageParent
};
