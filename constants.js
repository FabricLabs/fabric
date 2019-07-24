/*
  Fabric Core Constants.
  ---
  Author:* Eric Martindale
  Copyright: All Rights Reserved.
 */
'use strict';

const MAX_PEERS = 32;

const MAGIC_BYTES = 0xC0D3F33D;
const VERSION_NUMBER = 0x01;
const BITCOIN_GENESIS = 0x000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f;

const HEADER_SIZE = 48; // 32 + 16 bytes
const LARGE_COLLECTION_SIZE = 10; // TODO: test with 1,000,000
const MAX_MESSAGE_SIZE = 4096 - HEADER_SIZE;

const MAX_STACK_HEIGHT = 32; // max height of stack (number of elements)
const MAX_FRAME_SIZE = 32; // max size of a stack frame in bytes
const MAX_MEMORY_ALLOC = MAX_STACK_HEIGHT * MAX_FRAME_SIZE;

// FABRIC ONLY
const OP_DONE = 'ff';

// Bitcoin
const OP_0 = '00';
const OP_CHECKSIG = 'ac';
const OP_DUP = '76';
const OP_EQUAL = '87';
const OP_SHA256 = 'a8';
const OP_HASH160 = 'a9';
const OP_PUSHDATA1 = '4c';
const OP_RETURN = '6a';
const OP_EQUALVERIFY = '88';
const OP_SEPARATOR = 'ab';

module.exports = {
  MAX_PEERS,
  BITCOIN_GENESIS,
  HEADER_SIZE,
  LARGE_COLLECTION_SIZE,
  MAGIC_BYTES,
  MAX_FRAME_SIZE,
  MAX_MEMORY_ALLOC,
  MAX_MESSAGE_SIZE,
  MAX_STACK_HEIGHT,
  OP_DONE,
  OP_0,
  OP_CHECKSIG,
  OP_DUP,
  OP_EQUAL,
  OP_SHA256,
  OP_HASH160,
  OP_PUSHDATA1,
  OP_RETURN,
  OP_EQUALVERIFY,
  OP_SEPARATOR,
  VERSION_NUMBER
};
