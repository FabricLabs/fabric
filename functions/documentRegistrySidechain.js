'use strict';

/**
 * Document catalog → global sidechain registry (opcode / typed-field path).
 *
 * Public API speaks **fields** (basisClock, basisDigestHex, catalogCanonical).
 * Internal state mutation may reduce those fields to content updates; HTTP may
 * map RFC6902 JSON ↔ the same fields via `@fabric/http` messageBodyJsonBridge.
 *
 * @module functions/documentRegistrySidechain
 */

const crypto = require('crypto');
const { SIDECHAIN_STATE_PATCH_TYPE: SIDECHAIN_STATE_PATCH_OPCODE } = require('../constants');
const fabricCanonicalJson = require('./fabricCanonicalJson');
const sidechainState = require('./sidechainState');
const {
  registerBodySchema,
  getBodySchema,
  encodeBody,
  decodeBody
} = require('../types/message');

const REGISTRY_PATH = '/registry';
const SIDECHAIN_STATE_PATCH_TYPE = sidechainState.SIDECHAIN_STATE_PATCH_TYPE;

/** V1 field layout for SIDECHAIN_STATE_PATCH (catalog-oriented). */
const SCHEMA_SIDECHAIN_STATE_PATCH = Object.freeze([
  { name: 'basisClock', type: 'u32' },
  { name: 'basisDigest', type: 'bytes32' },
  { name: 'catalogCanonical', type: 'string' }
]);

function _installSchema () {
  if (getBodySchema(SIDECHAIN_STATE_PATCH_TYPE)) return;
  registerBodySchema(SIDECHAIN_STATE_PATCH_TYPE, SCHEMA_SIDECHAIN_STATE_PATCH);
  registerBodySchema('SidechainStatePatch', SCHEMA_SIDECHAIN_STATE_PATCH);
  if (SIDECHAIN_STATE_PATCH_OPCODE != null) {
    registerBodySchema(SIDECHAIN_STATE_PATCH_OPCODE, SCHEMA_SIDECHAIN_STATE_PATCH);
  }
}

_installSchema();

/**
 * Normalize inventory / DocumentPublish summaries into a registry catalog object.
 * @param {Array<object>|object} items
 * @returns {{ version: number, documents: object, sellerCount: number, updatedAt: string }}
 */
function buildRegistryCatalog (items = []) {
  const list = Array.isArray(items) ? items : [];
  const documents = Object.create(null);
  const sellers = new Set();
  for (const row of list) {
    if (!row || typeof row !== 'object') continue;
    const id = String(row.id || row.documentId || row.name || '').trim();
    if (!id) continue;
    const sellerId = row.sellerId != null ? String(row.sellerId) : (row.origin || null);
    if (sellerId) sellers.add(sellerId);
    const prev = documents[id] || { id, sellers: [], rateSats: null, contentHash: null };
    if (sellerId && !prev.sellers.includes(sellerId)) prev.sellers.push(sellerId);
    if (row.rateSats != null && Number.isFinite(Number(row.rateSats))) {
      prev.rateSats = Number(row.rateSats);
    }
    if (row.contentHash || row.contentHashHex) {
      prev.contentHash = String(row.contentHash || row.contentHashHex).toLowerCase();
    }
    documents[id] = prev;
  }
  return {
    version: 1,
    documents,
    sellerCount: sellers.size,
    updatedAt: new Date().toISOString()
  };
}

/**
 * Field struct for a registry update (same names as body schema).
 * @param {object} state current sidechain STATE
 * @param {object} catalog from {@link buildRegistryCatalog}
 * @returns {{ basisClock: number, basisDigest: Buffer, catalogCanonical: string }}
 */
function encodeRegistryUpdateFields (state, catalog) {
  const basisClock = Number(state && state.clock) || 0;
  const digestHex = sidechainState.stateDigest(state || sidechainState.createInitialState());
  return {
    basisClock,
    basisDigest: Buffer.from(digestHex, 'hex'),
    catalogCanonical: fabricCanonicalJson(catalog)
  };
}

/**
 * @param {object} fields
 * @returns {Buffer}
 */
function encodeRegistryUpdateBody (fields) {
  _installSchema();
  return encodeBody(SCHEMA_SIDECHAIN_STATE_PATCH, fields);
}

/**
 * @param {Buffer} body
 * @returns {object}
 */
function decodeRegistryUpdateBody (body) {
  _installSchema();
  return decodeBody(SCHEMA_SIDECHAIN_STATE_PATCH, body);
}

/**
 * Apply typed registry fields onto a sidechain STATE document.
 * @param {object} state
 * @param {{ basisClock?: number, basisDigest?: Buffer|string, catalogCanonical: string }} fields
 * @param {object|null} [policy]
 * @returns {{ ok: boolean, state?: object, stateDigest?: string, error?: string, basisDigest?: string }}
 */
function applyRegistryUpdateFields (state, fields, policy = null) {
  if (!fields || typeof fields.catalogCanonical !== 'string' || !fields.catalogCanonical) {
    return { ok: false, error: 'catalogCanonical required' };
  }
  let catalog;
  try {
    catalog = JSON.parse(fields.catalogCanonical);
  } catch (err) {
    return { ok: false, error: 'catalogCanonical must be JSON' };
  }
  if (!catalog || typeof catalog !== 'object') {
    return { ok: false, error: 'invalid catalog' };
  }

  const current = state || sidechainState.createInitialState();
  const basisClock = fields.basisClock != null ? Number(fields.basisClock) : Number(current.clock) || 0;
  if (basisClock !== (Number(current.clock) || 0)) {
    return { ok: false, error: `basisClock mismatch: expected ${current.clock}, got ${basisClock}` };
  }
  if (fields.basisDigest) {
    const expected = sidechainState.stateDigest(current);
    const got = Buffer.isBuffer(fields.basisDigest)
      ? fields.basisDigest.toString('hex')
      : String(fields.basisDigest).toLowerCase();
    if (got !== expected) {
      return { ok: false, error: 'basisDigest mismatch' };
    }
  }

  // Internal reducer: content replace at /registry (HTTP may present this as RFC6902).
  const patches = [{ op: current.content && current.content.registry ? 'replace' : 'add', path: REGISTRY_PATH, value: catalog }];
  const applied = sidechainState.applyPatchesToState(current, patches, policy);
  if (!applied.ok) return applied;
  return {
    ok: true,
    state: applied.state,
    stateDigest: applied.newDigest,
    basisDigest: applied.basisDigest
  };
}

/**
 * Convenience: inventory rows → apply → { state, stateDigest, fields, body }.
 * @param {object} state
 * @param {Array<object>} items
 * @param {object|null} [policy]
 */
function applyInventoryToRegistry (state, items, policy = null) {
  const catalog = buildRegistryCatalog(items);
  const fields = encodeRegistryUpdateFields(state || sidechainState.createInitialState(), catalog);
  const applied = applyRegistryUpdateFields(state, fields, policy);
  if (!applied.ok) return applied;
  // Wire body is optional: local STATE may exceed MAX_MESSAGE_SIZE; callers that
  // gossip SIDECHAIN_STATE_PATCH must re-encode a wire-sized delta themselves.
  let body = null;
  let bodyError = null;
  try {
    body = encodeRegistryUpdateBody(fields);
  } catch (err) {
    bodyError = err && (err.message || String(err));
  }
  return {
    ok: true,
    state: applied.state,
    stateDigest: applied.stateDigest,
    fields,
    body,
    bodyError,
    catalog
  };
}

/**
 * Digest hex helper for tests / Beacon hooks.
 * @param {Buffer|string} digest
 * @returns {string}
 */
function digestToHex (digest) {
  if (Buffer.isBuffer(digest)) return digest.toString('hex');
  return String(digest || '').toLowerCase();
}

module.exports = {
  REGISTRY_PATH,
  SIDECHAIN_STATE_PATCH_TYPE,
  SCHEMA_SIDECHAIN_STATE_PATCH,
  buildRegistryCatalog,
  encodeRegistryUpdateFields,
  encodeRegistryUpdateBody,
  decodeRegistryUpdateBody,
  applyRegistryUpdateFields,
  applyInventoryToRegistry,
  digestToHex,
  /** @deprecated alias — prefer applyRegistryUpdateFields */
  sha256Hex (buf) {
    return crypto.createHash('sha256').update(buf).digest('hex');
  }
};
