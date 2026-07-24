'use strict';

/**
 * C-like AMP Message body codec (Fabric V1).
 *
 * Bodies are ordered typed fields (big-endian), not JSON. JSON bridging belongs
 * in `@fabric/http`. See docs/MESSAGE_BODY.md.
 *
 * @module functions/messageBodyCodec
 */

const {
  MAX_MESSAGE_SIZE,
  P2P_PING,
  P2P_PONG,
  P2P_CHAT_MESSAGE
} = require('../constants');

const FIELD_TYPES = Object.freeze([
  'u8',
  'u16',
  'u32',
  'u64',
  'bytes32',
  'bytes',
  'string',
  'message'
]);

/**
 * @typedef {{ name: string, type: string }} BodyField
 * @typedef {BodyField[]} BodySchema
 */

/** @type {Map<number|string, BodySchema>} */
const SCHEMA_BY_KEY = new Map();

/**
 * @param {number|string} opcodeOrName
 * @param {BodySchema} schema
 */
function registerBodySchema (opcodeOrName, schema) {
  if (!Array.isArray(schema)) throw new TypeError('schema must be an array');
  for (const f of schema) {
    if (!f || typeof f.name !== 'string' || !FIELD_TYPES.includes(f.type)) {
      throw new TypeError(`invalid field: ${JSON.stringify(f)}`);
    }
  }
  SCHEMA_BY_KEY.set(opcodeOrName, schema.slice());
  if (typeof opcodeOrName === 'number') {
    /* also allow lookup by number alone */
  }
}

/**
 * @param {number|string|null|undefined} opcodeOrName
 * @returns {BodySchema|null}
 */
function getBodySchema (opcodeOrName) {
  if (opcodeOrName == null) return null;
  if (SCHEMA_BY_KEY.has(opcodeOrName)) return SCHEMA_BY_KEY.get(opcodeOrName);
  if (typeof opcodeOrName === 'string') {
    const upper = opcodeOrName.toUpperCase();
    if (SCHEMA_BY_KEY.has(upper)) return SCHEMA_BY_KEY.get(upper);
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
 * @param {BodySchema} schema
 * @param {object} fields
 * @returns {Buffer}
 */
function encodeBody (schema, fields = {}) {
  if (!Array.isArray(schema)) throw new TypeError('schema required');
  const chunks = [];
  let total = 0;

  for (const def of schema) {
    const name = def.name;
    const value = fields[name];
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
 * @param {BodySchema} schema
 * @param {Buffer} buffer
 * @returns {object}
 */
function decodeBody (schema, buffer) {
  if (!Array.isArray(schema)) throw new TypeError('schema required');
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  const out = {};
  let offset = 0;

  for (const def of schema) {
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

/** Example / starter schemas (extend as opcodes migrate off JSON). */
const SCHEMA_P2P_PING = Object.freeze([
  { name: 'nonce', type: 'string' }
]);

const SCHEMA_P2P_CHAT = Object.freeze([
  { name: 'channel', type: 'string' },
  { name: 'content', type: 'string' },
  { name: 'timestamp', type: 'string' }
]);

const SCHEMA_PROGRAM_RUN = Object.freeze([
  { name: 'programHash', type: 'bytes32' },
  { name: 'runCommitment', type: 'bytes32' },
  { name: 'resultHint', type: 'string' }
]);

function _installDefaults () {
  registerBodySchema(P2P_PING, SCHEMA_P2P_PING);
  registerBodySchema('P2P_PING', SCHEMA_P2P_PING);
  registerBodySchema('Ping', SCHEMA_P2P_PING);
  registerBodySchema(P2P_PONG, SCHEMA_P2P_PING);
  registerBodySchema('P2P_PONG', SCHEMA_P2P_PING);
  registerBodySchema('Pong', SCHEMA_P2P_PING);
  registerBodySchema(P2P_CHAT_MESSAGE, SCHEMA_P2P_CHAT);
  registerBodySchema('P2P_CHAT_MESSAGE', SCHEMA_P2P_CHAT);
  // Do not bind 'ChatMessage' here — that friendly name maps to CHAT_MESSAGE and
  // still carries legacy JSON object bodies in Hub / Peer.
  registerBodySchema('FabricProgramRun', SCHEMA_PROGRAM_RUN);
}

_installDefaults();

module.exports = {
  FIELD_TYPES,
  MAX_MESSAGE_SIZE,
  registerBodySchema,
  getBodySchema,
  encodeBody,
  decodeBody,
  SCHEMA_P2P_PING,
  SCHEMA_P2P_CHAT,
  SCHEMA_PROGRAM_RUN
};
