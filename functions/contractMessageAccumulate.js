'use strict';

/**
 * Tip-bound / opaque Application Resource Contract message accumulation.
 *
 * Publisher and participants ingest the same signed Fabric Message bytes from
 * any origin (mesh, hub queue, copy-paste). Identity is the AMP body hash;
 * fold order is sorted by hash so arrival order does not change tip state.
 *
 * @module functions/contractMessageAccumulate
 */

const crypto = require('crypto');
const Message = require('../types/message');
const Key = require('../types/key');
const { OUTER } = require('./applicationNamespaces');
const { pubkeyXOnly } = require('./groupChatSeal');

const COLLECTION = 'contractmessages';
const ORIGINS = Object.freeze(['mesh', 'queue', 'paste', 'local']);

function normalizeContractId (contractId) {
  const id = String(contractId || '').trim().toLowerCase();
  if (!id || id.includes('/') || id.includes('..') || id.length > 128) {
    throw new Error('invalid contractId');
  }
  return id;
}

function _canonicalStringify (value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(_canonicalStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${_canonicalStringify(value[k])}`).join(',')}}`;
}

/**
 * @param {{ version?: number, clock?: number, content?: object }} state
 * @returns {string}
 */
function stateDigest (state) {
  return crypto.createHash('sha256').update(_canonicalStringify({
    version: state && state.version != null ? Number(state.version) : 1,
    clock: Number(state && state.clock) || 0,
    content: (state && state.content) || {}
  })).digest('hex');
}

/**
 * Parse `fabric:<hex>` or raw hex into a Buffer.
 * @param {string|Buffer} input
 * @returns {Buffer}
 */
function bufferFromPaste (input) {
  if (Buffer.isBuffer(input)) return input;
  let s = String(input || '').trim();
  if (/^fabric:/i.test(s)) s = s.slice(s.indexOf(':') + 1);
  s = s.replace(/^0x/i, '').replace(/\s+/g, '');
  if (!/^[0-9a-fA-F]+$/.test(s) || s.length % 2 !== 0) {
    throw new Error('invalid fabric message hex');
  }
  return Buffer.from(s, 'hex');
}

function messageHashHex (msg) {
  const h = msg && msg.raw && msg.raw.hash;
  if (Buffer.isBuffer(h)) return h.toString('hex');
  return String(h || '').toLowerCase();
}

function authorXOnlyHex (msg) {
  const a = msg && msg.raw && msg.raw.author;
  if (Buffer.isBuffer(a)) return a.toString('hex');
  return String(a || '').toLowerCase();
}

/**
 * Verify BIP340 Fabric/Message signature using the frame’s author field.
 * @param {Message} msg
 * @returns {boolean}
 */
function verifyMessageSignature (msg) {
  const xOnly = authorXOnlyHex(msg);
  if (!/^[0-9a-f]{64}$/.test(xOnly)) return false;
  try {
    const signer = new Key({ public: `02${xOnly}` });
    return !!msg.verifyWithKey(signer);
  } catch (_) {
    return false;
  }
}

/**
 * Parse CONTRACT_MESSAGE JSON body.
 * @param {Message} msg
 * @returns {{ contract: string, type: string, object: object }|null}
 */
function parseContractMessageBody (msg) {
  if (!msg || (msg.type !== OUTER.CONTRACT_MESSAGE && msg.type !== 'P2P_CONTRACT_MESSAGE')) {
    return null;
  }
  let raw = msg.body != null ? msg.body : (msg.raw && msg.raw.data);
  if (Buffer.isBuffer(raw)) raw = raw.toString('utf8');
  if (typeof raw !== 'string') return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (_) {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const contract = String(parsed.contract || '').trim().toLowerCase();
  const type = String(parsed.type || '').trim();
  const object = parsed.object && typeof parsed.object === 'object' ? parsed.object : parsed;
  if (!contract || !type) return null;
  return { contract, type, object };
}

function loadDoc (store, contractId) {
  if (!store || typeof store.get !== 'function' || typeof store.put !== 'function') {
    throw new TypeError('contractMessageAccumulate requires a Store (get/put)');
  }
  const id = normalizeContractId(contractId);
  const existing = store.get(COLLECTION, id);
  if (existing && typeof existing === 'object') {
    return {
      id,
      version: Number(existing.version) || 1,
      clock: Number(existing.clock) || 0,
      content: existing.content && typeof existing.content === 'object' ? existing.content : {},
      entries: Array.isArray(existing.entries) ? existing.entries.slice() : []
    };
  }
  return { id, version: 1, clock: 0, content: {}, entries: [] };
}

function persistDoc (store, doc) {
  store.put(COLLECTION, doc.id, {
    id: doc.id,
    version: doc.version,
    clock: doc.clock,
    content: doc.content,
    entries: doc.entries
  });
  return doc;
}

/**
 * Deterministic fold: sort by message hash, apply GroupChange then collect chats.
 * @param {object[]} entries
 * @returns {{ version: number, clock: number, content: object }}
 */
function foldContractState (entries = []) {
  const sorted = (Array.isArray(entries) ? entries.slice() : []).sort((a, b) => {
    return String(a.hash || '').localeCompare(String(b.hash || ''));
  });
  const members = new Set();
  const messages = [];
  for (const row of sorted) {
    const type = String(row.type || '');
    const obj = row.object && typeof row.object === 'object' ? row.object : {};
    if (type === 'GroupChange') {
      const action = String(obj.action || '');
      if (action === 'member.add' && obj.member) {
        const x = pubkeyXOnly(obj.member);
        if (x) members.add(x);
      } else if (action === 'member.remove' && obj.member) {
        const x = pubkeyXOnly(obj.member);
        if (x) members.delete(x);
      } else if (action === 'members.set' && Array.isArray(obj.members)) {
        members.clear();
        for (const m of obj.members) {
          const x = pubkeyXOnly(m);
          if (x) members.add(x);
        }
      }
    } else if (type === 'GroupChat') {
      const authorRaw = row.author || obj.author || null;
      const author = pubkeyXOnly(authorRaw) || authorRaw;
      messages.push({
        hash: row.hash,
        author,
        body: obj.body != null ? String(obj.body) : (obj.content != null ? String(obj.content) : ''),
        // Only message-carried ts — never ingest-time acceptedAt (must converge)
        ts: obj.ts != null ? String(obj.ts) : null
      });
    }
  }
  const content = {
    members: Array.from(members).sort(),
    messages
  };
  const state = {
    version: 1,
    clock: sorted.length,
    content
  };
  return state;
}

function tipFromDoc (doc) {
  const state = {
    version: doc.version,
    clock: doc.clock,
    content: doc.content
  };
  return {
    contractId: doc.id,
    clock: state.clock,
    stateDigest: stateDigest(state),
    content: state.content
  };
}

/**
 * Ingest signed Message bytes for a contract namespace.
 * @param {{ get: Function, put: Function }} store
 * @param {string} contractId
 * @param {Buffer|string} bufferOrPaste Buffer or fabric:/hex paste
 * @param {{ origin?: string }} [meta]
 * @returns {{ accepted: boolean, duplicate: boolean, entry: object|null, tip: object, error?: string }}
 */
function ingestMessageBuffer (store, contractId, bufferOrPaste, meta = {}) {
  const id = normalizeContractId(contractId);
  const origin = ORIGINS.includes(meta.origin) ? meta.origin : 'mesh';
  let buffer;
  try {
    buffer = Buffer.isBuffer(bufferOrPaste)
      ? bufferOrPaste
      : bufferFromPaste(bufferOrPaste);
  } catch (e) {
    return {
      accepted: false,
      duplicate: false,
      entry: null,
      tip: tipFromDoc(loadDoc(store, id)),
      error: e.message || 'invalid buffer'
    };
  }

  let msg;
  try {
    msg = Message.fromBuffer(buffer);
  } catch (e) {
    return {
      accepted: false,
      duplicate: false,
      entry: null,
      tip: tipFromDoc(loadDoc(store, id)),
      error: e.message || 'parse failed'
    };
  }

  if (!verifyMessageSignature(msg)) {
    return {
      accepted: false,
      duplicate: false,
      entry: null,
      tip: tipFromDoc(loadDoc(store, id)),
      error: 'invalid signature'
    };
  }

  const body = parseContractMessageBody(msg);
  if (!body) {
    return {
      accepted: false,
      duplicate: false,
      entry: null,
      tip: tipFromDoc(loadDoc(store, id)),
      error: 'not a CONTRACT_MESSAGE body'
    };
  }
  if (body.contract !== id) {
    return {
      accepted: false,
      duplicate: false,
      entry: null,
      tip: tipFromDoc(loadDoc(store, id)),
      error: 'contract id mismatch'
    };
  }

  const hash = messageHashHex(msg);
  const doc = loadDoc(store, id);
  if (doc.entries.some((e) => e && e.hash === hash)) {
    const state = foldContractState(doc.entries);
    doc.version = state.version;
    doc.clock = state.clock;
    doc.content = state.content;
    persistDoc(store, doc);
    return {
      accepted: false,
      duplicate: true,
      entry: null,
      tip: tipFromDoc(doc)
    };
  }

  const entry = {
    hash,
    type: body.type,
    author: authorXOnlyHex(msg),
    object: body.object,
    hex: buffer.toString('hex'),
    origin,
    acceptedAt: new Date().toISOString()
  };
  doc.entries.push(entry);
  const state = foldContractState(doc.entries);
  doc.version = state.version;
  doc.clock = state.clock;
  doc.content = state.content;
  persistDoc(store, doc);

  return {
    accepted: true,
    duplicate: false,
    entry,
    tip: tipFromDoc(doc)
  };
}

/**
 * In-memory Store shim for tests / ephemeral peers.
 * @returns {{ get: Function, put: Function, _data: object }}
 */
function createMemoryStore () {
  const data = Object.create(null);
  return {
    _data: data,
    get (collection, id) {
      const bag = data[collection];
      return bag && bag[id] != null ? bag[id] : null;
    },
    put (collection, id, value) {
      if (!data[collection]) data[collection] = Object.create(null);
      data[collection][id] = value;
      return value;
    }
  };
}

module.exports = {
  COLLECTION,
  ORIGINS,
  normalizeContractId,
  stateDigest,
  bufferFromPaste,
  verifyMessageSignature,
  parseContractMessageBody,
  loadDoc,
  persistDoc,
  foldContractState,
  tipFromDoc,
  ingestMessageBuffer,
  createMemoryStore,
  messageHashHex,
  authorXOnlyHex
};
