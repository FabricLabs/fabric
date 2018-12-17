/*
  Fabric Core Constants.
  ---
  Author:* Eric Martindale
  Copyright: All Rights Reserved.
 */
'use strict';

const MAGIC_BYTES = 0xC0D3F33D;
const VERSION_NUMBER = 0x01;

const HEADER_SIZE = 48; // 32 + 16 bytes
const MAX_MESSAGE_SIZE = 4096 - HEADER_SIZE;

const BITCOIN_GENESIS = 0x000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f;

module.exports = {
  HEADER_SIZE,
  MAGIC_BYTES,
  MAX_MESSAGE_SIZE,
  VERSION_NUMBER,
  BITCOIN_GENESIS
};
