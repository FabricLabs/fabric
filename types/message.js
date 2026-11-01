'use strict';

const {
  MAGIC_BYTES,
  VERSION_NUMBER,
  HEADER_SIZE,
  MAX_MESSAGE_SIZE,
  MAX_FRAME_BYTES,
  OP_CYCLE,
  LOG_MESSAGE_TYPE,
  GENERIC_LIST_TYPE,
  GENERIC_MESSAGE_TYPE,
  BITCOIN_BLOCK_TYPE,
  BITCOIN_BLOCK_HASH_TYPE,
  BITCOIN_TRANSACTION_TYPE,
  BITCOIN_TRANSACTION_HASH_TYPE,
  P2P_GENERIC,
  P2P_IDENT_REQUEST,
  P2P_IDENT_RESPONSE,
  P2P_PING,
  P2P_PONG,
  P2P_START_CHAIN,
  P2P_INSTRUCTION,
  P2P_BASE_MESSAGE,
  P2P_CHAIN_SYNC_REQUEST,
  P2P_FLUSH_CHAIN,
  P2P_INVENTORY_REQUEST,
  P2P_INVENTORY_RESPONSE,
  P2P_FILE_SEND,
  P2P_DOCUMENT_PUBLISH,
  P2P_PEER_ALIAS,
  P2P_PEER_ANNOUNCE,
  P2P_PEER_GOSSIP,
  P2P_PEERING_OFFER,
  P2P_DOCUMENT_BID,
  P2P_DOCUMENT_ASK,
  P2P_SESSION_OFFER,
  P2P_SESSION_OPEN,
  P2P_SESSION_ACK,
  P2P_MUSIG_START,
  P2P_MUSIG_ACCEPT,
  P2P_MUSIG_RECEIVE_COUNTER,
  P2P_MUSIG_SEND_PROPOSAL,
  P2P_MUSIG_REPLY_TO_PROPOSAL,
  P2P_MUSIG_ACCEPT_PROPOSAL,
  PASSPORT_CHALLENGE,
  PASSPORT_ASSERTION,
  PASSPORT_SIGN_REQUEST,
  DELEGATION_LINK_OFFER,
  DELEGATION_LINK_ANSWER,
  DELEGATION_LINK_REVEAL,
  DELEGATION_GRANT,
  DELEGATION_REVOKE,
  DELEGATION_REQUEST,
  DELEGATION_RESULT,
  DELEGATION_MAILBOX_FETCH,
  P2P_CONTRACT_PUBLISH,
  P2P_CONTRACT_MESSAGE,
  P2P_STATE_ROOT,
  P2P_STATE_COMMITTMENT,
  P2P_STATE_CHANGE,
  P2P_STATE_REQUEST,
  P2P_TRANSACTION,
  P2P_CALL,
  P2P_RELAY,
  P2P_MESSAGE_RECEIPT,
  P2P_FORWARD,
  CHAT_MESSAGE,
  P2P_CHAT_MESSAGE,
  SIDECHAIN_STATE_PATCH_TYPE,
  DOCUMENT_PUBLISH_TYPE,
  DOCUMENT_REQUEST_TYPE,
  JSON_CALL_TYPE,
  PATCH_MESSAGE_TYPE,
  CONTRACT_PROPOSAL_TYPE,
  BLOCK_CANDIDATE,
  PEER_CANDIDATE,
  SESSION_START,
  // Lightning message codes
  LIGHTNING_WARNING,
  LIGHTNING_INIT,
  LIGHTNING_ERROR,
  LIGHTNING_PING,
  LIGHTNING_PONG,
  LIGHTNING_OPEN_CHANNEL,
  LIGHTNING_ACCEPT_CHANNEL,
  LIGHTNING_FUNDING_CREATED,
  LIGHTNING_FUNDING_SIGNED,
  LIGHTNING_CHANNEL_READY,
  LIGHTNING_SHUTDOWN,
  LIGHTNING_CLOSING_SIGNED,
  LIGHTNING_UPDATE_ADD_HTLC,
  LIGHTNING_UPDATE_FULFILL_HTLC,
  LIGHTNING_UPDATE_FAIL_HTLC,
  LIGHTNING_COMMITMENT_SIGNED,
  LIGHTNING_REVOKE_AND_ACK,
  LIGHTNING_CHANNEL_ANNOUNCEMENT,
  LIGHTNING_NODE_ANNOUNCEMENT,
  LIGHTNING_CHANNEL_UPDATE,
  GOSSIP_MAX_HOPS,
  PEERING_OFFER_MAX_HOPS
} = require('../constants');

const { tryParseWireJson } = require('../functions/wireJson');
const { fabricCanonicalJson, jsonSafe } = require('../functions/fabricCanonicalJson');

/**
 * @private
 * @param {Buffer} buf
 */
function isAllZero32 (buf) {
  if (!buf || buf.length !== 32) return true;
  return buf.equals(Buffer.alloc(32));
}

// Dependencies
// const crypto = require('crypto');
const struct = require('struct');

// Fabric Types
const Actor = require('./actor');
const Hash256 = require('./hash256');

// Function Definitions
const { schnorr } = require('@noble/curves/secp256k1.js');
const taggedHash = Hash256.tagged;

/**
 * Byte ranges `[start, end)` of each AMP header field.
 * @private
 */
const HEADER_OFFSETS = Object.freeze({
  magic: Object.freeze([0, 4]),
  version: Object.freeze([4, 8]),
  parent: Object.freeze([8, 40]),
  author: Object.freeze([40, 72]),
  type: Object.freeze([72, 76]),
  size: Object.freeze([76, 80]),
  hash: Object.freeze([80, 112]),
  preimage: Object.freeze([112, 144]),
  signature: Object.freeze([144, HEADER_SIZE])
});

/**
 * 32 zero bytes as hex: the genesis parent (no predecessor).
 * @private
 */
const ZERO_PARENT = '00'.repeat(32);

/**
 * Left-pad `number` with zeros to `digits` characters.
 * @private
 * @param {number|string} number
 * @param {number} digits
 * @returns {string}
 */
function padDigits (number, digits) {
  return Array(Math.max(digits - String(number).length + 1, 0)).join(0) + number;
}

/**
 * Normalize a parent pointer to lowercase 64-hex. `null` / `undefined` / `''`
 * is genesis. A Message-like object uses its `id` (sign it first for a stable id).
 * @private
 * @param {*} value hex, Buffer, Message, or `{ id: hex64 }`
 * @returns {string}
 */
function normalizeParent (value) {
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
 * @private
 * @param {*} value
 * @returns {boolean}
 */
function isZeroParent (value) {
  try {
    return normalizeParent(value) === ZERO_PARENT;
  } catch (_) {
    return false;
  }
}

/**
 * Header parent hex on a Message or record; genesis when missing.
 * @private
 * @param {Object} [message]
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
 * @private
 * @param {Object|Buffer} messageOrBuffer
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
 * @private
 * @param {Object} message
 * @param {*} parent
 * @returns {Object} message
 */
function setMessageParent (message, parent) {
  if (!message || !message.raw) throw new Error('Message required');
  const hex = normalizeParent(parent);
  if (!Buffer.isBuffer(message.raw.parent) || message.raw.parent.length !== 32) {
    message.raw.parent = Buffer.alloc(32);
  }
  Buffer.from(hex, 'hex').copy(message.raw.parent);
  return message;
}

/**
 * Parse and verify a raw AMP frame without a {@link Key}: who signed it, and
 * what the body was. Fraud proofs carry the exact bytes a counterparty sent.
 * @private
 * @param {Buffer|string} frame raw bytes or hex
 * @returns {{ ok: boolean, reason: string, author: string, type: number, body: Buffer, hash: string, parent: string }} `reason` on failure; the rest on success (`author` is the x-only hex pubkey)
 */
function verifyFrameAuthor (frame) {
  let buffer;
  try {
    buffer = Buffer.isBuffer(frame) ? frame : Buffer.from(String(frame || '').trim(), 'hex');
  } catch (_) {
    return { ok: false, reason: 'frame is not hex' };
  }
  if (buffer.length < HEADER_SIZE) return { ok: false, reason: 'frame shorter than an AMP header' };
  const magic = buffer.readUInt32BE(HEADER_OFFSETS.magic[0]);
  if (magic !== MAGIC_BYTES) return { ok: false, reason: 'bad magic' };
  const size = buffer.readUInt32BE(HEADER_OFFSETS.size[0]);
  const body = buffer.subarray(HEADER_SIZE);
  if (body.length !== size) return { ok: false, reason: 'body length does not match header size' };
  const author = buffer.subarray(...HEADER_OFFSETS.author);
  const signature = buffer.subarray(...HEADER_OFFSETS.signature);
  if (author.equals(Buffer.alloc(32))) return { ok: false, reason: 'frame is unsigned (zero author)' };
  const headerForHash = Buffer.concat([
    buffer.subarray(HEADER_OFFSETS.magic[0], HEADER_OFFSETS.signature[0]),
    Buffer.alloc(64)
  ]);
  const digest = taggedHash('Fabric/Message', Buffer.concat([headerForHash, body]));
  let ok = false;
  try { ok = schnorr.verify(signature, digest, author); } catch (_) { ok = false; }
  if (!ok) return { ok: false, reason: 'frame signature invalid' };
  return {
    ok: true,
    author: author.toString('hex'),
    type: buffer.readUInt32BE(HEADER_OFFSETS.type[0]),
    body,
    hash: buffer.subarray(...HEADER_OFFSETS.hash).toString('hex'),
    parent: buffer.subarray(...HEADER_OFFSETS.parent).toString('hex')
  };
}

/**
 * Header fields of `buffer` as views (no copies).
 * @private
 * @param {Buffer} buffer
 * @returns {Object}
 */
function headerFields (buffer) {
  const out = {};
  for (const [name, range] of Object.entries(HEADER_OFFSETS)) out[name] = buffer.subarray(...range);
  return out;
}

/**
 * **Two parallel type names:**
 * - **Wire** (`wireType`, {@link Message#type}): SCREAMING_SNAKE_CASE strings from opcode
 *   decode (`fromBuffer`, `toVector` first element). Matches AMP / `constants.js` style.
 * - **Friendly** ({@link Message#friendlyType}, `toObject().type`): PascalCase (or historical
 *   labels) for JSON and human-facing APIs — see {@link Message.FRIENDLY_TYPE_BY_WIRE}.
 *
 * Encode accepts **either** name via merged {@link Message#types} (canonical wire + legacy friendly).
 * {@link Message.wireTypeFromFriendly} / {@link Message.friendlyTypeFromWire} convert between them.
 *
 * Each opcode appears once in {@link Message.WIRE_TYPE_DECODE_ORDER} (Fabric low numbers,
 * Lightning in <code>0x2000–0x2FFF</code>). Duplicate opcodes fail at module load.
 * Those maps are **not** global exports: use {@link Message} statics `WIRE_TYPE_DECODE_ORDER` and
 * `FRIENDLY_TYPE_BY_WIRE`.
 */
/** @private */
const WIRE_TYPE_DECODE_ORDER = Object.freeze([
  [BITCOIN_BLOCK_TYPE, 'BITCOIN_BLOCK'],
  [BITCOIN_BLOCK_HASH_TYPE, 'BITCOIN_BLOCK_HASH'],
  [BITCOIN_TRANSACTION_TYPE, 'BITCOIN_TRANSACTION'],
  [BITCOIN_TRANSACTION_HASH_TYPE, 'BITCOIN_TRANSACTION_HASH'],
  [LOG_MESSAGE_TYPE, 'LOG_MESSAGE'],
  [GENERIC_LIST_TYPE, 'GENERIC_LIST'],
  [GENERIC_MESSAGE_TYPE, 'GENERIC_MESSAGE'],
  [SIDECHAIN_STATE_PATCH_TYPE, 'SIDECHAIN_STATE_PATCH'],
  [DOCUMENT_PUBLISH_TYPE, 'DOCUMENT_PUBLISH'],
  [DOCUMENT_REQUEST_TYPE, 'DOCUMENT_REQUEST'],
  [BLOCK_CANDIDATE, 'BLOCK_CANDIDATE'],
  [P2P_PING, 'P2P_PING'],
  [P2P_PONG, 'P2P_PONG'],
  [P2P_GENERIC, 'P2P_GENERIC'],
  [P2P_CHAIN_SYNC_REQUEST, 'P2P_CHAIN_SYNC_REQUEST'],
  [P2P_FLUSH_CHAIN, 'P2P_FLUSH_CHAIN'],
  [P2P_INVENTORY_REQUEST, 'P2P_INVENTORY_REQUEST'],
  [P2P_INVENTORY_RESPONSE, 'P2P_INVENTORY_RESPONSE'],
  [P2P_FILE_SEND, 'P2P_FILE_SEND'],
  [P2P_DOCUMENT_PUBLISH, 'P2P_DOCUMENT_PUBLISH'],
  [P2P_PEER_ALIAS, 'P2P_PEER_ALIAS'],
  [P2P_PEER_ANNOUNCE, 'P2P_PEER_ANNOUNCE'],
  [P2P_PEER_GOSSIP, 'P2P_PEER_GOSSIP'],
  [P2P_PEERING_OFFER, 'P2P_PEERING_OFFER'],
  [P2P_DOCUMENT_BID, 'P2P_DOCUMENT_BID'],
  [P2P_DOCUMENT_ASK, 'P2P_DOCUMENT_ASK'],
  [P2P_SESSION_OFFER, 'P2P_SESSION_OFFER'],
  [P2P_SESSION_OPEN, 'P2P_SESSION_OPEN'],
  [P2P_SESSION_ACK, 'P2P_SESSION_ACK'],
  [P2P_MUSIG_START, 'P2P_MUSIG_START'],
  [P2P_MUSIG_ACCEPT, 'P2P_MUSIG_ACCEPT'],
  [P2P_MUSIG_RECEIVE_COUNTER, 'P2P_MUSIG_RECEIVE_COUNTER'],
  [P2P_MUSIG_SEND_PROPOSAL, 'P2P_MUSIG_SEND_PROPOSAL'],
  [P2P_MUSIG_REPLY_TO_PROPOSAL, 'P2P_MUSIG_REPLY_TO_PROPOSAL'],
  [P2P_MUSIG_ACCEPT_PROPOSAL, 'P2P_MUSIG_ACCEPT_PROPOSAL'],
  [PASSPORT_CHALLENGE, 'PASSPORT_CHALLENGE'],
  [PASSPORT_ASSERTION, 'PASSPORT_ASSERTION'],
  [PASSPORT_SIGN_REQUEST, 'PASSPORT_SIGN_REQUEST'],
  [DELEGATION_LINK_OFFER, 'DELEGATION_LINK_OFFER'],
  [DELEGATION_LINK_ANSWER, 'DELEGATION_LINK_ANSWER'],
  [DELEGATION_LINK_REVEAL, 'DELEGATION_LINK_REVEAL'],
  [DELEGATION_GRANT, 'DELEGATION_GRANT'],
  [DELEGATION_REVOKE, 'DELEGATION_REVOKE'],
  [DELEGATION_REQUEST, 'DELEGATION_REQUEST'],
  [DELEGATION_RESULT, 'DELEGATION_RESULT'],
  [DELEGATION_MAILBOX_FETCH, 'DELEGATION_MAILBOX_FETCH'],
  [P2P_CONTRACT_PUBLISH, 'CONTRACT_PUBLISH'],
  [P2P_CONTRACT_MESSAGE, 'CONTRACT_MESSAGE'],
  [P2P_IDENT_REQUEST, 'P2P_IDENT_REQUEST'],
  [P2P_IDENT_RESPONSE, 'P2P_IDENT_RESPONSE'],
  [P2P_BASE_MESSAGE, 'P2P_BASE_MESSAGE'],
  [P2P_STATE_ROOT, 'P2P_STATE_ROOT'],
  [P2P_STATE_COMMITTMENT, 'P2P_STATE_COMMITTMENT'],
  [P2P_STATE_CHANGE, 'P2P_STATE_CHANGE'],
  [P2P_STATE_REQUEST, 'P2P_STATE_REQUEST'],
  [P2P_TRANSACTION, 'P2P_TRANSACTION'],
  [P2P_CALL, 'P2P_CALL'],
  [P2P_RELAY, 'P2P_RELAY'],
  [P2P_MESSAGE_RECEIPT, 'P2P_MESSAGE_RECEIPT'],
  [P2P_FORWARD, 'P2P_FORWARD'],
  [PEER_CANDIDATE, 'PEER_CANDIDATE'],
  [SESSION_START, 'SESSION_START'],
  [CHAT_MESSAGE, 'CHAT_MESSAGE'],
  [P2P_CHAT_MESSAGE, 'P2P_CHAT_MESSAGE'],
  [JSON_CALL_TYPE, 'JSON_CALL'],
  [PATCH_MESSAGE_TYPE, 'JSON_PATCH'],
  [CONTRACT_PROPOSAL_TYPE, 'CONTRACT_PROPOSAL'],
  [P2P_START_CHAIN, 'P2P_START_CHAIN'],
  [P2P_INSTRUCTION, 'P2P_INSTRUCTION'],
  [LIGHTNING_INIT, 'LIGHTNING_INIT'],
  [LIGHTNING_ERROR, 'LIGHTNING_ERROR'],
  [LIGHTNING_OPEN_CHANNEL, 'LIGHTNING_OPEN_CHANNEL'],
  [LIGHTNING_ACCEPT_CHANNEL, 'LIGHTNING_ACCEPT_CHANNEL'],
  [LIGHTNING_FUNDING_CREATED, 'LIGHTNING_FUNDING_CREATED'],
  [LIGHTNING_FUNDING_SIGNED, 'LIGHTNING_FUNDING_SIGNED'],
  [LIGHTNING_CHANNEL_READY, 'LIGHTNING_CHANNEL_READY'],
  [LIGHTNING_SHUTDOWN, 'LIGHTNING_SHUTDOWN'],
  [LIGHTNING_CLOSING_SIGNED, 'LIGHTNING_CLOSING_SIGNED'],
  [LIGHTNING_UPDATE_ADD_HTLC, 'LIGHTNING_UPDATE_ADD_HTLC'],
  [LIGHTNING_UPDATE_FULFILL_HTLC, 'LIGHTNING_UPDATE_FULFILL_HTLC'],
  [LIGHTNING_UPDATE_FAIL_HTLC, 'LIGHTNING_UPDATE_FAIL_HTLC'],
  [LIGHTNING_COMMITMENT_SIGNED, 'LIGHTNING_COMMITMENT_SIGNED'],
  [LIGHTNING_REVOKE_AND_ACK, 'LIGHTNING_REVOKE_AND_ACK'],
  [LIGHTNING_CHANNEL_ANNOUNCEMENT, 'LIGHTNING_CHANNEL_ANNOUNCEMENT'],
  [LIGHTNING_NODE_ANNOUNCEMENT, 'LIGHTNING_NODE_ANNOUNCEMENT'],
  [LIGHTNING_CHANNEL_UPDATE, 'LIGHTNING_CHANNEL_UPDATE'],
  [LIGHTNING_WARNING, 'LIGHTNING_WARNING'],
  [LIGHTNING_PING, 'LIGHTNING_PING'],
  [LIGHTNING_PONG, 'LIGHTNING_PONG']
]);

const CANONICAL_WIRE_TYPE_BY_OPCODE = Object.freeze(
  WIRE_TYPE_DECODE_ORDER.reduce((acc, pair) => {
    const code = pair[0];
    const name = pair[1];
    if (typeof code !== 'number' || !Number.isFinite(code)) return acc;
    if (acc[code] !== undefined) {
      throw new Error(`duplicate AMP opcode ${code}: ${acc[code]} and ${name}`);
    }
    acc[code] = name;
    return acc;
  }, {})
);

const CANONICAL_MESSAGE_TYPE_STRINGS = Object.freeze(
  Object.entries(CANONICAL_WIRE_TYPE_BY_OPCODE).reduce((acc, entry) => {
    const code = Number(entry[0]);
    const name = entry[1];
    acc[name] = code;
    return acc;
  }, {})
);

const LEGACY_MESSAGE_TYPE_ALIASES = Object.freeze({
  BitcoinBlock: BITCOIN_BLOCK_TYPE,
  BitcoinBlockHash: BITCOIN_BLOCK_HASH_TYPE,
  BitcoinTransaction: BITCOIN_TRANSACTION_TYPE,
  BitcoinTransactionHash: BITCOIN_TRANSACTION_HASH_TYPE,
  GenericLogMessage: LOG_MESSAGE_TYPE,
  GenericList: GENERIC_LIST_TYPE,
  GenericQueue: GENERIC_LIST_TYPE,
  // Transitional Hub/browser catch-all (opcode GENERIC_MESSAGE_TYPE / 15103).
  GenericMessage: GENERIC_MESSAGE_TYPE,
  FabricLogMessage: LOG_MESSAGE_TYPE,
  FabricServiceLogMessage: LOG_MESSAGE_TYPE,
  GenericTransferQueue: GENERIC_LIST_TYPE,
  JSONCall: JSON_CALL_TYPE,
  JSONPatch: PATCH_MESSAGE_TYPE,
  ContractProposal: CONTRACT_PROPOSAL_TYPE,
  Generic: P2P_GENERIC,
  Cycle: typeof OP_CYCLE === 'string' ? parseInt(OP_CYCLE, 16) : Number(OP_CYCLE),
  IdentityRequest: P2P_IDENT_REQUEST,
  IdentityResponse: P2P_IDENT_RESPONSE,
  ChainSyncRequest: P2P_CHAIN_SYNC_REQUEST,
  FlushChain: P2P_FLUSH_CHAIN,
  InventoryRequest: P2P_INVENTORY_REQUEST,
  InventoryResponse: P2P_INVENTORY_RESPONSE,
  PeerAlias: P2P_PEER_ALIAS,
  PeerAnnounce: P2P_PEER_ANNOUNCE,
  PeerGossip: P2P_PEER_GOSSIP,
  PeeringOffer: P2P_PEERING_OFFER,
  DocumentBid: P2P_DOCUMENT_BID,
  DocumentAsk: P2P_DOCUMENT_ASK,
  SessionOffer: P2P_SESSION_OFFER,
  SessionOpen: P2P_SESSION_OPEN,
  MusigStart: P2P_MUSIG_START,
  MusigAccept: P2P_MUSIG_ACCEPT,
  MusigReceiveCounter: P2P_MUSIG_RECEIVE_COUNTER,
  MusigSendProposal: P2P_MUSIG_SEND_PROPOSAL,
  MusigReplyToProposal: P2P_MUSIG_REPLY_TO_PROPOSAL,
  MusigAcceptProposal: P2P_MUSIG_ACCEPT_PROPOSAL,
  PassportChallenge: PASSPORT_CHALLENGE,
  PassportAssertion: PASSPORT_ASSERTION,
  DelegationLinkOffer: DELEGATION_LINK_OFFER,
  DelegationLinkAnswer: DELEGATION_LINK_ANSWER,
  DelegationLinkReveal: DELEGATION_LINK_REVEAL,
  DelegationGrant: DELEGATION_GRANT,
  DelegationRevoke: DELEGATION_REVOKE,
  DelegationRequest: DELEGATION_REQUEST,
  DelegationResult: DELEGATION_RESULT,
  DelegationMailboxFetch: DELEGATION_MAILBOX_FETCH,
  FileSend: P2P_FILE_SEND,
  DocumentPricingPublish: P2P_DOCUMENT_PUBLISH,
  Ping: P2P_PING,
  Pong: P2P_PONG,
  DocumentRequest: DOCUMENT_REQUEST_TYPE,
  DocumentPublish: DOCUMENT_PUBLISH_TYPE,
  SidechainStatePatch: SIDECHAIN_STATE_PATCH_TYPE,
  BlockCandidate: BLOCK_CANDIDATE,
  PeerCandidate: PEER_CANDIDATE,
  PeerInstruction: P2P_INSTRUCTION,
  PeerMessage: P2P_BASE_MESSAGE,
  StartSession: SESSION_START,
  ChatMessage: CHAT_MESSAGE,
  StartChain: P2P_START_CHAIN,
  StateRoot: P2P_STATE_ROOT,
  StateCommitment: P2P_STATE_COMMITTMENT,
  StateChange: P2P_STATE_CHANGE,
  StateRequest: P2P_STATE_REQUEST,
  Transaction: P2P_TRANSACTION,
  Call: P2P_CALL,
  LogMessage: LOG_MESSAGE_TYPE,
  LightningWarning: LIGHTNING_WARNING,
  LightningInit: LIGHTNING_INIT,
  LightningError: LIGHTNING_ERROR,
  LightningPing: LIGHTNING_PING,
  LightningPong: LIGHTNING_PONG,
  OpenChannel: LIGHTNING_OPEN_CHANNEL,
  AcceptChannel: LIGHTNING_ACCEPT_CHANNEL,
  FundingCreated: LIGHTNING_FUNDING_CREATED,
  FundingSigned: LIGHTNING_FUNDING_SIGNED,
  ChannelReady: LIGHTNING_CHANNEL_READY,
  Shutdown: LIGHTNING_SHUTDOWN,
  ClosingSigned: LIGHTNING_CLOSING_SIGNED,
  UpdateAddHTLC: LIGHTNING_UPDATE_ADD_HTLC,
  UpdateFulfillHTLC: LIGHTNING_UPDATE_FULFILL_HTLC,
  UpdateFailHTLC: LIGHTNING_UPDATE_FAIL_HTLC,
  CommitmentSigned: LIGHTNING_COMMITMENT_SIGNED,
  RevokeAndAck: LIGHTNING_REVOKE_AND_ACK,
  ChannelAnnouncement: LIGHTNING_CHANNEL_ANNOUNCEMENT,
  NodeAnnouncement: LIGHTNING_NODE_ANNOUNCEMENT,
  ChannelUpdate: LIGHTNING_CHANNEL_UPDATE,
  // P2P_-prefixed contract names encode to the canonical contract opcodes
  // (decode names stay CONTRACT_PUBLISH / CONTRACT_MESSAGE / CONTRACT_PROPOSAL).
  P2P_CONTRACT_PUBLISH: P2P_CONTRACT_PUBLISH,
  P2P_CONTRACT_MESSAGE: P2P_CONTRACT_MESSAGE,
  P2P_CONTRACT_PROPOSAL: CONTRACT_PROPOSAL_TYPE
});

/**
 * Wire-level type strings (ALL_CAPS, opcode decode) ↔ JSON-oriented friendly names (PascalCase
 * where historically used). {@link Message#wireType} / {@link Message#type} use wire names;
 * {@link Message#friendlyType} and {@link Message#toObject} `type` use friendly names.
 */
/** @private */
const FRIENDLY_TYPE_BY_WIRE = Object.freeze((() => {
  const tmp = {};
  for (const friendly of Object.keys(LEGACY_MESSAGE_TYPE_ALIASES)) {
    const code = LEGACY_MESSAGE_TYPE_ALIASES[friendly];
    if (typeof code !== 'number' || !Number.isFinite(code)) continue;
    const wire = CANONICAL_WIRE_TYPE_BY_OPCODE[code];
    if (!wire || tmp[wire] !== undefined) continue;
    tmp[wire] = friendly;
  }
  for (const wire of Object.values(CANONICAL_WIRE_TYPE_BY_OPCODE)) {
    if (tmp[wire] === undefined) tmp[wire] = wire;
  }
  return tmp;
})());

const FRIENDLY_TO_WIRE_TYPE = Object.freeze((() => {
  const tmp = {};
  for (const [wire, friendly] of Object.entries(FRIENDLY_TYPE_BY_WIRE)) {
    if (tmp[friendly] === undefined) tmp[friendly] = wire;
  }
  return tmp;
})());

/**
 * @private
 * @param {string} wire
 * @returns {string}
 */
function friendlyTypeFromWire (wire) {
  const w = String(wire || '').trim();
  return FRIENDLY_TYPE_BY_WIRE[w] || w;
}

/**
 * @private
 * @param {string} friendly
 * @returns {string}
 */
function wireTypeFromFriendly (friendly) {
  const f = String(friendly || '').trim();
  return FRIENDLY_TO_WIRE_TYPE[f] || f;
}

/**
 * Resolve any opcode / wire name / friendly alias to the numeric AMP type code.
 * @private
 * @param {number|string|null|undefined} value
 * @returns {number|null}
 */
function canonicalTypeCode (value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return CANONICAL_WIRE_TYPE_BY_OPCODE[value] !== undefined ? value : null;
  }
  if (typeof value === 'string') {
    const s = value.trim();
    if (!s) return null;
    if (Object.prototype.hasOwnProperty.call(CANONICAL_MESSAGE_TYPE_STRINGS, s)) {
      return CANONICAL_MESSAGE_TYPE_STRINGS[s];
    }
    if (Object.prototype.hasOwnProperty.call(LEGACY_MESSAGE_TYPE_ALIASES, s)) {
      const code = LEGACY_MESSAGE_TYPE_ALIASES[s];
      return (typeof code === 'number' && Number.isFinite(code)) ? code : null;
    }
    if (/^\d+$/.test(s)) {
      const n = Number(s);
      return CANONICAL_WIRE_TYPE_BY_OPCODE[n] !== undefined ? n : null;
    }
  }
  return null;
}

/**
 * Resolve any opcode / wire name / friendly alias to the SCREAMING_SNAKE wire label.
 * @private
 * @param {number|string|null|undefined} value
 * @returns {string|null}
 */
function canonicalTypeName (value) {
  const code = canonicalTypeCode(value);
  if (code != null) return CANONICAL_WIRE_TYPE_BY_OPCODE[code] || null;
  if (typeof value === 'string') {
    const s = value.trim();
    return s || null;
  }
  return null;
}

/**
 * True when two type references name the same AMP opcode (number, wire name, or friendly alias).
 * Unregistered string labels only match via exact trim equality.
 * @private
 * @param {number|string|null|undefined} a
 * @param {number|string|null|undefined} b
 * @returns {boolean}
 */
function typeEquals (a, b) {
  const ca = canonicalTypeCode(a);
  const cb = canonicalTypeCode(b);
  if (ca != null && cb != null) return ca === cb;
  if (typeof a === 'string' && typeof b === 'string') {
    return a.trim() === b.trim();
  }
  return a === b;
}

/**
 * @classdesc <strong>Application Messaging Protocol (AMP)</strong> — binary envelope for what {@link Peer},
 * {@link Service}, and bridges actually exchange. Extends {@link Actor} for construction and state helpers, but on the wire
 * you think in <strong>opcodes</strong>, <strong>headers</strong> (parent, author as x-only pubkey, hash, preimage,
 * 64-byte Schnorr signature), and <strong>payload</strong>.
 *
 * <p><strong>Signing</strong> — {@link Message#signWithKey} / {@link Message#verifyWithKey} use BIP-340 Schnorr on tagged
 * hash <code>Fabric/Message</code> over header (signature field zeroed) + body. This is <strong>not</strong> Bitcoin Signed
 * Message (ECDSA + Core prefix).</p>
 *
 * <p><strong>Type names</strong> — {@link Message#wireType} / {@link Message#type} use SCREAMING_SNAKE wire labels from
 * opcode decode; {@link Message#friendlyType} and {@link Message#toObject}'s <code>type</code> use PascalCase (or legacy)
 * JSON names. {@link Message.wireTypeFromFriendly} / {@link Message.friendlyTypeFromWire} bridge the two. See file header
 * maps (<code>WIRE_TYPE_DECODE_ORDER</code>, <code>LEGACY_MESSAGE_TYPE_ALIASES</code>) when aligning <strong>@fabric/http</strong>
 * or Hub.</p>
 *
 * <p><strong>Body (V1)</strong> — Prefer {@link Message.fromFields} / {@link Message#toFields} with a
 * registered body schema (see body codec helpers on this module). Bodies are C-like typed fields, not JSON;
 * JSON bridging is <strong>@fabric/http</strong>. See <code>docs/MESSAGE_BODY.md</code>.</p>
 *
 * <p><strong>Narrative</strong> — See <strong>DEVELOPERS.md</strong> (<em>Actor and Message</em>) and {@link Actor}
 * <code>@fileoverview</code>; home HTML is generated from DEVELOPERS.md, while this page comes from
 * <code>types/message.js</code>.</p>
 * @class Message
 * @extends Actor
 */
class Message extends Actor {
  /**
   * Build a message from an object. Prefer <code>type</code>/<code>data</code>; <code>@type</code> / <code>@data</code>
   * are accepted for backward compatibility.
   * @param {Object} [input={}] Initial fields: <code>type</code> or <code>@type</code>, <code>data</code> or
   * <code>@data</code>, optional <code>parent</code> (previous {@link Message#id} or 32 zero bytes),
   * <code>signer</code>, <code>sensitive</code>, <code>preimage</code>.
   * @return {Message} Instance ready for {@link Message#asRaw}, {@link Message#signWithKey}, etc.
   */
  constructor (input = {}) {
    super(input);

    this.raw = {
      magic: Buffer.alloc(4),
      version: Buffer.alloc(4),
      parent: Buffer.alloc(32),
      author: Buffer.alloc(32),
      type: Buffer.alloc(4), // TODO: 8, 32
      size: Buffer.alloc(4), // TODO: 8, 32
      hash: Buffer.alloc(32),
      preimage: Buffer.alloc(32),
      signature: Buffer.alloc(64),
      data: null
    };

    this.raw.magic.write(MAGIC_BYTES.toString(16), 'hex');
    this.raw.version.write(padDigits(VERSION_NUMBER.toString(16), 8), 'hex');

    // Use provided signer
    if (input.signer) {
      this.signer = input.signer;
    } else {
      this.signer = null;
    }

    /**
     * When true, keep wire preimage zeroed (no payment secret). Default public
     * messages already use zeros — see {@link Message#preimage} (Lightning-style).
     */
    this._sensitive = !!(input && input.sensitive);
    /** When true, an explicit HTLC / circuit payment preimage was set — do not clobber. */
    this._explicitPreimage = false;

    // Support both @type/@data (deprecated) and type/data (preferred) formats
    const messageType = input.type || input['@type'];
    const messageData = input.data || input['@data'];

    if (messageData && messageType) {
      this.type = messageType;

      if (Buffer.isBuffer(messageData) || messageData instanceof Uint8Array) {
        this.data = Buffer.from(messageData);
      } else if (typeof messageData !== 'string') {
        // Deprecated transitional path: plain objects without an explicit field encode
        // still JSON.stringify. Prefer Message.fromFields(type, fields) for V1 bodies
        // (docs/MESSAGE_BODY.md). Auto field-encode is not applied here to avoid breaking
        // legacy ChatMessage / GenericMessage object payloads.
        this.data = JSON.stringify(messageData);
      } else {
        this.data = messageData;
      }
    }

    if (input.preimage != null) this.preimage = input.preimage;
    if (input.parent != null) this.parent = input.parent;

    // Log HEARTBEAT message creation to track origin
    if (this.type === 'HEARTBEAT' || messageType === 'HEARTBEAT') {
      const hasSignature = input.signature || (this.raw.signature && this.raw.signature.toString('hex') !== '0'.repeat(128));
      const inputSummary = {
        type: input.type || input['@type'],
        hasType: !!(input.type || input['@type']),
        hasData: !!(input.data || input['@data']),
        hasSignature: !!hasSignature,
        inputKeys: Object.keys(input).filter(k => !k.startsWith('_') && k !== 'signer')
      };

      console.log('[FABRIC:MESSAGE]', '⚠️  HEARTBEAT message created:', {
        messageType: this.type || messageType,
        input: inputSummary,
        hasSignature: hasSignature,
        signatureHex: this.raw.signature ? this.raw.signature.toString('hex').substring(0, 16) + '...' : 'none'
      });
      console.trace('[FABRIC:MESSAGE]', 'HEARTBEAT creation stack trace:');
    }

    // Set various properties to be unenumerable
    for (let name of [
      '@input',
      '@entity',
      '_state',
      'config',
      'settings',
      'signer',
      'stack',
      'observer'
    ]) Object.defineProperty(this, name, { enumerable: false });

    return this;
  }

  get author () {
    return this.raw.author.toString('hex');
  }

  /**
   * Previous signed frame id (SHA-256 of that AMP buffer), or 32 zero bytes at genesis.
   * Covered by {@link Message#signWithKey} — set before signing.
   * @returns {string} 64-char hex
   */
  get parent () {
    if (!this.raw || !Buffer.isBuffer(this.raw.parent) || this.raw.parent.length !== 32) {
      return Message.ZERO_PARENT;
    }
    return this.raw.parent.toString('hex');
  }

  set parent (value) {
    setMessageParent(this, value);
  }

  get body () {
    return this.raw.data.toString('utf8');
  }

  get byte () {
    const input = 0 + '';
    const num = Buffer.from(`0x${padDigits(input, 8)}`, 'hex');
    return num;
  }

  get tu16 () {
    return parseInt(0);
  }

  get tu32 () {
    return parseInt(0);
  }

  get tu64 () {
    return parseInt(0);
  }

  get Uint256 () {
    // 256 bits
    return Buffer.from((this.raw && this.raw.hash) ? `0x${padDigits(this.raw.hash, 8)}` : Actor.randomBytes(32));
  }

  set signature (value) {
    if (value instanceof Buffer) value = value.toString('hex');
    this.raw.signature.write(value, 'hex');
  }

  /**
   * Optional 32-byte **payment** preimage on wire (Lightning-style):
   * - **All zeros (default / public):** no HTLC secret; body integrity is only {@link Message#hash}
   *   (double-SHA256(body)). Do **not** put SHA256(body) here — that collides with circuit HTLC chains.
   * - **Non-zero:** explicit payment secret for inventory HTLC / Fabric Circuit hops
   *   (`payment_hash = SHA256(preimage)`), covered by the Schnorr signature.
   * - {@link Message#sensitive} forces zeros and refuses to clobber an explicit secret.
   */
  get preimage () {
    if (!this.raw || !Buffer.isBuffer(this.raw.preimage) || this.raw.preimage.length !== 32) return null;
    if (isAllZero32(this.raw.preimage)) return null;
    return Buffer.from(this.raw.preimage);
  }

  set preimage (value) {
    if (!this.raw.preimage || !Buffer.isBuffer(this.raw.preimage) || this.raw.preimage.length !== 32) {
      this.raw.preimage = Buffer.alloc(32);
    }
    if (value === null || value === undefined) {
      this.raw.preimage.fill(0);
      this._explicitPreimage = false;
      return;
    }
    const buf = Buffer.isBuffer(value) ? value : Buffer.from(value, 'hex');
    if (buf.length !== 32) throw new Error('Message preimage must be 32 bytes');
    buf.copy(this.raw.preimage);
    this._explicitPreimage = !isAllZero32(this.raw.preimage);
  }

  /**
   * Wire bytes of the message.
   * @return {Buffer}
   * @throws {RangeError} When the frame exceeds `MAX_FRAME_BYTES` (no peer would accept it).
   */
  toBuffer () {
    const raw = this.asRaw();
    if (raw.length > MAX_FRAME_BYTES) {
      throw new RangeError(`message frame (${raw.length} bytes) exceeds MAX_FRAME_BYTES (${MAX_FRAME_BYTES})`);
    }
    return raw;
  }

  /**
   * Returns a {@link Buffer} of the complete message.
   * @return {Buffer} Buffer of the encoded {@link Message}.
   */
  asRaw () {
    return Buffer.concat([this.header, this.raw.data]);
  }

  toRaw () {
    return this.asRaw();
  }

  asTypedArray () {
    return new Uint8Array(this.asRaw());
    // TODO: Node 12
    // return new TypedArray(this.asRaw());
  }

  asBlob () {
    return this.asRaw().map(byte => parseInt(byte, 16));
  }

  toObject () {
    return {
      headers: {
        magic: parseInt(`${this.raw.magic.toString('hex')}`, 16),
        version: parseInt(`${this.raw.version.toString('hex')}`, 16),
        parent: this.raw.parent.toString('hex'),
        author: this.raw.author.toString('hex'),
        type: parseInt(`${this.raw.type.toString('hex')}`, 16),
        size: parseInt(`${this.raw.size.toString('hex')}`, 16),
        hash: this.raw.hash.toString('hex'),
        preimage: this.preimage ? this.preimage.toString('hex') : null,
        signature: this.raw.signature.toString('hex'),
      },
      type: this.friendlyType,
      wireType: this.wireType,
      data: this.data
    };
  }

  toVector () {
    const vector = [this.type, this.data];
    if (!Message.isZeroParent(this.parent)) {
      vector.push(this.parent);
    }
    return vector;
  }

  fromObject (input) {
    return new Message(input);
  }

  /**
   * Signs the message using a specific key.
   * Uses BIP-340 Schnorr signatures with tagged hash "Fabric/Message".
   * Signs the complete message (header + body) as per C implementation.
   *
   * @param {Object} key Key object with private key and sign method.
   * @param {String|Buffer} key.private Private key
   * @param {String|Buffer} key.pubkey Public key
   * @param {Function} key.sign Signing function
   * @returns {Message} Signed message.
   * @throws {Error} If attempting to sign without a private key
   */
  signWithKey (key) {
    if (!key) throw new Error('No key provided.');
    if (!key.private) throw new Error('Cannot sign message with public key only.');
    if (!key.sign) throw new Error('Key object must implement sign method');

    // Extract x-only public key (32 bytes) from compressed pubkey (33 bytes)
    // This matches the C implementation which uses secp256k1_xonly_pubkey_serialize
    const compressedPubkey = Buffer.from(key.public.encodeCompressed('hex'), 'hex');
    const xOnlyPubkey = compressedPubkey.slice(1); // Remove prefix byte (first byte)

    // Set author field BEFORE signing so it's included in the signed data
    // Write x-only pubkey to author field (32 bytes = 64 hex chars)
    this.raw.author.write(xOnlyPubkey.toString('hex'), 'hex');

    // Create header with signature field zeroed (as it would be during signing)
    // The C implementation includes the signature field in offsetof(Message, body),
    // but it's zero/uninitialized when signing, so we zero it
    const zeroedSignature = Buffer.alloc(64); // 64 bytes of zeros
    const pre = Buffer.isBuffer(this.raw.preimage)
      ? this.raw.preimage
      : Buffer.from(this.raw.preimage || '', 'hex');
    if (pre.length !== 32) throw new Error('Message preimage must be 32 bytes on wire');
    const headerForHash = Buffer.concat([
      Buffer.from(this.raw.magic, 'hex'),
      Buffer.from(this.raw.version, 'hex'),
      Buffer.from(this.raw.parent, 'hex'),
      Buffer.from(this.raw.author, 'hex'),
      Buffer.from(this.raw.type, 'hex'),
      Buffer.from(this.raw.size, 'hex'),
      Buffer.from(this.raw.hash, 'hex'),
      pre,
      zeroedSignature // Signature field zeroed for hash computation
    ]);

    // Create buffer with header (signature zeroed) + body
    // This matches the C implementation: memcpy(data_buffer, message, offsetof(Message, body))
    const dataBuffer = Buffer.concat([
      headerForHash,
      this.raw.data || Buffer.alloc(0)
    ]);

    // Compute tagged hash with "Fabric/Message" tag (BIP-340)
    // This matches: secp256k1_tagged_sha256(ctx, msghash, "Fabric/Message", data_buffer, data_size)
    const tag = 'Fabric/Message';
    const messageHash = taggedHash(tag, dataBuffer);

    // Sign the tagged hash using BIP-340 Schnorr
    // This matches: secp256k1_schnorrsig_sign32(ctx, signature, msghash, &keypair, NULL)
    // Use signSchnorrHash since we already have a pre-computed hash
    const signature = key.signSchnorrHash(messageHash);

    // Write signature (64 bytes = 128 hex chars)
    this.raw.signature.write(signature.toString('hex'), 'hex');

    return this;
  }

  sign () {
    if (!this.signer) throw new Error('No signer available.');
    if (!this.signer.private) throw new Error('Cannot sign message with public key only.');
    if (!this.signer.sign) throw new Error('Signer must implement sign method');

    return this.signWithKey(this.signer);
  }

  /**
   * Verify a message's signature.
   * @returns {Boolean} `true` if the signature is valid, `false` if not.
   */
  verify () {
    if (!this.header) throw new Error('No header property.');
    if (!this.raw) throw new Error('No raw property.');
    if (!this.signer) throw new Error('No signer available.');
    if (!this.signer.verify) throw new Error('Signer must implement verify method');

    return this.verifyWithKey(this.signer);
  }

  /**
   * Verify a message's signature with a specific key.
   * Uses BIP-340 Schnorr signature verification with tagged hash "Fabric/Message".
   * Verifies the complete message (header + body) as per C implementation.
   *
   * @param {Object} key Key object with verify method.
   * @param {Function} key.verify Verification function
   * @returns {Boolean} `true` if the signature is valid, `false` if not.
   */
  verifyWithKey (key) {
    if (!this.header) throw new Error('No header property.');
    if (!this.raw) throw new Error('No raw property.');
    if (!key) throw new Error('No key provided.');
    if (!key.verify) throw new Error('Key object must implement verify method');

    // Parse x-only pubkey from author field (32 bytes = 64 hex chars)
    // This matches the C implementation which uses secp256k1_xonly_pubkey_parse
    const authorHex = this.raw.author.toString('hex');
    if (authorHex.length !== 64) {
      throw new Error(`Invalid author field length: expected 64 hex chars (32 bytes), got ${authorHex.length}`);
    }
    const xOnlyPubkeyFromAuthor = Buffer.from(authorHex, 'hex');

    // Get x-only pubkey from the provided key for comparison
    // This allows us to verify using the key directly instead of reconstructing
    const compressedPubkeyFromKey = Buffer.from(key.public.encodeCompressed('hex'), 'hex');
    const xOnlyPubkeyFromKey = compressedPubkeyFromKey.slice(1);

    // Verify that the author field matches the key's x-only pubkey
    if (!xOnlyPubkeyFromAuthor.equals(xOnlyPubkeyFromKey)) {
      return false;
    }

    // Create header with signature field zeroed (as it would be during signing)
    // The C implementation includes the signature field in offsetof(Message, body),
    // but it's zero/uninitialized when signing, so we zero it for verification
    const zeroedSignature = Buffer.alloc(64); // 64 bytes of zeros
    const pre = Buffer.isBuffer(this.raw.preimage)
      ? this.raw.preimage
      : Buffer.from(this.raw.preimage || '', 'hex');
    if (pre.length !== 32) throw new Error('Message preimage must be 32 bytes on wire');
    const headerForHash = Buffer.concat([
      Buffer.from(this.raw.magic, 'hex'),
      Buffer.from(this.raw.version, 'hex'),
      Buffer.from(this.raw.parent, 'hex'),
      Buffer.from(this.raw.author, 'hex'),
      Buffer.from(this.raw.type, 'hex'),
      Buffer.from(this.raw.size, 'hex'),
      Buffer.from(this.raw.hash, 'hex'),
      pre,
      zeroedSignature // Signature field zeroed for hash computation
    ]);

    // Create buffer with header (signature zeroed) + body
    // This matches the C implementation: memcpy(data_buffer, message, offsetof(Message, body))
    const dataBuffer = Buffer.concat([
      headerForHash,
      this.raw.data || Buffer.alloc(0)
    ]);

    // Compute tagged hash with "Fabric/Message" tag (BIP-340)
    const tag = 'Fabric/Message';
    const messageHash = taggedHash(tag, dataBuffer);

    // Get signature
    const signature = this.raw.signature;
    const sigBuffer = Buffer.isBuffer(signature) ? signature : Buffer.from(signature.toString('hex'), 'hex');

    // Use the provided key's verifySchnorrHash method directly
    // This avoids needing to reconstruct the key from the author field
    return key.verifySchnorrHash(messageHash, sigBuffer);
  }

  /**
   * Sets the signer for the message.
   * @param {Object} key Key object with pubkey property.
   * @param {String|Buffer} key.pubkey Public key
   * @returns {Message} Instance of the Message with associated signer.
   */
  _setSigner (key) {
    if (!key || !key.pubkey) {
      throw new Error('Key object with pubkey is required');
    }

    this.signer = key;
    return this;
  }

  static parseBuffer (buffer) {
    const message = struct()
      .charsnt('magic', 4, 'hex')
      .charsnt('version', 4, 'hex')
      .charsnt('parent', 32, 'hex')
      .charsnt('author', 32, 'hex')
      .charsnt('type', 4, 'hex')
      .charsnt('size', 4, 'hex')
      .charsnt('hash', 32, 'hex')
      .charsnt('preimage', 32, 'hex')
      .charsnt('signature', 64, 'hex')
      .charsnt('data', buffer.length - HEADER_SIZE);

    message.allocate();
    message._setBuff(buffer);

    return message;
  }

  static parseRawMessage (buffer) {
    const message = headerFields(buffer);

    if (buffer.length >= HEADER_SIZE) {
      message.data = buffer.slice(HEADER_SIZE, buffer.length);
    }

    return message;
  };

  static fromBuffer (buffer) {
    return Message.fromRaw(buffer);
  }

  static fromRaw (input) {
    if (!input) return null;
    // Convert various buffer-like inputs to Buffer
    let buffer;
    if (Buffer.isBuffer(input)) {
      buffer = input;
    } else if (ArrayBuffer.isView(input)) {
      buffer = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
    } else if (input instanceof ArrayBuffer) {
      buffer = Buffer.from(input);
    } else {
      throw new Error('Input must be a buffer or buffer-like object.');
    }

    const message = new Message();
    const payload = buffer.subarray(HEADER_SIZE);
    message.raw = Object.assign(headerFields(buffer), { data: payload });

    // Do not assign `message.data` here: the `data` setter recomputes `raw.hash`
    // (double-SHA256 of the body), which would replace the on-wire hash and break
    // `Peer._handleFabricMessage` body-integrity checks (C parity).
    message._explicitPreimage = !isAllZero32(message.raw.preimage);

    return message;
  }

  static fromVector (vector = ['LogMessage', 'No vector provided.']) {
    const input = {
      type: vector[0],
      data: vector[1]
    };
    if (vector.length > 2 && vector[2] != null) input.parent = vector[2];
    return new Message(input);
  }

  /**
   * Build a Message whose body is encoded from a registered field schema (V1).
   * @param {string|number} type Wire or friendly type name (or opcode).
   * @param {object} [fields={}] Named fields matching the schema.
   * @param {object} [opts={}] Extra Message constructor options (`signer`, `sensitive`, …).
   * @returns {Message}
   */
  static fromFields (type, fields = {}, opts = {}) {
    const schema = getBodySchema(type);
    if (!schema) {
      throw new Error(`Message.fromFields: no body schema registered for type ${type}`);
    }
    return new Message(Object.assign({}, opts, {
      type,
      data: encodeBody(schema, fields)
    }));
  }

  /**
   * Decode body bytes via the registered field schema for this message type.
   * Truncated / malformed peer bodies return {@code null} (protocol violation) instead of throwing.
   * @returns {object|null} Field map, or null if no schema / empty / undecodable body.
   */
  toFields () {
    const opcode = this.raw.type.readUInt32BE(0);
    const schema = getBodySchema(this.type) || getBodySchema(this.wireType) || getBodySchema(opcode);
    if (!schema) return null;
    const buf = Buffer.isBuffer(this.raw.data)
      ? this.raw.data
      : Buffer.from(this.data || '', 'utf8');
    if (!buf.length) return {};
    try {
      return decodeBody(schema, buf);
    } catch (err) {
      if (err && (err.name === 'RangeError' || err instanceof RangeError)) return null;
      throw err;
    }
  }

  /** Raw body Buffer (preferred over UTF-8 `data` getter for binary field bodies). */
  get bodyBuffer () {
    if (Buffer.isBuffer(this.raw.data)) return this.raw.data;
    return Buffer.from(this.data || '', 'utf8');
  }

  /* get [Symbol.toStringTag] () {
    return `<Message | ${JSON.stringify(this.raw)}>`;
  } */

  /**
   * SHA-256 of the complete signed AMP frame. This is what the next message
   * stores in {@link Message#parent} (not header <code>hash</code>, which is
   * only double-SHA256 of the body).
   * @returns {string} 64-char hex
   */
  get id () {
    return Hash256.digest(this.asRaw());
  }

  get types () {
    return Object.assign({}, CANONICAL_MESSAGE_TYPE_STRINGS, LEGACY_MESSAGE_TYPE_ALIASES);
  }

  get codes () {
    return Object.assign({}, CANONICAL_WIRE_TYPE_BY_OPCODE);
  }

  get magic () {
    return this.raw.magic;
  }

  get signature () {
    return parseInt(Buffer.from(this.raw.signature, 'hex'));
  }

  get size () {
    return parseInt(Buffer.from(this.raw.size, 'hex'));
  }

  get version () {
    return parseInt(Buffer.from(this.raw.version));
  }

  get header () {
    if (!Buffer.isBuffer(this.raw.preimage) || this.raw.preimage.length !== 32) {
      throw new Error('Message raw.preimage must be a 32-byte Buffer');
    }
    const parts = [
      Buffer.from(this.raw.magic, 'hex'),
      Buffer.from(this.raw.version, 'hex'),
      Buffer.from(this.raw.parent, 'hex'),
      Buffer.from(this.raw.author, 'hex'),
      Buffer.from(this.raw.type, 'hex'),
      Buffer.from(this.raw.size, 'hex'),
      Buffer.from(this.raw.hash, 'hex'),
      this.raw.preimage,
      Buffer.from(this.raw.signature, 'hex')
    ];

    return Buffer.concat(parts);
  }

  /**
   * AMP wire type string (SCREAMING_SNAKE_CASE / opcode-canonical). Same as {@link Message#type}.
   */
  get wireType () {
    const code = parseInt(this.raw.type.toString('hex'), 16);
    // Strict Protocol V1: unregistered opcodes must NOT alias to P2P_BASE_MESSAGE
    // (that would run generic JSON dispatch / relay paths on hostile type bytes).
    return CANONICAL_WIRE_TYPE_BY_OPCODE[code] || 'UNKNOWN_MESSAGE';
  }

  /**
   * JSON-oriented type label (historical PascalCase aliases). Use in APIs and `toObject().type`.
   */
  get friendlyType () {
    return friendlyTypeFromWire(this.wireType);
  }
}

Object.defineProperty(Message.prototype, 'type', {
  get () {
    return this.wireType;
  },
  set (value) {
    let code = this.types[value];
    // Default to P2P_BASE_MESSAGE for unknown/unregistered names.
    if (!code) {
      this.emit('warning', `Unknown message type: ${value}`);
      // Keep unknown payloads representable on-wire without inventing ad-hoc generic labels.
      tryParseWireJson(typeof this.data === 'string' ? this.data : String(this.data ?? ''));
      code = this.types.P2P_BASE_MESSAGE;
      value = 'P2P_BASE_MESSAGE';
    }

    const padded = padDigits(code.toString(16), 8);
    this['@type'] = value;
    this.raw.type.write(padded, 'hex');
  }
});

Object.defineProperty(Message.prototype, 'data', {
  get () {
    if (!this.raw.data) return '';
    return this.raw.data.toString('utf8');
  },
  set (value) {
    if (!value) value = '';
    const bodyBuf = Buffer.from(value);
    const hexDouble = Hash256.doubleDigest(bodyBuf);
    // Keep `raw.hash` as 32 bytes (double-SHA256 of body); do not assign a string to the buffer slot.
    if (Buffer.isBuffer(this.raw.hash) && this.raw.hash.length === 32) {
      Buffer.from(hexDouble, 'hex').copy(this.raw.hash);
    } else {
      this.raw.hash = Buffer.from(hexDouble, 'hex');
    }
    this.raw.data = bodyBuf;
    this.raw.size.write(padDigits(this.raw.data.byteLength.toString(16), 8), 'hex');
    // Lightning-style: body changes never invent a payment preimage. Public =
    // all-zero unless an explicit HTLC/circuit secret was set (or sensitive clears it).
    if (!Buffer.isBuffer(this.raw.preimage) || this.raw.preimage.length !== 32) {
      this.raw.preimage = Buffer.alloc(32);
    }
    if (this._sensitive || !this._explicitPreimage) {
      this.raw.preimage.fill(0);
      if (this._sensitive) this._explicitPreimage = false;
    }
  }
});

Object.defineProperty(Message.prototype, 'sensitive', {
  get () {
    return !!this._sensitive;
  },
  set (value) {
    this._sensitive = !!value;
    if (!this._sensitive) return;
    // Never leave a payment secret on a sensitive frame; do not invent SHA256(body).
    if (!Buffer.isBuffer(this.raw.preimage) || this.raw.preimage.length !== 32) {
      this.raw.preimage = Buffer.alloc(32);
    }
    this.raw.preimage.fill(0);
    this._explicitPreimage = false;
  }
});

Message.friendlyTypeFromWire = friendlyTypeFromWire;
Message.wireTypeFromFriendly = wireTypeFromFriendly;
Message.canonicalTypeCode = canonicalTypeCode;
Message.canonicalTypeName = canonicalTypeName;
Message.typeEquals = typeEquals;
Message.WIRE_TYPE_DECODE_ORDER = WIRE_TYPE_DECODE_ORDER;
Message.FRIENDLY_TYPE_BY_WIRE = FRIENDLY_TYPE_BY_WIRE;
Message.FRIENDLY_TO_WIRE_TYPE = FRIENDLY_TO_WIRE_TYPE;

// --- AMP body field codec (formerly functions/messageBodyCodec) ---
const BODY_FIELD_TYPES = Object.freeze([
  'u8', 'u16', 'u32', 'u64', 'bytes32', 'bytes', 'string', 'message'
]);
/** @private @type {Map<number|string, Array<{ name: string, type: string }>>} */
const BODY_SCHEMA_BY_KEY = new Map();

function registerBodySchema (opcodeOrName, schema) {
  if (!Array.isArray(schema)) throw new TypeError('schema must be an array');
  for (const f of schema) {
    if (!f || typeof f.name !== 'string' || !BODY_FIELD_TYPES.includes(f.type)) {
      throw new TypeError(`invalid field: ${JSON.stringify(f)}`);
    }
  }
  BODY_SCHEMA_BY_KEY.set(opcodeOrName, schema.slice());
}

function getBodySchema (opcodeOrName) {
  if (opcodeOrName == null) return null;
  if (BODY_SCHEMA_BY_KEY.has(opcodeOrName)) return BODY_SCHEMA_BY_KEY.get(opcodeOrName);
  if (typeof opcodeOrName === 'string') {
    const upper = opcodeOrName.toUpperCase();
    if (BODY_SCHEMA_BY_KEY.has(upper)) return BODY_SCHEMA_BY_KEY.get(upper);
  }
  return null;
}

function _writeU32 (buf, offset, value) {
  buf.writeUInt32BE(value >>> 0, offset);
}

function _readU32 (buf, offset) {
  return buf.readUInt32BE(offset);
}

/**
 * An optional string left empty is not written when every field after it is
 * the same. Older decoders ignore those trailing bytes, so an absent filter
 * does not change the body they already know.
 * @private
 * @param {{ optional?: boolean, type: string }} def
 * @param {*} value
 * @returns {boolean}
 */
function _trailingOptionalStringEmpty (def, value) {
  return !!(def && def.optional && def.type === 'string' && (value == null || value === ''));
}

function encodeBody (schema, fields = {}) {
  if (!Array.isArray(schema)) throw new TypeError('schema required');
  let count = schema.length;
  while (count > 0 && _trailingOptionalStringEmpty(schema[count - 1], fields[schema[count - 1].name])) count -= 1;
  const chunks = [];
  let total = 0;
  for (const def of schema.slice(0, count)) {
    const value = fields[def.name];
    let part;
    switch (def.type) {
      case 'u8': {
        part = Buffer.alloc(1);
        part.writeUInt8(Number(value) || 0, 0);
        break;
      }
      case 'u16': {
        part = Buffer.alloc(2);
        part.writeUInt16BE(Number(value) || 0, 0);
        break;
      }
      case 'u32': {
        part = Buffer.alloc(4);
        _writeU32(part, 0, Number(value) || 0);
        break;
      }
      case 'u64': {
        part = Buffer.alloc(8);
        const n = typeof value === 'bigint' ? value : BigInt(Number(value) || 0);
        part.writeBigUInt64BE(n, 0);
        break;
      }
      case 'bytes32': {
        part = Buffer.alloc(32);
        if (Buffer.isBuffer(value)) {
          value.copy(part, 0, 0, Math.min(32, value.length));
        } else if (typeof value === 'string' && /^[0-9a-fA-F]*$/.test(value)) {
          Buffer.from(value.padStart(64, '0').slice(0, 64), 'hex').copy(part);
        }
        break;
      }
      case 'bytes':
      case 'message': {
        const raw = Buffer.isBuffer(value)
          ? value
          : (value == null ? Buffer.alloc(0) : Buffer.from(String(value), 'utf8'));
        part = Buffer.alloc(4 + raw.length);
        _writeU32(part, 0, raw.length);
        raw.copy(part, 4);
        break;
      }
      case 'string': {
        const raw = Buffer.from(value == null ? '' : String(value), 'utf8');
        part = Buffer.alloc(4 + raw.length);
        _writeU32(part, 0, raw.length);
        raw.copy(part, 4);
        break;
      }
      default:
        throw new TypeError(`unsupported field type: ${def.type}`);
    }
    total += part.length;
    if (total > MAX_MESSAGE_SIZE) {
      throw new RangeError(`message body exceeds MAX_MESSAGE_SIZE (${MAX_MESSAGE_SIZE})`);
    }
    chunks.push(part);
  }
  return Buffer.concat(chunks, total);
}

/**
 * Default for an optional field when the wire body ends before that field.
 * @private
 * @param {{ type: string }} def
 */
function _optionalFieldDefault (def) {
  switch (def.type) {
    case 'string':
      return '';
    case 'bytes':
    case 'message':
      return Buffer.alloc(0);
    case 'bytes32':
      return Buffer.alloc(32);
    case 'u8':
    case 'u16':
    case 'u32':
      return 0;
    case 'u64':
      return 0n;
    default:
      throw new TypeError(`unsupported field type: ${def.type}`);
  }
}

function decodeBody (schema, buffer) {
  if (!Array.isArray(schema)) throw new TypeError('schema required');
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  const out = {};
  let offset = 0;
  for (const def of schema) {
    if (def.optional && offset >= buf.length) {
      out[def.name] = _optionalFieldDefault(def);
      continue;
    }
    if (offset > buf.length) {
      throw new RangeError(`truncated body while reading field ${def.name}`);
    }
    switch (def.type) {
      case 'u8': {
        if (offset + 1 > buf.length) throw new RangeError(`truncated body at ${def.name}`);
        out[def.name] = buf.readUInt8(offset);
        offset += 1;
        break;
      }
      case 'u16': {
        if (offset + 2 > buf.length) throw new RangeError(`truncated body at ${def.name}`);
        out[def.name] = buf.readUInt16BE(offset);
        offset += 2;
        break;
      }
      case 'u32': {
        if (offset + 4 > buf.length) throw new RangeError(`truncated body at ${def.name}`);
        out[def.name] = _readU32(buf, offset);
        offset += 4;
        break;
      }
      case 'u64': {
        if (offset + 8 > buf.length) throw new RangeError(`truncated body at ${def.name}`);
        out[def.name] = buf.readBigUInt64BE(offset);
        offset += 8;
        break;
      }
      case 'bytes32': {
        if (offset + 32 > buf.length) throw new RangeError(`truncated body at ${def.name}`);
        out[def.name] = Buffer.from(buf.subarray(offset, offset + 32));
        offset += 32;
        break;
      }
      case 'bytes':
      case 'message': {
        if (offset + 4 > buf.length) throw new RangeError(`truncated body at ${def.name}`);
        const len = _readU32(buf, offset);
        offset += 4;
        if (offset + len > buf.length) throw new RangeError(`truncated body at ${def.name}`);
        out[def.name] = Buffer.from(buf.subarray(offset, offset + len));
        offset += len;
        break;
      }
      case 'string': {
        if (offset + 4 > buf.length) throw new RangeError(`truncated body at ${def.name}`);
        const len = _readU32(buf, offset);
        offset += 4;
        if (offset + len > buf.length) throw new RangeError(`truncated body at ${def.name}`);
        out[def.name] = buf.subarray(offset, offset + len).toString('utf8');
        offset += len;
        break;
      }
      default:
        throw new TypeError(`unsupported field type: ${def.type}`);
    }
  }
  return out;
}

const SCHEMA_P2P_PING = Object.freeze([{ name: 'nonce', type: 'string' }]);
const SCHEMA_P2P_CHAT = null;
/** @private Transitional field layouts; JSON bodies remain accepted via tryParseMessageBody. */
const SCHEMA_CONTRACT_PUBLISH = Object.freeze([
  { name: 'definition', type: 'string' }
]);
const SCHEMA_CONTRACT_MESSAGE = Object.freeze([
  { name: 'contract', type: 'string' },
  { name: 'payload', type: 'string' },
  // Index fields. The JSON payload is unchanged. Old decoders stop after
  // `payload` and ignore these trailing bytes.
  { name: 'recipient', type: 'string', optional: true },
  { name: 'ref', type: 'string', optional: true },
  { name: 'slot', type: 'string', optional: true }
]);
const SCHEMA_PROGRAM_RUN = Object.freeze([
  { name: 'programHash', type: 'bytes32' },
  { name: 'runCommitment', type: 'bytes32' },
  { name: 'resultHint', type: 'string' }
]);
/** @private Directed onion hop — see {@link module:@fabric/core/functions/fabricOnion}. */
const SCHEMA_P2P_FORWARD = Object.freeze([
  { name: 'nextPeer', type: 'bytes32' },
  { name: 'ttl', type: 'u8' },
  { name: 'inner', type: 'message' }
]);
/**
 * @private Discovery / peering field layouts; JSON bodies remain accepted.
 * Optional fields are appended only — older decoders ignore trailing bytes.
 */
const SCHEMA_P2P_PEER_GOSSIP = Object.freeze([
  { name: 'host', type: 'string' },
  { name: 'port', type: 'u32' },
  { name: 'gossipHop', type: 'u8' },
  { name: 'nonce', type: 'string' },
  { name: 'pubkey', type: 'string', optional: true }
]);
const SCHEMA_P2P_PEERING_OFFER = Object.freeze([
  { name: 'transport', type: 'string' },
  { name: 'host', type: 'string' },
  { name: 'port', type: 'u32' },
  { name: 'peeringHop', type: 'u8' },
  { name: 'pubkey', type: 'string', optional: true },
  { name: 'slots', type: 'u32', optional: true },
  { name: 'peering', type: 'string', optional: true },
  { name: 'nonce', type: 'string', optional: true }
]);
const SCHEMA_P2P_PEER_ANNOUNCE = Object.freeze([
  { name: 'host', type: 'string' },
  { name: 'port', type: 'u32' },
  { name: 'pubkey', type: 'string', optional: true },
  { name: 'nonce', type: 'string', optional: true }
]);
/**
 * @private A buyer's bid for one chunk (see {@link DocumentBook.createBid}).
 * A zero `merkleRoot` / `blobHash` leaves that selector open. Times are Unix seconds.
 */
const SCHEMA_P2P_DOCUMENT_BID = Object.freeze([
  { name: 'document', type: 'string' },
  { name: 'merkleRoot', type: 'bytes32' },
  { name: 'blobIndex', type: 'u32' },
  { name: 'blobHash', type: 'bytes32' },
  { name: 'maxSats', type: 'u64' },
  { name: 'expiresAt', type: 'u64' },
  { name: 'nonce', type: 'bytes32' }
]);
/** @private A seller's answer to one bid (see {@link DocumentBook.createAsk}). */
const SCHEMA_P2P_DOCUMENT_ASK = Object.freeze([
  { name: 'bid', type: 'bytes32' },
  { name: 'document', type: 'string' },
  { name: 'merkleRoot', type: 'bytes32' },
  { name: 'blobIndex', type: 'u32' },
  { name: 'blobHash', type: 'bytes32' },
  { name: 'priceSats', type: 'u64' },
  { name: 'expiresAt', type: 'u64' }
]);
/**
 * @private Statechain patch proposal. `catalogCanonical` is the document-registry
 * shorthand; `patchesCanonical` (RFC6902 JSON array) wins when non-empty.
 */
const SCHEMA_SIDECHAIN_STATE_PATCH = Object.freeze([
  { name: 'basisClock', type: 'u32' },
  { name: 'basisDigest', type: 'bytes32' },
  { name: 'catalogCanonical', type: 'string' },
  { name: 'patchesCanonical', type: 'string', optional: true },
  { name: 'federationWitnessCanonical', type: 'string', optional: true }
]);
/** @private BIP-327 directed MuSig2 session (JSON bodies still accepted). */
const SCHEMA_P2P_MUSIG_START = Object.freeze([
  { name: 'sessionId', type: 'bytes32' },
  { name: 'msg', type: 'bytes' },
  { name: 'pubkeys', type: 'bytes' },
  { name: 'pubnonce', type: 'bytes' },
  { name: 'purpose', type: 'string', optional: true }
]);
const SCHEMA_P2P_MUSIG_PUBNONCE = Object.freeze([
  { name: 'sessionId', type: 'bytes32' },
  { name: 'pubnonce', type: 'bytes' }
]);
const SCHEMA_P2P_MUSIG_AGGNONCE = Object.freeze([
  { name: 'sessionId', type: 'bytes32' },
  { name: 'aggnonce', type: 'bytes' }
]);
const SCHEMA_P2P_MUSIG_PSIG = Object.freeze([
  { name: 'sessionId', type: 'bytes32' },
  { name: 'psig', type: 'bytes' }
]);
const SCHEMA_P2P_MUSIG_SIGNATURE = Object.freeze([
  { name: 'sessionId', type: 'bytes32' },
  { name: 'signature', type: 'bytes' }
]);
/**
 * @private Passport v2 sign-in (`functions/passport.js`). Times are Unix
 * milliseconds; `request` / `disclose` are comma lists of `wallet`, `cosigner`.
 * A challenge may be unsigned (zero author).
 */
const SCHEMA_PASSPORT_CHALLENGE = Object.freeze([
  { name: 'v', type: 'u8' },
  { name: 'origin', type: 'string' },
  { name: 'nonce', type: 'string' },
  { name: 'issuedAt', type: 'u64' },
  { name: 'expiresAt', type: 'u64' },
  { name: 'purpose', type: 'string', optional: true },
  { name: 'network', type: 'string', optional: true },
  { name: 'request', type: 'string', optional: true }
]);
/**
 * @private Signed by the identity; `pubkey` is compressed hex and must match
 * the author. `wallet` / `cosigner` are JSON, present only when requested.
 */
const SCHEMA_PASSPORT_ASSERTION = Object.freeze([
  { name: 'v', type: 'u8' },
  { name: 'origin', type: 'string' },
  { name: 'nonce', type: 'string' },
  { name: 'challengeHash', type: 'bytes32' },
  { name: 'issuedAt', type: 'u64' },
  { name: 'expiresAt', type: 'u64' },
  { name: 'network', type: 'string' },
  { name: 'pubkey', type: 'string' },
  { name: 'identityId', type: 'string' },
  { name: 'signer', type: 'string' },
  { name: 'device', type: 'string', optional: true },
  { name: 'wallet', type: 'string', optional: true },
  { name: 'cosigner', type: 'string', optional: true }
]);
/**
 * @private Delegation (`functions/delegation.js`). Times are Unix
 * milliseconds; every frame is signed by its author. Pairing commits to the
 * initiator's nonce before the responder picks its own.
 */
const SCHEMA_DELEGATION_LINK_OFFER = Object.freeze([
  { name: 'v', type: 'u8' },
  { name: 'pubkey', type: 'string' },
  { name: 'origin', type: 'string' },
  { name: 'label', type: 'string' },
  { name: 'network', type: 'string' },
  { name: 'commitment', type: 'bytes32' },
  { name: 'issuedAt', type: 'u64' },
  { name: 'expiresAt', type: 'u64' }
]);
/** @private `offer` is the sha256 of the offer frame; `pubkey` (compressed, as in the offer) lets the other side grant to it. */
const SCHEMA_DELEGATION_LINK_ANSWER = Object.freeze([
  { name: 'v', type: 'u8' },
  { name: 'pubkey', type: 'string' },
  { name: 'offer', type: 'bytes32' },
  { name: 'nonce', type: 'bytes32' },
  { name: 'label', type: 'string' },
  { name: 'issuedAt', type: 'u64' },
  { name: 'expiresAt', type: 'u64' }
]);
/** @private `answer` is the sha256 of the answer frame; `nonce` opens the offer's commitment. */
const SCHEMA_DELEGATION_LINK_REVEAL = Object.freeze([
  { name: 'v', type: 'u8' },
  { name: 'answer', type: 'bytes32' },
  { name: 'nonce', type: 'bytes32' },
  { name: 'issuedAt', type: 'u64' },
  { name: 'expiresAt', type: 'u64' }
]);
/**
 * @private Lets `grantee` ask the author to sign. Comma lists for `scopes`,
 * `origins`, `networks`; `link` is the reveal hash hex (or empty);
 * `cosigner` / `cosignerProof` disclose the author's BIP87 key.
 */
const SCHEMA_DELEGATION_GRANT = Object.freeze([
  { name: 'v', type: 'u8' },
  { name: 'pubkey', type: 'string' },
  { name: 'grantee', type: 'string' },
  { name: 'link', type: 'string' },
  { name: 'scopes', type: 'string' },
  { name: 'origins', type: 'string' },
  { name: 'networks', type: 'string' },
  { name: 'cosigner', type: 'string' },
  { name: 'cosignerProof', type: 'string' },
  { name: 'extensionOrigin', type: 'string' },
  { name: 'label', type: 'string' },
  { name: 'issuedAt', type: 'u64' }
]);
/** @private `grant` is the sha256 of the grant frame being withdrawn. */
const SCHEMA_DELEGATION_REVOKE = Object.freeze([
  { name: 'v', type: 'u8' },
  { name: 'grant', type: 'bytes32' },
  { name: 'issuedAt', type: 'u64' }
]);
/**
 * @private Ask `target` to sign the embedded `request` frame under its grant
 * `grant` (sha256 of the grant frame). `origin` / `disclose` apply to
 * Passport challenges.
 */
const SCHEMA_DELEGATION_REQUEST = Object.freeze([
  { name: 'v', type: 'u8' },
  { name: 'pubkey', type: 'string' },
  { name: 'target', type: 'string' },
  { name: 'grant', type: 'bytes32' },
  { name: 'nonce', type: 'bytes32' },
  { name: 'request', type: 'message' },
  { name: 'origin', type: 'string' },
  { name: 'account', type: 'u32' },
  { name: 'disclose', type: 'string' },
  { name: 'purpose', type: 'string' },
  { name: 'issuedAt', type: 'u64' },
  { name: 'expiresAt', type: 'u64' }
]);
/** @private Either `answer` (a frame) or `refusal` (text) is set; `rule` names the rule that decided. */
const SCHEMA_DELEGATION_RESULT = Object.freeze([
  { name: 'v', type: 'u8' },
  { name: 'request', type: 'bytes32' },
  { name: 'answer', type: 'message' },
  { name: 'refusal', type: 'string' },
  { name: 'rule', type: 'string' },
  { name: 'issuedAt', type: 'u64' }
]);
/** @private A mailbox read, signed by the key whose mail it is. */
const SCHEMA_DELEGATION_MAILBOX_FETCH = Object.freeze([
  { name: 'v', type: 'u8' },
  { name: 'pubkey', type: 'string' },
  { name: 'since', type: 'u64' },
  { name: 'nonce', type: 'bytes32' },
  { name: 'issuedAt', type: 'u64' },
  { name: 'expiresAt', type: 'u64' }
]);

/** @private Field type for each value kind of a keyed layout. */
const KEYED_FIELD_TYPES = Object.freeze({
  string: 'string',
  u8: 'u8',
  u32: 'u32',
  u64: 'u64',
  bool: 'u8',
  // Length-prefixed, so an absent hash costs 4 bytes rather than 32.
  hex32: 'bytes',
  base64: 'bytes',
  json: 'string'
});

/**
 * @private Set in `present` when the keys were read under `object` of a
 * `{ type, actor, object, … }` envelope (Hub-style senders).
 */
const KEYED_ENVELOPE_FLAG = 0x80000000;

/**
 * Field schema of a keyed layout: `present` (bit i set when key i was
 * written, so 0, '' and false round-trip), one field per key, then `extra`
 * (JSON of every key the layout does not name, or whose value is not of the
 * declared kind). A body any JSON sender writes therefore maps to fields and
 * back without loss. Append keys only; at most 31.
 * @private
 * @param {{ keys: Array<{ path: string, field: string, kind: string }> }} layout
 * @returns {ReadonlyArray<{ name: string, type: string }>}
 */
function keyedSchema (layout) {
  return Object.freeze([{ name: 'present', type: 'u32' }]
    .concat(layout.keys.map((key) => ({ name: key.field, type: KEYED_FIELD_TYPES[key.kind] })))
    .concat([{ name: 'extra', type: 'string' }]));
}

/** @private Session key-exchange claim (`Peer#_buildSessionKeyExchangeClaim`). */
const SESSION_ACTOR_KEYS = [
  { path: 'type', field: 'type', kind: 'string' },
  { path: 'actor.id', field: 'actor', kind: 'string' },
  { path: 'actor.pubkey', field: 'pubkey', kind: 'string' },
  { path: 'actor.parentPubkey', field: 'parentPubkey', kind: 'string' },
  { path: 'actor.parentXpub', field: 'parentXpub', kind: 'string' },
  { path: 'actor.parentSignature', field: 'parentSignature', kind: 'string' }
];

/**
 * @private Legacy JSON layouts of the session, inventory, and document
 * opcodes. Paths are read under `object` when `envelope` is set and the body
 * is an envelope.
 */
const KEYED_LAYOUTS = Object.freeze({
  P2P_SESSION_OFFER: {
    envelope: false,
    keys: SESSION_ACTOR_KEYS.concat([
      { path: 'object.challenge', field: 'challenge', kind: 'string' },
      { path: 'object.maxFrameBytes', field: 'maxFrameBytes', kind: 'u32' }
    ])
  },
  P2P_SESSION_OPEN: {
    envelope: false,
    keys: SESSION_ACTOR_KEYS.concat([
      { path: 'object.initiator', field: 'initiator', kind: 'string' },
      { path: 'object.counterparty', field: 'counterparty', kind: 'string' },
      { path: 'object.solution', field: 'solution', kind: 'string' },
      { path: 'object.maxFrameBytes', field: 'maxFrameBytes', kind: 'u32' }
    ])
  },
  P2P_INVENTORY_REQUEST: {
    envelope: true,
    keys: [
      { path: 'kind', field: 'kind', kind: 'string' },
      { path: 'created', field: 'created', kind: 'u64' },
      { path: 'offerBtc', field: 'offerBtc', kind: 'bool' },
      { path: 'maxSats', field: 'maxSats', kind: 'u64' },
      { path: 'buyerRefundPublicKey', field: 'buyerRefundPublicKey', kind: 'string' },
      { path: 'blobHashHex', field: 'blobHash', kind: 'hex32' },
      { path: 'merkleRootHex', field: 'merkleRoot', kind: 'hex32' },
      { path: 'inventoryRelayTtl', field: 'inventoryRelayTtl', kind: 'u8' },
      { path: 'htlcLocktimeBlocks', field: 'htlcLocktimeBlocks', kind: 'u32' },
      { path: 'htlcAmountSats', field: 'htlcAmountSats', kind: 'u64' }
    ]
  },
  // `items` stays JSON (offer rows nest proofs and leaves); pages are sized by its bytes.
  P2P_INVENTORY_RESPONSE: {
    envelope: true,
    keys: [
      { path: 'kind', field: 'kind', kind: 'string' },
      { path: 'created', field: 'created', kind: 'u64' },
      { path: 'inventoryId', field: 'inventoryId', kind: 'string' },
      { path: 'page', field: 'page', kind: 'u32' },
      { path: 'pages', field: 'pages', kind: 'u32' },
      { path: 'items', field: 'items', kind: 'json' }
    ]
  },
  // Senders write the same hash under `contentHash` and `contentHashHex`.
  P2P_DOCUMENT_PUBLISH: {
    envelope: true,
    keys: [
      { path: 'hash', field: 'hash', kind: 'string' },
      { path: 'rate', field: 'rate', kind: 'u64' },
      { path: 'contentHash', field: 'contentHash', kind: 'hex32' },
      { path: 'contentHashHex', field: 'contentHashHex', kind: 'hex32' },
      { path: 'binding', field: 'binding', kind: 'string' }
    ]
  },
  // The payment binding hashes this frame unsigned, rebuilt from the decoded
  // values (`functions/publishedDocumentEnvelope.js`), never the received bytes.
  DOCUMENT_PUBLISH: {
    envelope: false,
    keys: [
      { path: 'contentBase64', field: 'content', kind: 'base64' },
      { path: 'id', field: 'id', kind: 'string' },
      { path: 'mime', field: 'mime', kind: 'string' },
      { path: 'name', field: 'name', kind: 'string' },
      { path: 'revision', field: 'revision', kind: 'u32' },
      { path: 'sha256', field: 'sha256', kind: 'string' },
      { path: 'size', field: 'size', kind: 'u64' }
    ]
  },
  DOCUMENT_REQUEST: {
    envelope: false,
    keys: [
      { path: 'document', field: 'document', kind: 'string' },
      { path: 'id', field: 'id', kind: 'string' },
      { path: 'maxSats', field: 'maxSats', kind: 'u64' },
      { path: 'relayHop', field: 'relayHop', kind: 'u8' },
      { path: 'routeId', field: 'routeId', kind: 'string' },
      { path: 'blobIndex', field: 'blobIndex', kind: 'u32' },
      { path: 'batchEnd', field: 'batchEnd', kind: 'u32' },
      { path: 'blobTotal', field: 'blobTotal', kind: 'u32' },
      { path: 'quote', field: 'quote', kind: 'bool' },
      { path: 'credit', field: 'credit', kind: 'bool' },
      { path: 'creditRef', field: 'creditRef', kind: 'string' },
      { path: 'contentHashHex', field: 'contentHash', kind: 'hex32' }
    ]
  }
});

/** @private Session handshake offer: the key-exchange claim plus `challenge`. */
const SCHEMA_P2P_SESSION_OFFER = keyedSchema(KEYED_LAYOUTS.P2P_SESSION_OFFER);
/** @private Session handshake answer: the claim plus the solved `challenge`. */
const SCHEMA_P2P_SESSION_OPEN = keyedSchema(KEYED_LAYOUTS.P2P_SESSION_OPEN);
/** @private Document (`kind`) or L1 offer (`offerBtc`) inventory query. */
const SCHEMA_P2P_INVENTORY_REQUEST = keyedSchema(KEYED_LAYOUTS.P2P_INVENTORY_REQUEST);
/** @private One page of an inventory reply. */
const SCHEMA_P2P_INVENTORY_RESPONSE = keyedSchema(KEYED_LAYOUTS.P2P_INVENTORY_RESPONSE);
/** @private A seller's price for one document. */
const SCHEMA_P2P_DOCUMENT_PUBLISH = keyedSchema(KEYED_LAYOUTS.P2P_DOCUMENT_PUBLISH);
/** @private A published document; `content` is the raw bytes of `contentBase64`. */
const SCHEMA_DOCUMENT_PUBLISH = keyedSchema(KEYED_LAYOUTS.DOCUMENT_PUBLISH);
/** @private A request for a document or some of its blobs. */
const SCHEMA_DOCUMENT_REQUEST = keyedSchema(KEYED_LAYOUTS.DOCUMENT_REQUEST);

/**
 * Parse an inbound AMP body: prefer JSON (legacy), else registered field schema.
 * @private
 * @param {Message} message
 * @returns {{ ok: true, value: object, encoding: 'json'|'fields' } | { ok: false, error: Error }}
 */
function tryParseMessageBody (message) {
  if (!message) {
    return { ok: false, error: new TypeError('tryParseMessageBody: message required') };
  }
  const rawStr = typeof message.data === 'string'
    ? message.data
    : (message.data != null ? String(message.data) : '');
  const pr = tryParseWireJson(rawStr);
  if (pr.ok && pr.value !== null && typeof pr.value === 'object' && !Array.isArray(pr.value)) {
    return { ok: true, value: pr.value, encoding: 'json' };
  }
  const schema = getBodySchema(message.type) || getBodySchema(message.wireType);
  const bodyBuf = message.raw && Buffer.isBuffer(message.raw.data)
    ? message.raw.data
    : null;
  if (schema && bodyBuf && bodyBuf.length > 0) {
    try {
      const fields = decodeBody(schema, bodyBuf);
      if (fields && typeof fields === 'object' && !Array.isArray(fields)) {
        return { ok: true, value: fields, encoding: 'fields' };
      }
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      return { ok: false, error: e };
    }
  }
  if (pr.ok) {
    return { ok: false, error: new TypeError('message body must be a JSON object or field layout') };
  }
  return { ok: false, error: pr.error || new Error('unparsed message body') };
}

(function _installBodySchemaDefaults () {
  registerBodySchema(P2P_PING, SCHEMA_P2P_PING);
  registerBodySchema('P2P_PING', SCHEMA_P2P_PING);
  registerBodySchema('Ping', SCHEMA_P2P_PING);
  registerBodySchema(P2P_PONG, SCHEMA_P2P_PING);
  registerBodySchema('P2P_PONG', SCHEMA_P2P_PING);
  registerBodySchema('Pong', SCHEMA_P2P_PING);
  registerBodySchema('FabricProgramRun', SCHEMA_PROGRAM_RUN);
  registerBodySchema(P2P_CONTRACT_PUBLISH, SCHEMA_CONTRACT_PUBLISH);
  registerBodySchema('P2P_CONTRACT_PUBLISH', SCHEMA_CONTRACT_PUBLISH);
  registerBodySchema('CONTRACT_PUBLISH', SCHEMA_CONTRACT_PUBLISH);
  registerBodySchema(P2P_CONTRACT_MESSAGE, SCHEMA_CONTRACT_MESSAGE);
  registerBodySchema('P2P_CONTRACT_MESSAGE', SCHEMA_CONTRACT_MESSAGE);
  registerBodySchema('CONTRACT_MESSAGE', SCHEMA_CONTRACT_MESSAGE);
  registerBodySchema(P2P_FORWARD, SCHEMA_P2P_FORWARD);
  registerBodySchema('P2P_FORWARD', SCHEMA_P2P_FORWARD);
  registerBodySchema(P2P_PEER_GOSSIP, SCHEMA_P2P_PEER_GOSSIP);
  registerBodySchema('P2P_PEER_GOSSIP', SCHEMA_P2P_PEER_GOSSIP);
  registerBodySchema('PeerGossip', SCHEMA_P2P_PEER_GOSSIP);
  registerBodySchema(P2P_PEERING_OFFER, SCHEMA_P2P_PEERING_OFFER);
  registerBodySchema('P2P_PEERING_OFFER', SCHEMA_P2P_PEERING_OFFER);
  registerBodySchema('PeeringOffer', SCHEMA_P2P_PEERING_OFFER);
  registerBodySchema(P2P_PEER_ANNOUNCE, SCHEMA_P2P_PEER_ANNOUNCE);
  registerBodySchema('P2P_PEER_ANNOUNCE', SCHEMA_P2P_PEER_ANNOUNCE);
  registerBodySchema('PeerAnnounce', SCHEMA_P2P_PEER_ANNOUNCE);
  registerBodySchema(P2P_DOCUMENT_BID, SCHEMA_P2P_DOCUMENT_BID);
  registerBodySchema('P2P_DOCUMENT_BID', SCHEMA_P2P_DOCUMENT_BID);
  registerBodySchema('DocumentBid', SCHEMA_P2P_DOCUMENT_BID);
  registerBodySchema(P2P_DOCUMENT_ASK, SCHEMA_P2P_DOCUMENT_ASK);
  registerBodySchema('P2P_DOCUMENT_ASK', SCHEMA_P2P_DOCUMENT_ASK);
  registerBodySchema('DocumentAsk', SCHEMA_P2P_DOCUMENT_ASK);
  registerBodySchema(SIDECHAIN_STATE_PATCH_TYPE, SCHEMA_SIDECHAIN_STATE_PATCH);
  registerBodySchema('SIDECHAIN_STATE_PATCH', SCHEMA_SIDECHAIN_STATE_PATCH);
  registerBodySchema('SidechainStatePatch', SCHEMA_SIDECHAIN_STATE_PATCH);
  registerBodySchema(P2P_MUSIG_START, SCHEMA_P2P_MUSIG_START);
  registerBodySchema('P2P_MUSIG_START', SCHEMA_P2P_MUSIG_START);
  registerBodySchema('MusigStart', SCHEMA_P2P_MUSIG_START);
  registerBodySchema(P2P_MUSIG_ACCEPT, SCHEMA_P2P_MUSIG_PUBNONCE);
  registerBodySchema('P2P_MUSIG_ACCEPT', SCHEMA_P2P_MUSIG_PUBNONCE);
  registerBodySchema('MusigAccept', SCHEMA_P2P_MUSIG_PUBNONCE);
  registerBodySchema(P2P_MUSIG_RECEIVE_COUNTER, SCHEMA_P2P_MUSIG_PUBNONCE);
  registerBodySchema('P2P_MUSIG_RECEIVE_COUNTER', SCHEMA_P2P_MUSIG_PUBNONCE);
  registerBodySchema('MusigReceiveCounter', SCHEMA_P2P_MUSIG_PUBNONCE);
  registerBodySchema(P2P_MUSIG_SEND_PROPOSAL, SCHEMA_P2P_MUSIG_AGGNONCE);
  registerBodySchema('P2P_MUSIG_SEND_PROPOSAL', SCHEMA_P2P_MUSIG_AGGNONCE);
  registerBodySchema('MusigSendProposal', SCHEMA_P2P_MUSIG_AGGNONCE);
  registerBodySchema(P2P_MUSIG_REPLY_TO_PROPOSAL, SCHEMA_P2P_MUSIG_PSIG);
  registerBodySchema('P2P_MUSIG_REPLY_TO_PROPOSAL', SCHEMA_P2P_MUSIG_PSIG);
  registerBodySchema('MusigReplyToProposal', SCHEMA_P2P_MUSIG_PSIG);
  registerBodySchema(P2P_MUSIG_ACCEPT_PROPOSAL, SCHEMA_P2P_MUSIG_SIGNATURE);
  registerBodySchema('P2P_MUSIG_ACCEPT_PROPOSAL', SCHEMA_P2P_MUSIG_SIGNATURE);
  registerBodySchema('MusigAcceptProposal', SCHEMA_P2P_MUSIG_SIGNATURE);
  registerBodySchema(PASSPORT_CHALLENGE, SCHEMA_PASSPORT_CHALLENGE);
  registerBodySchema('PASSPORT_CHALLENGE', SCHEMA_PASSPORT_CHALLENGE);
  registerBodySchema('PassportChallenge', SCHEMA_PASSPORT_CHALLENGE);
  registerBodySchema(PASSPORT_ASSERTION, SCHEMA_PASSPORT_ASSERTION);
  registerBodySchema('PASSPORT_ASSERTION', SCHEMA_PASSPORT_ASSERTION);
  registerBodySchema('PassportAssertion', SCHEMA_PASSPORT_ASSERTION);
  const delegation = [
    [DELEGATION_LINK_OFFER, 'DELEGATION_LINK_OFFER', 'DelegationLinkOffer', SCHEMA_DELEGATION_LINK_OFFER],
    [DELEGATION_LINK_ANSWER, 'DELEGATION_LINK_ANSWER', 'DelegationLinkAnswer', SCHEMA_DELEGATION_LINK_ANSWER],
    [DELEGATION_LINK_REVEAL, 'DELEGATION_LINK_REVEAL', 'DelegationLinkReveal', SCHEMA_DELEGATION_LINK_REVEAL],
    [DELEGATION_GRANT, 'DELEGATION_GRANT', 'DelegationGrant', SCHEMA_DELEGATION_GRANT],
    [DELEGATION_REVOKE, 'DELEGATION_REVOKE', 'DelegationRevoke', SCHEMA_DELEGATION_REVOKE],
    [DELEGATION_REQUEST, 'DELEGATION_REQUEST', 'DelegationRequest', SCHEMA_DELEGATION_REQUEST],
    [DELEGATION_RESULT, 'DELEGATION_RESULT', 'DelegationResult', SCHEMA_DELEGATION_RESULT],
    [DELEGATION_MAILBOX_FETCH, 'DELEGATION_MAILBOX_FETCH', 'DelegationMailboxFetch', SCHEMA_DELEGATION_MAILBOX_FETCH]
  ];
  for (const [code, name, alias, schema] of delegation) {
    registerBodySchema(code, schema);
    registerBodySchema(name, schema);
    registerBodySchema(alias, schema);
  }
  const keyed = [
    [P2P_SESSION_OFFER, 'P2P_SESSION_OFFER', 'SessionOffer', SCHEMA_P2P_SESSION_OFFER],
    [P2P_SESSION_OPEN, 'P2P_SESSION_OPEN', 'SessionOpen', SCHEMA_P2P_SESSION_OPEN],
    [P2P_INVENTORY_REQUEST, 'P2P_INVENTORY_REQUEST', 'InventoryRequest', SCHEMA_P2P_INVENTORY_REQUEST],
    [P2P_INVENTORY_RESPONSE, 'P2P_INVENTORY_RESPONSE', 'InventoryResponse', SCHEMA_P2P_INVENTORY_RESPONSE],
    [P2P_DOCUMENT_PUBLISH, 'P2P_DOCUMENT_PUBLISH', 'DocumentPricingPublish', SCHEMA_P2P_DOCUMENT_PUBLISH],
    [DOCUMENT_PUBLISH_TYPE, 'DOCUMENT_PUBLISH', 'DocumentPublish', SCHEMA_DOCUMENT_PUBLISH],
    [DOCUMENT_REQUEST_TYPE, 'DOCUMENT_REQUEST', 'DocumentRequest', SCHEMA_DOCUMENT_REQUEST]
  ];
  for (const [code, name, alias, schema] of keyed) {
    registerBodySchema(code, schema);
    registerBodySchema(name, schema);
    registerBodySchema(alias, schema);
  }
})();

// Legacy JSON bodies <-> typed field bodies, for the protocol opcodes whose
// field schemas are registered above. Senders use `Message.fromLegacyBody`;
// receivers use `Message.tryParseLegacyBody` so handlers keep seeing the JSON
// shape whichever encoding the peer sent (docs/MESSAGE_BODY_MIGRATION.md).
/** @private */
const SIDECHAIN_PATCH_KIND = 'SidechainStatePatch';
/** @private */
const ZERO_DIGEST_HEX = '0'.repeat(64);
/** @private */
const MAX_UINT32 = (2 ** 32) - 1;
/** @private */
const MAX_PORT = 65535;

/**
 * Wire names whose legacy JSON bodies map onto field schemas.
 * @private
 */
const LEGACY_BODY_TYPES = Object.freeze([
  'P2P_PING',
  'P2P_PONG',
  'P2P_PEER_ANNOUNCE',
  'P2P_PEER_GOSSIP',
  'P2P_PEERING_OFFER',
  'CONTRACT_PUBLISH',
  'CONTRACT_MESSAGE',
  'SIDECHAIN_STATE_PATCH',
  'P2P_SESSION_OFFER',
  'P2P_SESSION_OPEN',
  'P2P_INVENTORY_REQUEST',
  'P2P_INVENTORY_RESPONSE',
  'P2P_DOCUMENT_PUBLISH',
  'DOCUMENT_PUBLISH',
  'DOCUMENT_REQUEST'
]);

/**
 * @private
 * @param {string|number} type
 * @returns {string|null}
 */
function legacyWireName (type) {
  const name = Message.canonicalTypeName(type);
  return name && LEGACY_BODY_TYPES.includes(name) ? name : null;
}

/**
 * @private
 * @param {*} value
 * @returns {boolean}
 */
function isPlainObject (value) {
  return value != null && typeof value === 'object' && !Array.isArray(value) && !Buffer.isBuffer(value);
}

/**
 * @private
 * @param {*} value
 * @returns {string}
 */
function bodyString (value) {
  if (value == null || typeof value === 'object') return '';
  return String(value);
}

/**
 * Socket port; anything outside 0–65535 is 0 (the wire field is u32, but a
 * larger port cannot be dialed).
 * @private
 * @param {*} value
 * @returns {number}
 */
function bodyPort (value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= MAX_PORT ? n : 0;
}

/**
 * @private
 * @param {*} value
 * @returns {number}
 */
function bodyUint32 (value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= MAX_UINT32 ? n : 0;
}

/**
 * Hop budget for a forwarded gossip / offer. A missing or invalid hop means
 * "full budget" (legacy JSON receivers treat a missing hop as their max); an
 * explicit 0 would make field receivers drop the frame.
 * @private
 * @param {*} value
 * @param {number} max
 * @returns {number}
 */
function bodyHop (value, max) {
  if (value == null || value === '') return max;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return max;
  return Math.min(Math.floor(n), 0xff);
}

/**
 * Gossip / offer bodies may arrive flat (`{ host, port, … }`) or as a
 * Hub-style envelope (`{ type, object: { host, port, … } }`).
 * @private
 * @param {object} body
 * @returns {object}
 */
function peeringObject (body) {
  if (!isPlainObject(body)) return {};
  return isPlainObject(body.object) ? body.object : body;
}

/**
 * Drop empty optional fields so a decoded body matches what a JSON sender
 * would have written (absent keys rather than `''`).
 * @private
 * @param {object} obj
 * @param {string[]} [zeroIsAbsent]
 * @returns {object}
 */
const CONTRACT_FILTER_KEYS = Object.freeze(['recipient', 'ref', 'slot']);
const CONTRACT_FILTER_MAX = 256;

/**
 * Filter string from the contract body the sender already holds. Top-level
 * wins; otherwise the same key on `object`. This does not parse a JSON payload.
 * @private
 * @param {object} body
 * @param {string} key
 * @returns {string}
 */
function filterSource (body, key) {
  if (typeof body[key] === 'string') return body[key];
  const obj = body.object;
  if (isPlainObject(obj) && typeof obj[key] === 'string') return obj[key];
  return '';
}

/**
 * @private
 * @param {*} value
 * @param {string} key
 * @returns {string}
 */
function contractFilterString (value, key) {
  if (value == null || value === '') return '';
  if (typeof value !== 'string') return '';
  const s = value.trim();
  if (s.length > CONTRACT_FILTER_MAX) {
    throw new TypeError(`CONTRACT_MESSAGE ${key} exceeds ${CONTRACT_FILTER_MAX} characters`);
  }
  return s;
}

/**
 * `recipient`, `ref`, and `slot` from a CONTRACT_MESSAGE field body.
 * Does not read the JSON payload.
 * @param {Message|object|null} messageOrFields
 * @returns {{ recipient: string, ref: string, slot: string }}
 */
function contractMessageIndex (messageOrFields) {
  const fields = messageOrFields && typeof messageOrFields.toFields === 'function'
    ? messageOrFields.toFields()
    : messageOrFields;
  const src = isPlainObject(fields) ? fields : {};
  const out = { recipient: '', ref: '', slot: '' };
  for (const key of CONTRACT_FILTER_KEYS) {
    out[key] = typeof src[key] === 'string' ? src[key] : '';
  }
  return out;
}

/**
 * True when every non-empty query field equals the frame's index field.
 * An empty query matches. A frame with no index does not match a query.
 * @param {Message|object|null} messageOrFields
 * @param {object} [query]
 * @returns {boolean}
 */
function contractMessageMatches (messageOrFields, query) {
  const index = contractMessageIndex(messageOrFields);
  const q = isPlainObject(query) ? query : {};
  for (const key of CONTRACT_FILTER_KEYS) {
    if (q[key] == null || q[key] === '') continue;
    if (index[key] !== String(q[key])) return false;
  }
  return true;
}

function compactBody (obj, zeroIsAbsent = []) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === '' || v == null) continue;
    if (v === 0 && zeroIsAbsent.includes(k)) continue;
    out[k] = v;
  }
  return out;
}

/**
 * @private
 * @param {*} value
 * @returns {string}
 */
function digestFieldHex (value) {
  if (value == null || value === '') return ZERO_DIGEST_HEX;
  const s = String(value);
  if (!/^[0-9a-f]{64}$/.test(s)) {
    throw new TypeError('SIDECHAIN_STATE_PATCH basisDigest must be 64 lowercase hex characters');
  }
  return s;
}

/**
 * @private
 * @param {string} text
 * @returns {*}
 */
function parseJsonOrUndefined (text) {
  if (typeof text !== 'string' || !text) return undefined;
  try {
    return JSON.parse(text);
  } catch (_) {
    return undefined;
  }
}

/**
 * @private
 * @param {object} obj
 * @param {string} path Dotted path.
 * @returns {*}
 */
function readPath (obj, path) {
  let node = obj;
  for (const part of path.split('.')) {
    if (!isPlainObject(node) || !Object.prototype.hasOwnProperty.call(node, part)) return undefined;
    node = node[part];
  }
  return node;
}

/**
 * Delete `path`, then any parent the deletion left empty.
 * @private
 * @param {object} obj
 * @param {string} path
 */
function deletePath (obj, path) {
  const parts = path.split('.');
  const parents = [obj];
  for (let i = 0; i < parts.length - 1; i++) parents.push(parents[i][parts[i]]);
  for (let i = parts.length - 1; i >= 0; i--) {
    delete parents[i][parts[i]];
    if (i > 0 && Object.keys(parents[i]).length) break;
  }
}

/**
 * @private
 * @param {object} obj
 * @param {string} path
 * @param {*} value
 * @returns {boolean} false when a parent on the path is not an object
 */
function writePath (obj, path, value) {
  const parts = path.split('.');
  let node = obj;
  for (const part of parts.slice(0, -1)) {
    if (node[part] === undefined) node[part] = {};
    if (!isPlainObject(node[part])) return false;
    node = node[part];
  }
  node[parts[parts.length - 1]] = value;
  return true;
}

/**
 * @private
 * @param {string} kind
 * @param {*} value A JSON value.
 * @returns {boolean} whether the field of `kind` holds `value` exactly
 */
function keyedValueFits (kind, value) {
  switch (kind) {
    case 'string':
      return typeof value === 'string';
    case 'u8':
      return Number.isInteger(value) && value >= 0 && value <= 0xff;
    case 'u32':
      return Number.isInteger(value) && value >= 0 && value <= MAX_UINT32;
    case 'u64':
      return Number.isSafeInteger(value) && value >= 0;
    case 'bool':
      return typeof value === 'boolean';
    case 'hex32':
      return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
    case 'base64':
      return typeof value === 'string' && Buffer.from(value, 'base64').toString('base64') === value;
    case 'json':
      return value !== undefined;
  }
  /* istanbul ignore next */
  return false;
}

/**
 * @private
 * @param {string} kind
 * @param {*} value
 * @returns {*} field value for `encodeBody`
 */
function keyedFieldValue (kind, value) {
  switch (kind) {
    case 'bool':
      return value ? 1 : 0;
    case 'hex32':
      return Buffer.from(value, 'hex');
    case 'base64':
      return Buffer.from(value, 'base64');
    case 'json':
      return JSON.stringify(value);
    default:
      return value;
  }
}

/**
 * @private
 * @param {string} kind
 * @param {*} field Decoded field.
 * @returns {*} the JSON value, or `undefined` when the field is unusable
 */
function keyedJsonValue (kind, field) {
  switch (kind) {
    case 'string':
      return typeof field === 'string' ? field : undefined;
    case 'u8':
    case 'u32':
    case 'u64': {
      const n = Number(field);
      return Number.isSafeInteger(n) ? n : undefined;
    }
    case 'bool':
      return field === 1 ? true : (field === 0 ? false : undefined);
    case 'hex32':
      return Buffer.isBuffer(field) && field.length === 32 ? field.toString('hex') : undefined;
    case 'base64':
      return Buffer.isBuffer(field) ? field.toString('base64') : undefined;
    case 'json':
      return parseJsonOrUndefined(field);
  }
  /* istanbul ignore next */
  return undefined;
}

/**
 * Legacy JSON body → fields of a keyed layout. Works on the body as a JSON
 * sender would write it, so nothing is lost: what a field can't hold exactly
 * stays in `extra`.
 * @private
 * @param {string} name
 * @param {object} body
 * @returns {object}
 */
function encodeKeyedBody (name, body) {
  if (!isPlainObject(body)) throw new TypeError(`${name} body must be an object`);
  const layout = KEYED_LAYOUTS[name];
  const rest = JSON.parse(JSON.stringify(body));
  const envelope = layout.envelope && isPlainObject(rest.object);
  const prefix = envelope ? 'object.' : '';
  const fields = {};
  let present = envelope ? KEYED_ENVELOPE_FLAG : 0;
  layout.keys.forEach((key, bit) => {
    const value = readPath(rest, prefix + key.path);
    if (!keyedValueFits(key.kind, value)) return;
    fields[key.field] = keyedFieldValue(key.kind, value);
    present |= (1 << bit);
    deletePath(rest, prefix + key.path);
  });
  fields.present = present >>> 0;
  fields.extra = Object.keys(rest).length ? JSON.stringify(rest) : '';
  return fields;
}

/**
 * Fields of a keyed layout → legacy JSON body.
 * @private
 * @param {string} name
 * @param {object} fields
 * @returns {object|null}
 */
function decodeKeyedBody (name, fields) {
  const layout = KEYED_LAYOUTS[name];
  const out = fields.extra ? parseJsonOrUndefined(fields.extra) : {};
  if (!isPlainObject(out)) return null;
  const present = Number(fields.present) >>> 0;
  const prefix = layout.envelope && (present & KEYED_ENVELOPE_FLAG) ? 'object.' : '';
  for (let bit = 0; bit < layout.keys.length; bit++) {
    if (!(present & (1 << bit))) continue;
    const key = layout.keys[bit];
    const value = keyedJsonValue(key.kind, fields[key.field]);
    if (value === undefined) return null;
    if (!writePath(out, prefix + key.path, value)) return null;
  }
  return out;
}

/**
 * Map a legacy JSON body to the typed field object for `type`.
 * @private
 * @param {string|number} type Wire name, friendly alias, or opcode.
 * @param {object} body Legacy JSON body.
 * @returns {object} Field object for `Message.fromFields`.
 */
function encodeLegacyBody (type, body) {
  const name = legacyWireName(type);
  if (!name) throw new TypeError(`encodeLegacyBody: no field mapping for ${type}`);
  if (KEYED_LAYOUTS[name]) return encodeKeyedBody(name, body);
  const b = isPlainObject(body) ? body : {};

  switch (name) {
    case 'P2P_PING':
    case 'P2P_PONG':
      return { nonce: bodyString(b.nonce != null ? b.nonce : b.created) };
    case 'P2P_PEER_ANNOUNCE': {
      const o = peeringObject(b);
      return { host: bodyString(o.host), port: bodyPort(o.port), pubkey: bodyString(o.pubkey), nonce: bodyString(o.nonce) };
    }
    case 'P2P_PEER_GOSSIP': {
      const o = peeringObject(b);
      return {
        host: bodyString(o.host),
        port: bodyPort(o.port),
        gossipHop: bodyHop(o.gossipHop, GOSSIP_MAX_HOPS),
        nonce: bodyString(o.nonce),
        pubkey: bodyString(o.pubkey)
      };
    }
    case 'P2P_PEERING_OFFER': {
      const o = peeringObject(b);
      return {
        transport: bodyString(o.transport),
        host: bodyString(o.host),
        port: bodyPort(o.port),
        peeringHop: bodyHop(o.peeringHop, PEERING_OFFER_MAX_HOPS),
        pubkey: bodyString(o.pubkey),
        slots: bodyUint32(o.slots),
        peering: bodyString(o.peering),
        nonce: bodyString(o.nonce)
      };
    }
    // Key order is kept (not sorted): `Actor` ids hash insertion-ordered JSON,
    // so the namespace id must match a JSON publish of the same object.
    case 'CONTRACT_PUBLISH':
      if (!isPlainObject(body)) throw new TypeError('CONTRACT_PUBLISH body must be an object');
      return { definition: JSON.stringify(body) };
    case 'CONTRACT_MESSAGE': {
      const contract = bodyString(b.contract).trim();
      if (!contract) throw new TypeError('CONTRACT_MESSAGE body requires contract');
      const rest = Object.assign({}, b);
      delete rest.contract;
      return {
        contract,
        payload: JSON.stringify(rest),
        recipient: contractFilterString(filterSource(b, 'recipient'), 'recipient'),
        ref: contractFilterString(filterSource(b, 'ref'), 'ref'),
        slot: contractFilterString(filterSource(b, 'slot'), 'slot')
      };
    }
    case 'SIDECHAIN_STATE_PATCH': {
      if (!Array.isArray(b.patches) || !b.patches.length) {
        throw new TypeError('SIDECHAIN_STATE_PATCH body requires patches');
      }
      const basisClock = Number(b.basisClock);
      if (!Number.isInteger(basisClock) || basisClock < 0) {
        throw new TypeError('SIDECHAIN_STATE_PATCH body requires a non-negative integer basisClock');
      }
      return {
        basisClock,
        basisDigest: digestFieldHex(b.basisDigest),
        catalogCanonical: '',
        patchesCanonical: fabricCanonicalJson(jsonSafe(b.patches)),
        federationWitnessCanonical: b.federationWitness ? fabricCanonicalJson(jsonSafe(b.federationWitness)) : ''
      };
    }
  }
  /* istanbul ignore next */
  throw new TypeError(`encodeLegacyBody: no field mapping for ${type}`);
}

/**
 * Rebuild the legacy JSON body from decoded typed fields.
 * @private
 * @param {string|number} type Wire name, friendly alias, or opcode.
 * @param {object} fields Output of `decodeBody` / `message.toFields()`.
 * @returns {object|null} Legacy body, or `null` when the fields are unusable.
 */
function decodeLegacyBody (type, fields) {
  const name = legacyWireName(type);
  if (!name || !isPlainObject(fields)) return null;
  if (KEYED_LAYOUTS[name]) return decodeKeyedBody(name, fields);
  const f = fields;

  switch (name) {
    case 'P2P_PING':
    case 'P2P_PONG':
      return compactBody({ nonce: f.nonce });
    case 'P2P_PEER_ANNOUNCE':
      return compactBody({ host: f.host, port: bodyPort(f.port), pubkey: f.pubkey, nonce: f.nonce });
    case 'P2P_PEER_GOSSIP':
      return compactBody({ host: f.host, port: bodyPort(f.port), gossipHop: f.gossipHop, nonce: f.nonce, pubkey: f.pubkey });
    case 'P2P_PEERING_OFFER':
      return compactBody({
        transport: f.transport,
        host: f.host,
        port: bodyPort(f.port),
        peeringHop: f.peeringHop,
        pubkey: f.pubkey,
        slots: f.slots,
        peering: f.peering,
        nonce: f.nonce
      }, ['slots']);
    case 'CONTRACT_PUBLISH': {
      const definition = parseJsonOrUndefined(f.definition);
      return isPlainObject(definition) ? definition : null;
    }
    case 'CONTRACT_MESSAGE': {
      const contract = bodyString(f.contract).trim();
      if (!contract) return null;
      const payload = f.payload ? parseJsonOrUndefined(f.payload) : {};
      if (!isPlainObject(payload)) return null;
      // `contract` first, as JSON senders write it; the field value always wins.
      return Object.assign({ contract }, payload, { contract });
    }
    case 'SIDECHAIN_STATE_PATCH': {
      const digestHex = Buffer.isBuffer(f.basisDigest) ? f.basisDigest.toString('hex') : bodyString(f.basisDigest);
      let patches = parseJsonOrUndefined(f.patchesCanonical);
      // A malformed patch list is rejected, never replaced by the catalog.
      if (f.patchesCanonical && !Array.isArray(patches)) return null;
      if (!Array.isArray(patches) || !patches.length) {
        const catalog = parseJsonOrUndefined(f.catalogCanonical);
        patches = catalog !== undefined ? [{ op: 'add', path: '/registry', value: catalog }] : null;
      }
      if (!patches) return null;
      const witness = parseJsonOrUndefined(f.federationWitnessCanonical);
      return {
        type: 'SIDECHAIN_STATE_PATCH',
        version: 1,
        kind: SIDECHAIN_PATCH_KIND,
        basisClock: Number(f.basisClock),
        basisDigest: digestHex === ZERO_DIGEST_HEX ? '' : digestHex,
        patches,
        federationWitness: isPlainObject(witness) ? witness : null
      };
    }
  }
  /* istanbul ignore next */
  return null;
}

/**
 * Build an unsigned typed-field `Message` from a legacy JSON body.
 * @private
 * @param {string|number} type
 * @param {object} body Legacy JSON body.
 * @param {object} [opts] Extra `Message` constructor settings.
 * @returns {Message}
 */
function fromLegacyBody (type, body, opts = {}) {
  const name = legacyWireName(type);
  if (!name) throw new TypeError(`fromLegacyBody: no field mapping for ${type}`);
  return Message.fromFields(name, encodeLegacyBody(name, body), opts);
}

/**
 * Parse a message body into its legacy JSON shape, from either encoding.
 * @private
 * @param {Message} message
 * @returns {{ ok: true, value: object, encoding: 'json'|'fields' }|{ ok: false, error: Error }}
 */
function tryParseLegacyBody (message) {
  const parsed = Message.tryParseMessageBody(message);
  if (!parsed.ok) return parsed;
  if (parsed.encoding !== 'fields') return parsed;
  const value = decodeLegacyBody(message.type, parsed.value);
  if (!value) return { ok: false, error: new TypeError(`unusable ${message.type} field body`) };
  return { ok: true, value, encoding: 'fields' };
}

/**
 * Encoding-independent object for dedup and registration keys of peering
 * bodies (gossip / offer / announce): sorted keys, empty values dropped,
 * numeric `port`, and the hop counters removed.
 * @private
 * @param {object} obj Flat peering object (not the envelope).
 * @param {string[]} [omit] Extra keys to drop.
 * @returns {object}
 */
function canonicalPeeringObject (obj, omit = []) {
  const src = isPlainObject(obj) ? obj : {};
  const drop = new Set(['gossipHop', 'peeringHop'].concat(omit));
  const out = {};
  for (const key of Object.keys(src).sort()) {
    if (drop.has(key)) continue;
    let v = src[key];
    if (v === '' || v == null) continue;
    if (key === 'port') v = bodyPort(v);
    if (key === 'slots') {
      v = bodyUint32(v);
      if (v === 0) continue;
    }
    out[key] = v;
  }
  return out;
}

Message.FIELD_TYPES = BODY_FIELD_TYPES;
Message.MAX_MESSAGE_SIZE = MAX_MESSAGE_SIZE;
Message.MAX_FRAME_BYTES = MAX_FRAME_BYTES;
Message.HEADER_OFFSETS = HEADER_OFFSETS;
Message.ZERO_PARENT = ZERO_PARENT;
Message.isZeroParent = isZeroParent;
Message.normalizeParent = normalizeParent;
Message.parentHexOf = parentHexOf;
Message.frameIdOf = frameIdOf;
Message.setMessageParent = setMessageParent;
Message.padDigits = padDigits;
Message.verifyFrameAuthor = verifyFrameAuthor;
Message.LEGACY_BODY_TYPES = LEGACY_BODY_TYPES;
Message.encodeLegacyBody = encodeLegacyBody;
Message.decodeLegacyBody = decodeLegacyBody;
Message.fromLegacyBody = fromLegacyBody;
Message.tryParseLegacyBody = tryParseLegacyBody;
Message.canonicalPeeringObject = canonicalPeeringObject;
Message.contractMessageIndex = contractMessageIndex;
Message.contractMessageMatches = contractMessageMatches;
Message.registerBodySchema = registerBodySchema;
Message.getBodySchema = getBodySchema;
Message.encodeBody = encodeBody;
Message.decodeBody = decodeBody;
Message.tryParseMessageBody = tryParseMessageBody;
Message.SCHEMA_P2P_PING = SCHEMA_P2P_PING;
Message.SCHEMA_P2P_CHAT = SCHEMA_P2P_CHAT;
Message.SCHEMA_PROGRAM_RUN = SCHEMA_PROGRAM_RUN;
Message.SCHEMA_CONTRACT_PUBLISH = SCHEMA_CONTRACT_PUBLISH;
Message.SCHEMA_CONTRACT_MESSAGE = SCHEMA_CONTRACT_MESSAGE;
Message.SCHEMA_P2P_FORWARD = SCHEMA_P2P_FORWARD;
Message.SCHEMA_P2P_PEER_GOSSIP = SCHEMA_P2P_PEER_GOSSIP;
Message.SCHEMA_P2P_PEERING_OFFER = SCHEMA_P2P_PEERING_OFFER;
Message.SCHEMA_P2P_PEER_ANNOUNCE = SCHEMA_P2P_PEER_ANNOUNCE;
Message.SCHEMA_SIDECHAIN_STATE_PATCH = SCHEMA_SIDECHAIN_STATE_PATCH;
Message.SCHEMA_P2P_MUSIG_START = SCHEMA_P2P_MUSIG_START;
Message.SCHEMA_PASSPORT_CHALLENGE = SCHEMA_PASSPORT_CHALLENGE;
Message.SCHEMA_PASSPORT_ASSERTION = SCHEMA_PASSPORT_ASSERTION;
Message.SCHEMA_DELEGATION_LINK_OFFER = SCHEMA_DELEGATION_LINK_OFFER;
Message.SCHEMA_DELEGATION_LINK_ANSWER = SCHEMA_DELEGATION_LINK_ANSWER;
Message.SCHEMA_DELEGATION_LINK_REVEAL = SCHEMA_DELEGATION_LINK_REVEAL;
Message.SCHEMA_DELEGATION_GRANT = SCHEMA_DELEGATION_GRANT;
Message.SCHEMA_DELEGATION_REVOKE = SCHEMA_DELEGATION_REVOKE;
Message.SCHEMA_DELEGATION_REQUEST = SCHEMA_DELEGATION_REQUEST;
Message.SCHEMA_DELEGATION_RESULT = SCHEMA_DELEGATION_RESULT;
Message.SCHEMA_DELEGATION_MAILBOX_FETCH = SCHEMA_DELEGATION_MAILBOX_FETCH;
Message.SCHEMA_P2P_SESSION_OFFER = SCHEMA_P2P_SESSION_OFFER;
Message.SCHEMA_P2P_SESSION_OPEN = SCHEMA_P2P_SESSION_OPEN;
Message.SCHEMA_P2P_INVENTORY_REQUEST = SCHEMA_P2P_INVENTORY_REQUEST;
Message.SCHEMA_P2P_INVENTORY_RESPONSE = SCHEMA_P2P_INVENTORY_RESPONSE;
Message.SCHEMA_P2P_DOCUMENT_PUBLISH = SCHEMA_P2P_DOCUMENT_PUBLISH;
Message.SCHEMA_DOCUMENT_PUBLISH = SCHEMA_DOCUMENT_PUBLISH;
Message.SCHEMA_DOCUMENT_REQUEST = SCHEMA_DOCUMENT_REQUEST;

const fs = require('fs');
const path = require('path');
const WIRE_CATALOG_ROOT = path.resolve(__dirname, '..');
const WIRE_CATALOG_PATH = path.join(WIRE_CATALOG_ROOT, 'MESSAGES.md');
const WIRE_CATALOG_BEGIN = '<!-- BEGIN WIRE_CATALOG -->';
const WIRE_CATALOG_END = '<!-- END WIRE_CATALOG -->';

function wireCatalogHexOf (n) {
  const h = n.toString(16);
  if (n <= 0xffff) return '0x' + h.padStart(4, '0');
  return '0x' + h;
}

function wireCatalogFamilyOf (name, code) {
  if (name.indexOf('LIGHTNING_') === 0) return 'lightning';
  if (name.indexOf('BITCOIN_') === 0) return 'bitcoin';
  if (name === 'SIDECHAIN_STATE_PATCH' || name.indexOf('CONTRACT_') === 0) return 'contracts';
  if (
    name.indexOf('DOCUMENT_') === 0 ||
    name === 'P2P_INVENTORY_REQUEST' ||
    name === 'P2P_INVENTORY_RESPONSE' ||
    name === 'P2P_FILE_SEND' ||
    name === 'P2P_DOCUMENT_PUBLISH'
  ) {
    return 'documents';
  }
  if (
    name === 'JSON_CALL' ||
    name === 'JSON_PATCH' ||
    name === 'GENERIC_MESSAGE' ||
    name === 'P2P_MESSAGE_RECEIPT' ||
    name === 'CHAT_MESSAGE'
  ) {
    return 'hub';
  }
  if (
    name.indexOf('P2P_SESSION_') === 0 ||
    name.indexOf('P2P_IDENT_') === 0 ||
    name.indexOf('P2P_MUSIG_') === 0 ||
    name.indexOf('PASSPORT_') === 0 ||
    name === 'P2P_INSTRUCTION'
  ) {
    return 'session';
  }
  if (
    name === 'LOG_MESSAGE' ||
    name === 'GENERIC_LIST' ||
    name === 'BLOCK_CANDIDATE' ||
    name === 'PEER_CANDIDATE' ||
    name === 'SESSION_START' ||
    name === 'P2P_BASE_MESSAGE' ||
    name === 'P2P_GENERIC' ||
    name === 'P2P_START_CHAIN' ||
    name === 'P2P_STATE_ROOT' ||
    name === 'P2P_STATE_COMMITTMENT' ||
    name === 'P2P_STATE_CHANGE' ||
    name === 'P2P_STATE_REQUEST' ||
    name === 'P2P_TRANSACTION' ||
    name === 'P2P_CALL'
  ) {
    return 'legacy';
  }
  if (code >= 0x2000 && code <= 0x2fff) return 'lightning';
  return 'mesh';
}

function collectWireCatalog () {
  require('../functions/documentRegistrySidechain');
  const aliasesByCode = Object.create(null);
  const types = new Message().types;
  for (const name of Object.keys(types)) {
    const code = types[name];
    if (typeof code !== 'number' || !Number.isFinite(code)) continue;
    const decode = Message.canonicalTypeName(code);
    if (!decode || name === decode) continue;
    if (!aliasesByCode[code]) aliasesByCode[code] = [];
    if (aliasesByCode[code].indexOf(name) === -1) aliasesByCode[code].push(name);
  }
  for (const code of Object.keys(aliasesByCode)) {
    aliasesByCode[code].sort();
  }
  const rows = [];
  for (const pair of Message.WIRE_TYPE_DECODE_ORDER) {
    const code = pair[0];
    const name = pair[1];
    if (typeof code !== 'number' || !Number.isFinite(code)) continue;
    const schema = Message.getBodySchema(code) || Message.getBodySchema(name);
    rows.push({
      name,
      opcode: code,
      hex: wireCatalogHexOf(code),
      aliases: aliasesByCode[code] ? aliasesByCode[code].slice() : [],
      schema: Array.isArray(schema) && schema.length > 0,
      family: wireCatalogFamilyOf(name, code)
    });
  }
  return rows;
}

function renderWireCatalogTable (rows) {
  const lines = [
    '| Decode name | Dec | Hex | Encode aliases | Field schema | Family |',
    '|---|---:|---|---|---|---|'
  ];
  for (const row of rows) {
    const aliases = row.aliases.length ? '`' + row.aliases.join('`, `') + '`' : '—';
    lines.push(
      `| \`${row.name}\` | ${row.opcode} | \`${row.hex}\` | ${aliases} | ${row.schema ? 'yes' : 'no'} | ${row.family} |`
    );
  }
  return lines.join('\n');
}

function wireCatalogBlock (rows) {
  const unique = new Set(rows.map((row) => row.opcode));
  const withSchema = rows.filter((row) => row.schema).length;
  const lightning = rows.filter((row) => row.family === 'lightning').length;
  return `${WIRE_CATALOG_BEGIN}

This catalog: **${rows.length}** decode names, **${unique.size}** unique opcodes, **${withSchema}** with a registered field schema, **${lightning}** Lightning AMP rows. Regenerated by \`npm run docs:message-types\`. Do not hand-edit the table.

${renderWireCatalogTable(rows)}

${WIRE_CATALOG_END}`;
}

function writeWireCatalog () {
  const rows = collectWireCatalog();
  const block = wireCatalogBlock(rows);
  const here = process.cwd();
  try {
    if (here !== WIRE_CATALOG_ROOT) process.chdir(WIRE_CATALOG_ROOT);
    // Literal filename: Codacy Semgrep flags fs.*(constructedPath) as critical.
    let md = fs.readFileSync('MESSAGES.md', 'utf8');
    const start = md.indexOf(WIRE_CATALOG_BEGIN);
    const stop = md.indexOf(WIRE_CATALOG_END);
    if (start < 0 || stop < 0 || stop < start) {
      throw new Error('MESSAGES.md is missing ' + WIRE_CATALOG_BEGIN + ' / ' + WIRE_CATALOG_END);
    }
    md = md.slice(0, start) + block + md.slice(stop + WIRE_CATALOG_END.length);
    fs.writeFileSync('MESSAGES.md', md);
  } finally {
    if (process.cwd() !== here) process.chdir(here);
  }
  return rows;
}

Message.wireCatalog = {
  OUTPUT_PATH: WIRE_CATALOG_PATH,
  CATALOG_BEGIN: WIRE_CATALOG_BEGIN,
  CATALOG_END: WIRE_CATALOG_END,
  collectCatalog: collectWireCatalog,
  catalogBlock: wireCatalogBlock,
  renderMarkdown: wireCatalogBlock,
  renderTable: renderWireCatalogTable,
  writeConsolidation: writeWireCatalog,
  hexOf: wireCatalogHexOf,
  familyOf: wireCatalogFamilyOf
};

module.exports = Message;

if (require.main === module) {
  const rows = writeWireCatalog();
  process.stdout.write('Wrote MESSAGES.md (' + rows.length + ' decode names)\n');
}
