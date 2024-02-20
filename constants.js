/*
  Fabric Core Constants.
  ---
  Author: Fabric Labs
  Copyright: All Rights Reserved.
 */
'use strict';

// Networking and Environment
const PEER_PORT = 7777;
const MAX_PEERS = 32;
const PRECISION = 100;

// Fabric Core
const FABRIC_USER_AGENT = 'Fabric Core 0.1.0 (@fabric/core#v0.1.0-RC1)';
const BITCOIN_NETWORK = 'mainnet';
const BITCOIN_GENESIS = '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f';
const BITCOIN_GENESIS_ROOT = '4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b';
const FABRIC_KEY_DERIVATION_PATH = "m/44'/7777'/0'/0/0";
const FIXTURE_SEED = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const FIXTURE_XPUB = 'xpub661MyMwAqRbcF6GygV6Q6XAg8dqhPvDuhYHGniequi6HMbYhNNH5XC13Np3qRANHVD2mmnNGtMGBfDT69s2ovpHLr7q8syoAuyWqtRGEsYQ';
const FIXTURE_XPRV = 'xprv9s21ZrQH143K2cCWaTZPjPDwac1CzTW4LKMfzLFEMNZJUoDYppxpyPgZXY7CZkjefGJTrTyqKnMrM4RG6nGn7Q9cwjHggCtn3CdFGJahaWY';

// Message Constants
const MAGIC_BYTES = 0xC0D3F33D;
const VERSION_NUMBER = 0x01; // 0 for development, pre-alpha, 1 for production
const HEADER_SIZE = 176; // [4], [4], [32], [32], [4], [4], [32], [64] bytes
const LARGE_COLLECTION_SIZE = 10; // TODO: test with 1,000,000
const MAX_MESSAGE_SIZE = 4096 - HEADER_SIZE;

// Stacks and Frames
const MAX_STACK_HEIGHT = 32; // max height of stack (number of elements)
const MAX_FRAME_SIZE = 32; // max size of a stack frame in bytes
const MAX_MEMORY_ALLOC = MAX_STACK_HEIGHT * MAX_FRAME_SIZE;
const MAX_TX_PER_BLOCK = 4;
const MAX_CHANNEL_VALUE = 100000000;

// Machine Constraints
const MACHINE_MAX_MEMORY = MAX_MEMORY_ALLOC * MAX_MESSAGE_SIZE;
const MAX_CHAT_MESSAGE_LENGTH = 2048;

// Playnet
const FABRIC_PLAYNET_ADDRESS = ''; // deposit address (P2TR)
const FABRIC_PLAYNET_ORIGIN = ''; // block hash of first deploy

// FABRIC ONLY
const GENERIC_MESSAGE_TYPE = 15103;
const LOG_MESSAGE_TYPE = 3235156080;
const GENERIC_LIST_TYPE = 3235170158;
const DOCUMENT_PUBLISH_TYPE = 998;
const DOCUMENT_REQUEST_TYPE = 999;

// Opcodes
const OP_CYCLE = '00';
const OP_DONE = 'ff';

// Bitcoin
const OP_0 = '00';
const OP_36 = '24';
const OP_CHECKSIG = 'ac';
const OP_DUP = '76';
const OP_EQUAL = '87';
const OP_SHA256 = 'a8';
const OP_HASH160 = 'a9';
const OP_PUSHDATA1 = '4c';
const OP_RETURN = '6a';
const OP_EQUALVERIFY = '88';
const OP_SEPARATOR = 'ab';

// Peering
const P2P_PORT = 7777;
const P2P_GENERIC = 0x80; // 128 in decimal
const P2P_IDENT_REQUEST = 0x01; // 1, or the identity
const P2P_IDENT_RESPONSE = 0x11;
const P2P_ROOT = 0x00000000;
const P2P_PING = 0x00000012; // same ID as Lightning (18)
const P2P_PONG = 0x00000013; // same ID as Lightning (19)
const P2P_INSTRUCTION = 0x00000020; // TODO: select w/ no overlap
const P2P_START_CHAIN = 0x00000021;
const P2P_STATE_REQUEST = 0x00000029; // TODO: select w/ no overlap
const P2P_STATE_ROOT = 0x00000030; // TODO: select w/ no overlap
const P2P_BASE_MESSAGE = 0x00000031; // TODO: select w/ no overlap
const P2P_STATE_COMMITTMENT = 0x00000032; // TODO: select w/ no overlap
const P2P_STATE_CHANGE = 0x00000033; // TODO: select w/ no overlap
const P2P_TRANSACTION = 0x00000039; // TODO: select w/ no overlap
const P2P_CALL = 0x00000042;
const P2P_CHAIN_SYNC_REQUEST = 0x55;
const P2P_SESSION_ACK = 0x4200;
const P2P_MUSIG_START = 0x4220;
const P2P_MUSIG_ACCEPT = 0x4221;
const P2P_MUSIG_RECEIVE_COUNTER = 0x4222;
const P2P_MUSIG_SEND_PROPOSAL = 0x4223;
const P2P_MUSIG_REPLY_TO_PROPOSAL = 0x4224;
const P2P_MUSIG_ACCEPT_PROPOSAL = 0x4225;

const PEER_CANDIDATE = 0x09;
// TODO: should be 0x02 for Bitcoin P2P
const BLOCK_CANDIDATE = 0x03;

const SESSION_START = 0x02;
const CHAT_MESSAGE = 0x67;

// Lightning
const LIGHTNING_TEST_HEADER = 'D0520C6E';
const LIGHTNING_PROTOCOL_H_INIT = 'Noise_XK_secp256k1_ChaChaPoly_SHA256';
const LIGHTNING_PROTOCOL_PROLOGUE = 'lightning';

// Lightning BMM
const LIGHTNING_BMM_HEADER = 'D0520C6E';
const LIGHTNING_SIDECHAIN_NUM = 0xFF; // 1-byte - sidechain number

const LIGHTNING_SIDEBLOCK_HASH = 0x000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000; // 32-bytes
const LIGHTNING_PARENT_SIDEBLOCK_HASH = 0x000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001; // 32-bytes

const ZERO_LENGTH_PLAINTEXT = '';

// HTTP
const HTTP_HEADER_CONTENT_TYPE = 'application/json';

// CommonJS Support
module.exports = {
  PEER_PORT,
  MAX_PEERS,
  PRECISION,
  BITCOIN_NETWORK,
  BITCOIN_GENESIS,
  BITCOIN_GENESIS_ROOT,
  FABRIC_KEY_DERIVATION_PATH,
  FABRIC_USER_AGENT,
  FIXTURE_SEED,
  FIXTURE_XPUB,
  FIXTURE_XPRV,
  HEADER_SIZE,
  GENERIC_MESSAGE_TYPE,
  LOG_MESSAGE_TYPE,
  GENERIC_LIST_TYPE,
  LARGE_COLLECTION_SIZE,
  BLOCK_CANDIDATE,
  CHAT_MESSAGE,
  ZERO_LENGTH_PLAINTEXT,
  FABRIC_PLAYNET_ADDRESS,
  FABRIC_PLAYNET_ORIGIN,
  LIGHTNING_TEST_HEADER,
  LIGHTNING_PROTOCOL_H_INIT,
  LIGHTNING_PROTOCOL_PROLOGUE,
  LIGHTNING_BMM_HEADER,
  LIGHTNING_SIDECHAIN_NUM,
  LIGHTNING_SIDEBLOCK_HASH,
  LIGHTNING_PARENT_SIDEBLOCK_HASH,
  HTTP_HEADER_CONTENT_TYPE,
  MAGIC_BYTES,
  MAX_FRAME_SIZE,
  MAX_MEMORY_ALLOC,
  MAX_MESSAGE_SIZE,
  MAX_STACK_HEIGHT,
  MAX_CHANNEL_VALUE,
  MAX_CHAT_MESSAGE_LENGTH,
  MAX_TX_PER_BLOCK,
  MACHINE_MAX_MEMORY,
  OP_CYCLE,
  OP_DONE,
  OP_0,
  OP_36,
  OP_CHECKSIG,
  OP_DUP,
  OP_EQUAL,
  OP_SHA256,
  OP_HASH160,
  OP_PUSHDATA1,
  OP_RETURN,
  OP_EQUALVERIFY,
  OP_SEPARATOR,
  P2P_GENERIC,
  P2P_IDENT_REQUEST,
  P2P_IDENT_RESPONSE,
  P2P_CHAIN_SYNC_REQUEST,
  P2P_ROOT,
  P2P_PING,
  P2P_PONG,
  P2P_PORT,
  P2P_START_CHAIN,
  P2P_INSTRUCTION,
  P2P_BASE_MESSAGE,
  P2P_STATE_ROOT,
  P2P_STATE_COMMITTMENT,
  P2P_STATE_CHANGE,
  P2P_STATE_REQUEST,
  P2P_TRANSACTION,
  P2P_CALL,
  P2P_SESSION_ACK,
  P2P_MUSIG_START,
  P2P_MUSIG_ACCEPT,
  P2P_MUSIG_RECEIVE_COUNTER,
  P2P_MUSIG_SEND_PROPOSAL,
  P2P_MUSIG_REPLY_TO_PROPOSAL,
  P2P_MUSIG_ACCEPT_PROPOSAL,
  PEER_CANDIDATE,
  DOCUMENT_PUBLISH_TYPE,
  DOCUMENT_REQUEST_TYPE,
  SESSION_START,
  VERSION_NUMBER
};
