'use strict';

/**
 * Compatibility surface for AMP Message body field codecs.
 *
 * Canonical implementation lives on {@link Message} (`types/message.js`).
 * This module re-exports the same helpers so existing
 * `require('@fabric/core/functions/messageBodyCodec')` call sites
 * (notably `@fabric/http` JSON bridge) keep working.
 *
 * @module functions/messageBodyCodec
 * @see docs/MESSAGE_BODY.md
 */

const Message = require('../types/message');

module.exports = {
  FIELD_TYPES: Message.FIELD_TYPES,
  MAX_MESSAGE_SIZE: Message.MAX_MESSAGE_SIZE,
  registerBodySchema: Message.registerBodySchema,
  getBodySchema: Message.getBodySchema,
  encodeBody: Message.encodeBody,
  decodeBody: Message.decodeBody,
  SCHEMA_P2P_PING: Message.SCHEMA_P2P_PING,
  SCHEMA_P2P_CHAT: Message.SCHEMA_P2P_CHAT,
  SCHEMA_PROGRAM_RUN: Message.SCHEMA_PROGRAM_RUN
};
