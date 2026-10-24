'use strict';

/**
 * @fileoverview Typed V1 field bodies ↔ legacy JSON objects for the protocol
 * opcodes whose field schemas live in `types/message.js`.
 *
 * Senders use {@link buildMessage} to put typed fields on the wire. Receivers use
 * {@link tryParseLegacyBody} (or {@link decodeToLegacyBody}) so handlers and app
 * events keep seeing the JSON object shape they saw before, whichever encoding
 * the peer sent. JSON bodies are still accepted during the deprecation window
 * (see `docs/MESSAGE_BODY_MIGRATION.md`).
 *
 * @module functions/fabricMessageBodies
 */

const Message = require('../types/message');
const { GOSSIP_MAX_HOPS, PEERING_OFFER_MAX_HOPS } = require('../constants');
const { fabricCanonicalJson, jsonSafe } = require('./fabricCanonicalJson');

/** @private */
const SIDECHAIN_PATCH_KIND = 'SidechainStatePatch';
/** @private */
const ZERO_DIGEST_HEX = '0'.repeat(64);
/** @private */
const MAX_UINT32 = (2 ** 32) - 1;

/**
 * Wire names this module maps.
 * @type {string[]}
 */
const LEGACY_BODY_TYPES = Object.freeze([
  'P2P_PING',
  'P2P_PONG',
  'P2P_PEER_ANNOUNCE',
  'P2P_PEER_GOSSIP',
  'P2P_PEERING_OFFER',
  'CONTRACT_PUBLISH',
  'CONTRACT_MESSAGE',
  'SIDECHAIN_STATE_PATCH'
]);

/**
 * @private
 * @param {string|number} type
 * @returns {string|null}
 */
function wireName (type) {
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
function str (value) {
  if (value == null || typeof value === 'object') return '';
  return String(value);
}

/**
 * @private
 * @param {*} value
 * @returns {number}
 */
function port (value) {
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
function hop (value, max) {
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
function compact (obj, zeroIsAbsent = []) {
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
 * Map a legacy JSON body to the typed field object for `type`.
 * @param {string|number} type Wire name, friendly alias, or opcode.
 * @param {object} body Legacy JSON body.
 * @returns {object} Field object for `Message.fromFields`.
 */
function encodeLegacyBody (type, body) {
  const name = wireName(type);
  if (!name) throw new TypeError(`encodeLegacyBody: no field mapping for ${type}`);
  const b = isPlainObject(body) ? body : {};

  switch (name) {
    case 'P2P_PING':
    case 'P2P_PONG':
      return { nonce: str(b.nonce != null ? b.nonce : b.created) };
    case 'P2P_PEER_ANNOUNCE': {
      const o = peeringObject(b);
      return { host: str(o.host), port: port(o.port), pubkey: str(o.pubkey), nonce: str(o.nonce) };
    }
    case 'P2P_PEER_GOSSIP': {
      const o = peeringObject(b);
      return {
        host: str(o.host),
        port: port(o.port),
        gossipHop: hop(o.gossipHop, GOSSIP_MAX_HOPS),
        nonce: str(o.nonce),
        pubkey: str(o.pubkey)
      };
    }
    case 'P2P_PEERING_OFFER': {
      const o = peeringObject(b);
      return {
        transport: str(o.transport),
        host: str(o.host),
        port: port(o.port),
        peeringHop: hop(o.peeringHop, PEERING_OFFER_MAX_HOPS),
        pubkey: str(o.pubkey),
        slots: port(o.slots),
        peering: str(o.peering),
        nonce: str(o.nonce)
      };
    }
    // Key order is kept (not sorted): `Actor` ids hash insertion-ordered JSON,
    // so the namespace id must match a JSON publish of the same object.
    case 'CONTRACT_PUBLISH':
      if (!isPlainObject(body)) throw new TypeError('CONTRACT_PUBLISH body must be an object');
      return { definition: JSON.stringify(body) };
    case 'CONTRACT_MESSAGE': {
      const contract = str(b.contract).trim();
      if (!contract) throw new TypeError('CONTRACT_MESSAGE body requires contract');
      const rest = Object.assign({}, b);
      delete rest.contract;
      return { contract, payload: JSON.stringify(rest) };
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
 * @param {string|number} type Wire name, friendly alias, or opcode.
 * @param {object} fields Output of `decodeBody` / `message.toFields()`.
 * @returns {object|null} Legacy body, or `null` when the fields are unusable.
 */
function decodeToLegacyBody (type, fields) {
  const name = wireName(type);
  if (!name || !isPlainObject(fields)) return null;
  const f = fields;

  switch (name) {
    case 'P2P_PING':
    case 'P2P_PONG':
      return compact({ nonce: f.nonce });
    case 'P2P_PEER_ANNOUNCE':
      return compact({ host: f.host, port: f.port, pubkey: f.pubkey, nonce: f.nonce });
    case 'P2P_PEER_GOSSIP':
      return compact({ host: f.host, port: f.port, gossipHop: f.gossipHop, nonce: f.nonce, pubkey: f.pubkey });
    case 'P2P_PEERING_OFFER':
      return compact({
        transport: f.transport,
        host: f.host,
        port: f.port,
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
      const contract = str(f.contract).trim();
      if (!contract) return null;
      const payload = f.payload ? parseJsonOrUndefined(f.payload) : {};
      if (!isPlainObject(payload)) return null;
      // `contract` first, as JSON senders write it; the field value always wins.
      return Object.assign({ contract }, payload, { contract });
    }
    case 'SIDECHAIN_STATE_PATCH': {
      const digestHex = Buffer.isBuffer(f.basisDigest) ? f.basisDigest.toString('hex') : str(f.basisDigest);
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
 * @param {string|number} type
 * @param {object} body Legacy JSON body.
 * @param {object} [opts] Extra `Message` constructor settings.
 * @returns {Message}
 */
function buildMessage (type, body, opts = {}) {
  const name = wireName(type);
  if (!name) throw new TypeError(`buildMessage: no field mapping for ${type}`);
  return Message.fromFields(name, encodeLegacyBody(name, body), opts);
}

/**
 * Parse a message body into its legacy JSON shape, from either encoding.
 * @param {Message} message
 * @returns {{ ok: true, value: object, encoding: 'json'|'fields' }|{ ok: false, error: Error }}
 */
function tryParseLegacyBody (message) {
  const parsed = Message.tryParseMessageBody(message);
  if (!parsed.ok) return parsed;
  if (parsed.encoding !== 'fields') return parsed;
  const value = decodeToLegacyBody(message.type, parsed.value);
  if (!value) return { ok: false, error: new TypeError(`unusable ${message.type} field body`) };
  return { ok: true, value, encoding: 'fields' };
}

/**
 * Encoding-independent object for dedup and registration keys of peering
 * bodies (gossip / offer / announce): sorted keys, empty values dropped,
 * numeric `port`, and the hop counters removed.
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
    if (key === 'port' || key === 'slots') {
      v = port(v);
      if (v === 0 && key === 'slots') continue;
    }
    out[key] = v;
  }
  return out;
}

module.exports = {
  LEGACY_BODY_TYPES,
  encodeLegacyBody,
  decodeToLegacyBody,
  buildMessage,
  tryParseLegacyBody,
  canonicalPeeringObject
};
