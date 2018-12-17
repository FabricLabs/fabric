/*
  Fabric Core Constants.
  ---
  Author:* Eric Martindale
  Copyright: All Rights Reserved.
 */
'use strict';

const MAGIC_BYTES = 0xC0D3F33D;
const VERSION_NUMBER = 0x01;
const BITCOIN_GENESIS = 0x000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f;

const HEADER_SIZE = 48; // 32 + 16 bytes
const MAX_MESSAGE_SIZE = 4096 - HEADER_SIZE;

const MAX_STACK_HEIGHT = 32; // max height of stack (number of elements)
const MAX_FRAME_SIZE = 32; // max size of a stack frame in bytes
const MAX_MEMORY_ALLOC = MAX_STACK_HEIGHT * MAX_FRAME_SIZE;

module.exports = {
  BITCOIN_GENESIS,
  HEADER_SIZE,
  MAGIC_BYTES,
  MAX_FRAME_SIZE,
  MAX_MEMORY_ALLOC,
  MAX_MESSAGE_SIZE,
  MAX_STACK_HEIGHT,
  VERSION_NUMBER
};
