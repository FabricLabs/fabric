'use strict';

const constants = require('../constants');

const BITCOIN_PRIMITIVE_PREFIXES = Object.freeze([
  'OP_'
]);

const FABRIC_OPCODE_PREFIXES = Object.freeze([
  'P2P_',
  'LIGHTNING_'
]);

const FABRIC_OPCODE_EXACT = Object.freeze([
  'BITCOIN_BLOCK_TYPE',
  'BITCOIN_BLOCK_HASH_TYPE',
  'BITCOIN_TRANSACTION_TYPE',
  'BITCOIN_TRANSACTION_HASH_TYPE',
  'LOG_MESSAGE_TYPE',
  'GENERIC_LIST_TYPE',
  'DOCUMENT_PUBLISH_TYPE',
  'DOCUMENT_REQUEST_TYPE',
  'JSON_CALL_TYPE',
  'PATCH_MESSAGE_TYPE',
  'CONTRACT_PROPOSAL_TYPE',
  'BLOCK_CANDIDATE',
  'PEER_CANDIDATE',
  'SESSION_START',
  'CHAT_MESSAGE'
]);

function classifyConstantName (name) {
  if (!name || typeof name !== 'string') return null;
  if (BITCOIN_PRIMITIVE_PREFIXES.some((prefix) => name.startsWith(prefix))) return 'bitcoin';
  if (FABRIC_OPCODE_PREFIXES.some((prefix) => name.startsWith(prefix))) return 'fabric';
  if (FABRIC_OPCODE_EXACT.includes(name)) return 'fabric';
  return null;
}

function normalizeOpcodeName (name) {
  return String(name || '').trim().toUpperCase();
}

function normalizePubkeyHex (value) {
  const raw = String(value || '').trim().toLowerCase().replace(/^0x/, '');
  if (!raw) return '';
  if (/^[0-9a-f]{64}$/.test(raw)) return raw;
  if (/^(02|03)[0-9a-f]{64}$/.test(raw)) return raw.slice(2);
  return '';
}

function createDefaultOpcodeRegistry () {
  const registry = {};
  for (const [name, value] of Object.entries(constants)) {
    const family = classifyConstantName(name);
    if (!family) continue;
    registry[name] = {
      name,
      family,
      enabled: true,
      code: value
    };
  }
  return registry;
}

function defineOpcode (registry, name, definition = {}) {
  if (!registry || typeof registry !== 'object') throw new Error('Registry object is required.');
  const opcode = normalizeOpcodeName(name);
  if (!opcode) throw new Error('Opcode name is required.');

  const next = Object.assign({
    name: opcode,
    family: definition.family || 'fabric',
    enabled: definition.enabled !== false,
    code: (typeof definition.code !== 'undefined') ? definition.code : null,
    body: definition.body || null,
    author: definition.author || null,
    policy: definition.policy || null
  }, definition, { name: opcode });

  registry[opcode] = next;
  return next;
}

function parseOpcodeContractBody (body = '') {
  const text = String(body || '');
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

function resolveOpcodeContract (registry, body = '') {
  const lines = parseOpcodeContractBody(body).map(normalizeOpcodeName);
  const resolved = [];
  const unknown = [];
  for (const op of lines) {
    if (registry && registry[op] && registry[op].enabled !== false) {
      resolved.push(registry[op]);
    } else {
      unknown.push(op);
    }
  }

  return { lines, resolved, unknown };
}

module.exports = {
  createDefaultOpcodeRegistry,
  defineOpcode,
  parseOpcodeContractBody,
  resolveOpcodeContract,
  normalizeOpcodeName,
  normalizePubkeyHex
};
