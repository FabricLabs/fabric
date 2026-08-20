'use strict';

/**
 * Public gossip-network catalog for Fabric AMP types.
 *
 * Peer (`types/peer.js`) is the protocol oracle for *how* frames are validated
 * and forwarded. This module is the single list of **which** types belong on
 * the public mesh flood versus directed/session/hub paths.
 *
 * Policies:
 * - `flood` — public `relayFrom` after AMP validate (bit-identical)
 * - `envelope` — `P2P_RELAY` outer flood (inner is local-observe)
 * - `opt-in` — flood only when Peer settings enable it (inventory)
 * - `trusted` — not public; `relayFromTrustedPeers` / allow-list
 * - `directed` — hop-by-hop (`P2P_FORWARD`, file send, MuSig2)
 * - `session` — TCP/NOISE control (ping, session offer/open)
 * - `observe` — local emit / originator broadcast; Peer does not mesh-flood
 * - `hub` — HTTP / WebSocket / generic carrier (not public gossip)
 *
 * @fileoverview Classify Fabric Message types for public gossip vs directed relay.
 * @module functions/gossipNetwork
 * @see MESSAGES.md
 * @see SECURITY.md
 * @see docs/MESH_CHAT.md
 */

const {
  BITCOIN_BLOCK_TYPE,
  BITCOIN_BLOCK_HASH_TYPE,
  BITCOIN_TRANSACTION_TYPE,
  BITCOIN_TRANSACTION_HASH_TYPE,
  LOG_MESSAGE_TYPE,
  GENERIC_LIST_TYPE,
  GENERIC_MESSAGE_TYPE,
  SIDECHAIN_STATE_PATCH_TYPE,
  DOCUMENT_PUBLISH_TYPE,
  DOCUMENT_REQUEST_TYPE,
  BLOCK_CANDIDATE,
  P2P_PING,
  P2P_PONG,
  P2P_GENERIC,
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
  P2P_SESSION_OFFER,
  P2P_SESSION_OPEN,
  P2P_SESSION_ACK,
  P2P_MUSIG_START,
  P2P_MUSIG_ACCEPT,
  P2P_MUSIG_RECEIVE_COUNTER,
  P2P_MUSIG_SEND_PROPOSAL,
  P2P_MUSIG_REPLY_TO_PROPOSAL,
  P2P_MUSIG_ACCEPT_PROPOSAL,
  P2P_CONTRACT_PUBLISH,
  P2P_CONTRACT_MESSAGE,
  P2P_IDENT_REQUEST,
  P2P_IDENT_RESPONSE,
  P2P_BASE_MESSAGE,
  P2P_STATE_ROOT,
  P2P_STATE_COMMITTMENT,
  P2P_STATE_CHANGE,
  P2P_STATE_REQUEST,
  P2P_TRANSACTION,
  P2P_CALL,
  P2P_RELAY,
  P2P_MESSAGE_RECEIPT,
  P2P_FORWARD,
  PEER_CANDIDATE,
  SESSION_START,
  CHAT_MESSAGE,
  P2P_CHAT_MESSAGE,
  JSON_CALL_TYPE,
  PATCH_MESSAGE_TYPE,
  CONTRACT_PROPOSAL_TYPE,
  P2P_START_CHAIN,
  P2P_INSTRUCTION,
  HEADER_SIZE,
  MAX_MESSAGE_SIZE,
  MAX_PEERS,
  LIGHTNING_INIT,
  LIGHTNING_ERROR,
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
  LIGHTNING_WARNING,
  LIGHTNING_PING,
  LIGHTNING_PONG
} = require('../constants');

function row (name, opcode, policy, role, aliases) {
  return Object.freeze({
    name,
    opcode,
    policy,
    role,
    aliases: Object.freeze(Array.isArray(aliases) ? aliases.slice() : [])
  });
}

/**
 * One row per {@link Message.WIRE_TYPE_DECODE_ORDER} decode name.
 * @type {ReadonlyArray<{name: string, opcode: number, policy: string, role: string, aliases: ReadonlyArray<string>}>}
 */
const GOSSIP_NETWORK_TYPES = Object.freeze([
  row('BITCOIN_BLOCK', BITCOIN_BLOCK_TYPE, 'flood', 'bitcoin-tip', ['BitcoinBlock']),
  row('BITCOIN_BLOCK_HASH', BITCOIN_BLOCK_HASH_TYPE, 'observe', 'bitcoin', ['BitcoinBlockHash']),
  row('BITCOIN_TRANSACTION', BITCOIN_TRANSACTION_TYPE, 'observe', 'bitcoin', ['BitcoinTransaction']),
  row('BITCOIN_TRANSACTION_HASH', BITCOIN_TRANSACTION_HASH_TYPE, 'observe', 'bitcoin', ['BitcoinTransactionHash']),
  row('LOG_MESSAGE', LOG_MESSAGE_TYPE, 'observe', 'legacy', ['FabricLogMessage', 'LogMessage']),
  row('GENERIC_LIST', GENERIC_LIST_TYPE, 'observe', 'legacy', ['GenericList']),
  row('GENERIC_MESSAGE', GENERIC_MESSAGE_TYPE, 'hub', 'carrier', ['GenericMessage']),
  row('SIDECHAIN_STATE_PATCH', SIDECHAIN_STATE_PATCH_TYPE, 'observe', 'contracts', ['SidechainStatePatch']),
  row('DOCUMENT_PUBLISH', DOCUMENT_PUBLISH_TYPE, 'observe', 'documents', ['DocumentPublish']),
  row('DOCUMENT_REQUEST', DOCUMENT_REQUEST_TYPE, 'flood', 'documents', ['DocumentRequest']),
  row('BLOCK_CANDIDATE', BLOCK_CANDIDATE, 'observe', 'legacy', ['BlockCandidate']),
  row('P2P_PING', P2P_PING, 'session', 'keepalive', ['Ping']),
  row('P2P_PONG', P2P_PONG, 'session', 'keepalive', ['Pong']),
  row('P2P_GENERIC', P2P_GENERIC, 'observe', 'legacy', ['Generic']),
  row('P2P_CHAIN_SYNC_REQUEST', P2P_CHAIN_SYNC_REQUEST, 'observe', 'mesh', ['ChainSyncRequest']),
  row('P2P_FLUSH_CHAIN', P2P_FLUSH_CHAIN, 'trusted', 'playnet', ['FlushChain']),
  row('P2P_INVENTORY_REQUEST', P2P_INVENTORY_REQUEST, 'opt-in', 'documents', ['InventoryRequest', 'INVENTORY_REQUEST']),
  row('P2P_INVENTORY_RESPONSE', P2P_INVENTORY_RESPONSE, 'opt-in', 'documents', ['InventoryResponse', 'INVENTORY_RESPONSE']),
  row('P2P_FILE_SEND', P2P_FILE_SEND, 'directed', 'documents', ['FileSend']),
  row('P2P_DOCUMENT_PUBLISH', P2P_DOCUMENT_PUBLISH, 'observe', 'documents', ['DocumentPricingPublish']),
  row('P2P_PEER_ALIAS', P2P_PEER_ALIAS, 'flood', 'identity', ['PeerAlias']),
  row('P2P_PEER_ANNOUNCE', P2P_PEER_ANNOUNCE, 'observe', 'topology', ['PeerAnnounce']),
  row('P2P_PEER_GOSSIP', P2P_PEER_GOSSIP, 'flood', 'topology', ['PeerGossip']),
  row('P2P_PEERING_OFFER', P2P_PEERING_OFFER, 'flood', 'topology', ['PeeringOffer']),
  row('P2P_SESSION_OFFER', P2P_SESSION_OFFER, 'session', 'handshake', ['SessionOffer']),
  row('P2P_SESSION_OPEN', P2P_SESSION_OPEN, 'session', 'handshake', ['SessionOpen']),
  row('P2P_SESSION_ACK', P2P_SESSION_ACK, 'session', 'handshake', []),
  row('P2P_MUSIG_START', P2P_MUSIG_START, 'directed', 'musig2', ['MusigStart']),
  row('P2P_MUSIG_ACCEPT', P2P_MUSIG_ACCEPT, 'directed', 'musig2', ['MusigAccept']),
  row('P2P_MUSIG_RECEIVE_COUNTER', P2P_MUSIG_RECEIVE_COUNTER, 'directed', 'musig2', ['MusigReceiveCounter']),
  row('P2P_MUSIG_SEND_PROPOSAL', P2P_MUSIG_SEND_PROPOSAL, 'directed', 'musig2', ['MusigSendProposal']),
  row('P2P_MUSIG_REPLY_TO_PROPOSAL', P2P_MUSIG_REPLY_TO_PROPOSAL, 'directed', 'musig2', ['MusigReplyToProposal']),
  row('P2P_MUSIG_ACCEPT_PROPOSAL', P2P_MUSIG_ACCEPT_PROPOSAL, 'directed', 'musig2', ['MusigAcceptProposal']),
  row('CONTRACT_PUBLISH', P2P_CONTRACT_PUBLISH, 'flood', 'contracts', ['P2P_CONTRACT_PUBLISH']),
  row('CONTRACT_MESSAGE', P2P_CONTRACT_MESSAGE, 'flood', 'contracts', ['P2P_CONTRACT_MESSAGE']),
  row('P2P_IDENT_REQUEST', P2P_IDENT_REQUEST, 'session', 'handshake', ['IdentityRequest']),
  row('P2P_IDENT_RESPONSE', P2P_IDENT_RESPONSE, 'session', 'handshake', ['IdentityResponse']),
  row('P2P_BASE_MESSAGE', P2P_BASE_MESSAGE, 'hub', 'carrier', ['PeerMessage']),
  row('P2P_STATE_ROOT', P2P_STATE_ROOT, 'observe', 'legacy', ['StateRoot']),
  row('P2P_STATE_COMMITTMENT', P2P_STATE_COMMITTMENT, 'observe', 'legacy', ['StateCommitment']),
  row('P2P_STATE_CHANGE', P2P_STATE_CHANGE, 'observe', 'legacy', ['StateChange']),
  row('P2P_STATE_REQUEST', P2P_STATE_REQUEST, 'observe', 'legacy', ['StateRequest']),
  row('P2P_TRANSACTION', P2P_TRANSACTION, 'observe', 'legacy', ['Transaction']),
  row('P2P_CALL', P2P_CALL, 'observe', 'legacy', ['Call']),
  row('P2P_RELAY', P2P_RELAY, 'envelope', 'mesh', []),
  row('P2P_MESSAGE_RECEIPT', P2P_MESSAGE_RECEIPT, 'hub', 'ack', []),
  row('P2P_FORWARD', P2P_FORWARD, 'directed', 'onion', []),
  row('PEER_CANDIDATE', PEER_CANDIDATE, 'observe', 'legacy', ['PeerCandidate']),
  row('SESSION_START', SESSION_START, 'session', 'legacy', ['StartSession']),
  row('CHAT_MESSAGE', CHAT_MESSAGE, 'hub', 'legacy-chat', ['ChatMessage']),
  row('P2P_CHAT_MESSAGE', P2P_CHAT_MESSAGE, 'flood', 'shoutbox', []),
  row('JSON_CALL', JSON_CALL_TYPE, 'hub', 'rpc', ['JSONCall']),
  row('JSON_PATCH', PATCH_MESSAGE_TYPE, 'hub', 'rpc', ['JSONPatch']),
  row('CONTRACT_PROPOSAL', CONTRACT_PROPOSAL_TYPE, 'flood', 'contracts', ['ContractProposal', 'P2P_CONTRACT_PROPOSAL']),
  row('P2P_START_CHAIN', P2P_START_CHAIN, 'observe', 'legacy', ['StartChain']),
  row('P2P_INSTRUCTION', P2P_INSTRUCTION, 'session', 'control', ['PeerInstruction']),
  row('LIGHTNING_INIT', LIGHTNING_INIT, 'session', 'lightning', ['LightningInit']),
  row('LIGHTNING_ERROR', LIGHTNING_ERROR, 'session', 'lightning', ['LightningError']),
  row('LIGHTNING_OPEN_CHANNEL', LIGHTNING_OPEN_CHANNEL, 'directed', 'lightning', ['OpenChannel']),
  row('LIGHTNING_ACCEPT_CHANNEL', LIGHTNING_ACCEPT_CHANNEL, 'directed', 'lightning', ['AcceptChannel']),
  row('LIGHTNING_FUNDING_CREATED', LIGHTNING_FUNDING_CREATED, 'directed', 'lightning', ['FundingCreated']),
  row('LIGHTNING_FUNDING_SIGNED', LIGHTNING_FUNDING_SIGNED, 'directed', 'lightning', ['FundingSigned']),
  row('LIGHTNING_CHANNEL_READY', LIGHTNING_CHANNEL_READY, 'directed', 'lightning', ['ChannelReady']),
  row('LIGHTNING_SHUTDOWN', LIGHTNING_SHUTDOWN, 'directed', 'lightning', ['Shutdown']),
  row('LIGHTNING_CLOSING_SIGNED', LIGHTNING_CLOSING_SIGNED, 'directed', 'lightning', ['ClosingSigned']),
  row('LIGHTNING_UPDATE_ADD_HTLC', LIGHTNING_UPDATE_ADD_HTLC, 'directed', 'lightning', ['UpdateAddHTLC']),
  row('LIGHTNING_UPDATE_FULFILL_HTLC', LIGHTNING_UPDATE_FULFILL_HTLC, 'directed', 'lightning', ['UpdateFulfillHTLC']),
  row('LIGHTNING_UPDATE_FAIL_HTLC', LIGHTNING_UPDATE_FAIL_HTLC, 'directed', 'lightning', ['UpdateFailHTLC']),
  row('LIGHTNING_COMMITMENT_SIGNED', LIGHTNING_COMMITMENT_SIGNED, 'directed', 'lightning', ['CommitmentSigned']),
  row('LIGHTNING_REVOKE_AND_ACK', LIGHTNING_REVOKE_AND_ACK, 'directed', 'lightning', ['RevokeAndAck']),
  row('LIGHTNING_CHANNEL_ANNOUNCEMENT', LIGHTNING_CHANNEL_ANNOUNCEMENT, 'observe', 'lightning-gossip', ['ChannelAnnouncement']),
  row('LIGHTNING_NODE_ANNOUNCEMENT', LIGHTNING_NODE_ANNOUNCEMENT, 'observe', 'lightning-gossip', ['NodeAnnouncement']),
  row('LIGHTNING_CHANNEL_UPDATE', LIGHTNING_CHANNEL_UPDATE, 'observe', 'lightning-gossip', ['ChannelUpdate']),
  row('LIGHTNING_WARNING', LIGHTNING_WARNING, 'session', 'lightning', ['LightningWarning']),
  row('LIGHTNING_PING', LIGHTNING_PING, 'session', 'lightning', ['LightningPing']),
  row('LIGHTNING_PONG', LIGHTNING_PONG, 'session', 'lightning', ['LightningPong'])
]);

const NAME_TO_ROW = new Map();
const OPCODE_TO_ROW = new Map();
const ALIAS_TO_NAME = new Map();
for (const entry of GOSSIP_NETWORK_TYPES) {
  NAME_TO_ROW.set(entry.name, entry);
  OPCODE_TO_ROW.set(entry.opcode, entry);
  for (const alias of entry.aliases) ALIAS_TO_NAME.set(alias, entry.name);
}

const PUBLIC_FLOOD_POLICIES = new Set(['flood', 'envelope']);

/**
 * Mesh types forwarded bit-identical (AMP author is not the TCP hop).
 * Relays never hop-re-sign these. Matches Peer pin-exemption.
 */
const RELAY_AS_IS_TYPES = new Set([
  'BITCOIN_BLOCK',
  'BitcoinBlock',
  'P2P_CHAT_MESSAGE',
  'P2P_PEER_ALIAS',
  'CONTRACT_PUBLISH',
  'CONTRACT_MESSAGE',
  'CONTRACT_PROPOSAL',
  'ContractProposal',
  P2P_PEER_GOSSIP,
  'P2P_PEER_GOSSIP',
  P2P_PEERING_OFFER,
  'P2P_PEERING_OFFER',
  'DOCUMENT_REQUEST',
  'DocumentRequest',
  'P2P_INVENTORY_REQUEST',
  'P2P_INVENTORY_RESPONSE',
  'INVENTORY_REQUEST',
  'INVENTORY_RESPONSE',
  'P2P_FORWARD',
  'P2P_RELAY'
]);

const RELAY_AS_IS_NUMERIC = new Set([
  P2P_PEER_GOSSIP,
  P2P_PEERING_OFFER,
  P2P_PEER_ALIAS,
  P2P_CHAT_MESSAGE,
  P2P_INVENTORY_REQUEST,
  P2P_INVENTORY_RESPONSE,
  DOCUMENT_REQUEST_TYPE,
  P2P_FORWARD,
  P2P_RELAY
]);

const FIRST_CLASS_OPCODE_ONLY_TYPES = new Set([
  'P2P_PEER_GOSSIP',
  'P2P_PEERING_OFFER',
  'P2P_PEER_ANNOUNCE',
  'P2P_PEER_ALIAS',
  'P2P_SESSION_OFFER',
  'P2P_SESSION_OPEN',
  'P2P_MUSIG_START',
  'P2P_MUSIG_ACCEPT',
  'P2P_MUSIG_RECEIVE_COUNTER',
  'P2P_MUSIG_SEND_PROPOSAL',
  'P2P_MUSIG_REPLY_TO_PROPOSAL',
  'P2P_MUSIG_ACCEPT_PROPOSAL',
  'MusigStart',
  'MusigAccept',
  'MusigReceiveCounter',
  'MusigSendProposal',
  'MusigReplyToProposal',
  'MusigAcceptProposal',
  'P2P_CHAT_MESSAGE',
  'CONTRACT_PUBLISH',
  'CONTRACT_MESSAGE',
  'CONTRACT_PROPOSAL',
  'P2P_INVENTORY_REQUEST',
  'P2P_INVENTORY_RESPONSE',
  'INVENTORY_REQUEST',
  'INVENTORY_RESPONSE',
  'P2P_FILE_SEND',
  'P2P_DOCUMENT_PUBLISH',
  'P2P_FLUSH_CHAIN',
  'FlushChain',
  'BitcoinBlock',
  'BITCOIN_BLOCK'
]);

/**
 * @param {string|number|null|undefined} type
 * @returns {object|null}
 */
function lookupGossipType (type) {
  if (type == null) return null;
  if (typeof type === 'number') return OPCODE_TO_ROW.get(type) || null;
  const name = String(type);
  if (NAME_TO_ROW.has(name)) return NAME_TO_ROW.get(name);
  const aliased = ALIAS_TO_NAME.get(name);
  return aliased ? NAME_TO_ROW.get(aliased) : null;
}

/**
 * @param {string|number|null|undefined} type
 * @returns {string} policy or `unknown`
 */
function classifyGossipWireType (type) {
  const found = lookupGossipType(type);
  return found ? found.policy : 'unknown';
}

/**
 * True when Peer mesh-floods this type on the public gossip network
 * (`flood` or the `P2P_RELAY` envelope). Opt-in inventory and trusted
 * `FLUSH_CHAIN` are excluded.
 *
 * @param {string|number|null|undefined} type
 * @returns {boolean}
 */
function isPublicGossipFloodType (type) {
  return PUBLIC_FLOOD_POLICIES.has(classifyGossipWireType(type));
}

/**
 * @param {string|number|null|undefined} type
 * @returns {boolean}
 */
function isRelayAsIsWireType (type) {
  if (type == null) return false;
  if (typeof type === 'number') return RELAY_AS_IS_NUMERIC.has(type);
  return RELAY_AS_IS_TYPES.has(String(type));
}

/**
 * @param {string|null|undefined} type
 * @returns {boolean}
 */
function isFirstClassOpcodeOnlyType (type) {
  if (type == null) return false;
  return FIRST_CLASS_OPCODE_ONLY_TYPES.has(String(type));
}

/**
 * Decode names Peer mesh-floods on the public network (including `P2P_RELAY`).
 * @returns {string[]}
 */
function listPublicGossipFloodNames () {
  return GOSSIP_NETWORK_TYPES
    .filter((entry) => PUBLIC_FLOOD_POLICIES.has(entry.policy))
    .map((entry) => entry.name);
}

/**
 * Validate AMP size, body hash, and BIP-340 author signature.
 * Does not apply type-specific hop/budget rules (those stay on Peer).
 *
 * @param {Buffer|Uint8Array} buffer
 * @param {Object} [opts]
 * @param {number} [opts.maxBodySize]
 * @returns {{ ok: boolean, type?: string, policy?: string, flood?: boolean, signerPubkeyHex?: string, error?: string }}
 */
function validateGossipFrame (buffer, opts = {}) {
  const Message = require('../types/message');
  const Hash256 = require('../types/hash256');
  const Key = require('../types/key');

  let wire = buffer;
  if (!Buffer.isBuffer(wire)) {
    if (wire instanceof Uint8Array) wire = Buffer.from(wire);
    else return { ok: false, error: 'not a buffer' };
  }
  const maxBody = Number(opts.maxBodySize);
  const bodyCap = Number.isFinite(maxBody) && maxBody > 0 ? maxBody : MAX_MESSAGE_SIZE;
  const maxWire = HEADER_SIZE + bodyCap;
  if (wire.length > maxWire) return { ok: false, error: 'oversized' };
  if (wire.length < HEADER_SIZE) return { ok: false, error: 'undersize' };

  let message;
  try {
    message = Message.fromBuffer(wire);
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : 'unparseable' };
  }
  if (!message) return { ok: false, error: 'unparseable' };

  const bodyBuf = message.raw.data || Buffer.alloc(0);
  const checksum = Hash256.doubleDigest(bodyBuf);
  const expectedHash = Buffer.isBuffer(message.raw.hash)
    ? message.raw.hash.toString('hex')
    : message.raw.hash;
  if (checksum !== expectedHash) return { ok: false, type: message.type, error: 'body-hash-mismatch' };

  const author = message.raw.author;
  if (!author) return { ok: false, type: message.type, error: 'missing-author' };
  const authorHex = Buffer.isBuffer(author) ? author.toString('hex') : String(author);
  const xOnly = authorHex.length === 66 ? authorHex.slice(2).toLowerCase() : authorHex.toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(xOnly)) {
    return { ok: false, type: message.type, error: 'invalid-author' };
  }
  try {
    const signer = new Key({ public: `02${xOnly}` });
    if (!message.verifyWithKey(signer)) {
      return { ok: false, type: message.type, error: 'invalid-signature' };
    }
  } catch (err) {
    return { ok: false, type: message.type, error: err && err.message ? err.message : 'invalid-signature' };
  }

  const policy = classifyGossipWireType(message.type);
  return {
    ok: true,
    type: message.type,
    policy,
    flood: PUBLIC_FLOOD_POLICIES.has(policy),
    signerPubkeyHex: xOnly
  };
}

/**
 * Peer constructor settings for a validate-and-relay-only node:
 * one {@link Peer}, no document fulfill, no inventory amplify, no contract
 * state accumulate. Session handshake + gossip flood still run.
 *
 * @param {Object} [overrides]
 * @returns {Object}
 */
function gossipRelayPeerSettings (overrides = {}) {
  const extra = (overrides && typeof overrides === 'object') ? overrides : {};
  const extraPeers = extra.constraints && extra.constraints.peers;
  const extraMusig = extra.musig2;
  const base = {
    listen: true,
    networking: true,
    upnp: false,
    peers: [],
    peersDb: (process.env.NODE_ENV === 'test') ? null : 'stores/gossip-relay/peers',
    port: 7777,
    constraints: { peers: { max: MAX_PEERS, shuffle: 8 } },
    serveLocalDocumentInventory: false,
    autoFulfillDocumentRequests: false,
    announceDocumentsOnPeerConnect: false,
    relayInventoryRequest: false,
    relayInventoryResponse: false,
    relayPrivateDocumentRequests: false,
    registerInboundContracts: false,
    reconnectToKnownPeers: true,
    musig2: { autoAccept: false }
  };
  const merged = Object.assign({}, base, extra);
  merged.constraints = {
    peers: Object.assign({}, base.constraints.peers, extraPeers || {})
  };
  merged.musig2 = Object.assign({}, base.musig2, extraMusig || {});
  return merged;
}

module.exports = {
  GOSSIP_NETWORK_TYPES,
  RELAY_AS_IS_TYPES,
  RELAY_AS_IS_NUMERIC,
  FIRST_CLASS_OPCODE_ONLY_TYPES,
  lookupGossipType,
  classifyGossipWireType,
  isPublicGossipFloodType,
  isRelayAsIsWireType,
  isFirstClassOpcodeOnlyType,
  listPublicGossipFloodNames,
  validateGossipFrame,
  gossipRelayPeerSettings
};
