'use strict';

/**
 * Fabric application namespaces — the common outer + contract-body type set
 * shared by Hub, GoonCitizen, Sensemaker, and other downstream apps.
 *
 * Model (see docs/APPLICATION_NAMESPACES.md):
 *   1. Global shoutbox — P2P_CHAT_MESSAGE (not contract-namespaced)
 *   2. Gossip — CONTRACT_PUBLISH / CONTRACT_MESSAGE (P2P_CONTRACT_* aliases)
 *   3. Apps ignore CONTRACT_MESSAGE frames for unknown contract ids
 *   4. Federation-shaped contracts carry a validator convergent timeline
 *
 * Outer opcodes live in constants.js / types/message.js. This module only
 * catalogs **names** and **contract body `type` strings** so apps converge.
 */

const {
  P2P_CHAT_MESSAGE,
  P2P_CONTRACT_PUBLISH,
  P2P_CONTRACT_MESSAGE,
  CONTRACT_PROPOSAL_TYPE,
  CHAT_MESSAGE
} = require('../constants');

/** Outer wire types for the application-namespace flow. */
const OUTER = Object.freeze({
  /** Network-wide shoutbox (author-signed; Peer relays). */
  P2P_CHAT_MESSAGE: 'P2P_CHAT_MESSAGE',
  /** Legacy chat opcode (0x67); prefer P2P_CHAT_MESSAGE for mesh. */
  CHAT_MESSAGE: 'ChatMessage',
  /** Publish an application / Federation genesis → namespace id. */
  CONTRACT_PUBLISH: 'CONTRACT_PUBLISH',
  /** Namespaced app event; body.contract required. */
  CONTRACT_MESSAGE: 'CONTRACT_MESSAGE',
  /** Batched contract proposal (escrow / payout / patches). */
  CONTRACT_PROPOSAL: 'CONTRACT_PROPOSAL'
});

/** Opcode aliases accepted by Message.fromVector (same numeric codes). */
const OUTER_ALIASES = Object.freeze({
  P2P_CONTRACT_PUBLISH: 'P2P_CONTRACT_PUBLISH',
  P2P_CONTRACT_MESSAGE: 'P2P_CONTRACT_MESSAGE',
  P2P_CONTRACT_PROPOSAL: 'P2P_CONTRACT_PROPOSAL',
  ChatMessage: 'ChatMessage'
});

/**
 * Shared CONTRACT_MESSAGE body `type` values (app domain, not outer opcodes).
 * Apps MAY define additional types under their own contract namespace; these
 * are the ones multiple products already agree on.
 */
const CONTRACT_BODY_TYPES = Object.freeze({
  // Hub / Federation (invite JSON also rides chat in some Hub UI paths)
  FederationContractInvite: 'FederationContractInvite',
  FederationContractInviteResponse: 'FederationContractInviteResponse',
  // GoonCitizen — network-wide (GoonCitizen genesis contract)
  MissionCreated: 'MissionCreated',
  MissionBroadcast: 'MissionBroadcast',
  SCEventBatch: 'SCEventBatch',
  /** Cumulative analytics snapshot for Hub / Beacon seal (not frozen into Actor id). */
  GameStateSnapshot: 'GameStateSnapshot',
  // GoonCitizen — per-Group Federation contract
  GroupChat: 'GroupChat',
  GroupChange: 'GroupChange',
  GroupShare: 'GroupShare'
});

/**
 * GenericMessage / activity `type` strings shared across Hub Beacon Federation
 * and app operators (not outer opcodes; not necessarily CONTRACT_MESSAGE bodies).
 */
const ACTIVITY_TYPES = Object.freeze({
  FederationSignRequest: 'FederationSignRequest',
  FederationSignResponse: 'FederationSignResponse',
  GameStateSnapshot: 'GameStateSnapshot'
});

/** Fabric log / activity type names for contract namespace events. */
const LOG_TYPES = Object.freeze({
  ContractPublish: 'ContractPublish',
  ContractMessage: 'ContractMessage'
});

const OUTER_OPCODES = Object.freeze({
  P2P_CHAT_MESSAGE,
  CHAT_MESSAGE,
  CONTRACT_PUBLISH: P2P_CONTRACT_PUBLISH,
  CONTRACT_MESSAGE: P2P_CONTRACT_MESSAGE,
  CONTRACT_PROPOSAL: CONTRACT_PROPOSAL_TYPE
});

/**
 * True when `name` is a preferred outer type for app-namespace mesh traffic.
 * @param {string} name
 * @returns {boolean}
 */
function isApplicationOuterType (name) {
  const n = String(name || '');
  return n === OUTER.P2P_CHAT_MESSAGE
    || n === OUTER.CONTRACT_PUBLISH
    || n === OUTER.CONTRACT_MESSAGE
    || n === OUTER.CONTRACT_PROPOSAL
    || n === OUTER_ALIASES.P2P_CONTRACT_PUBLISH
    || n === OUTER_ALIASES.P2P_CONTRACT_MESSAGE
    || n === OUTER_ALIASES.P2P_CONTRACT_PROPOSAL;
}

/**
 * True when `type` is a known shared CONTRACT_MESSAGE body type.
 * @param {string} type
 * @returns {boolean}
 */
function isKnownContractBodyType (type) {
  return Object.prototype.hasOwnProperty.call(CONTRACT_BODY_TYPES, String(type || ''));
}

module.exports = {
  OUTER,
  OUTER_ALIASES,
  OUTER_OPCODES,
  CONTRACT_BODY_TYPES,
  ACTIVITY_TYPES,
  LOG_TYPES,
  isApplicationOuterType,
  isKnownContractBodyType
};
