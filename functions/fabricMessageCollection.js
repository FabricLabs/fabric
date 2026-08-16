'use strict';

/**
 * @fileoverview Ordered collection of bit-identical Fabric AMP Message frames.
 *
 * Canonical share / store unit for contract journals, Discord / GroupDataShare
 * packs, IdentityCrossSign catch-up, and peer replay. Application JSON objects
 * are **not** the format — `hex` of {@link Message#toBuffer} is. Hub
 * `messages/*.json` (type + payload) is a different activity log.
 *
 * Identity of a frame is the AMP body hash (double-SHA256 of the body, the
 * header `hash` field). Collection `root` is SHA-256 of the concatenated
 * ordered hashes so replay order is committed. ARC fold
 * (`contractMessageAccumulate`) may still sort by hash; those two commitments
 * answer different questions.
 *
 * @module functions/fabricMessageCollection
 * @see docs/MESSAGE_COLLECTION.md
 * @see functions/contractMessageAccumulate.js
 */

const fs = require('fs');
const path = require('path');

const Message = require('../types/message');
const Hash256 = require('../types/hash256');
const { HEADER_SIZE, MAX_MESSAGE_SIZE } = require('../constants');
const {
  bufferFromPaste,
  parseContractMessageBody,
  messageHashHex,
  authorXOnlyHex
} = require('./contractMessageAccumulate');
/** @private */
const COLLECTION_TYPE = 'FabricMessageCollection';
/** @private */
const SCHEMA_VERSION = 1;

/**
 * @returns {object}
 */
function createCollection () {
  return {
    type: COLLECTION_TYPE,
    v: SCHEMA_VERSION,
    messages: [],
    seen: new Set()
  };
}

/**
 * Double-SHA256(body) must match the header `hash` field (Peer drop rule).
 * @param {Message} msg
 * @returns {boolean}
 */
function verifyBodyHash (msg) {
  if (!msg || !msg.raw) return false;
  const bodyBuf = msg.raw.data || Buffer.alloc(0);
  const checksum = Hash256.doubleDigest(bodyBuf);
  const expected = Buffer.isBuffer(msg.raw.hash)
    ? msg.raw.hash.toString('hex')
    : String(msg.raw.hash || '');
  return checksum === expected;
}

/**
 * @param {Buffer} buffer
 * @returns {{ ok: true, message: Message, buffer: Buffer }|{ ok: false, error: string }}
 */
function parseFrame (buffer) {
  if (!Buffer.isBuffer(buffer)) {
    return { ok: false, error: 'not a buffer' };
  }
  if (buffer.length < HEADER_SIZE) {
    return { ok: false, error: 'undersize' };
  }
  if (buffer.length > HEADER_SIZE + MAX_MESSAGE_SIZE) {
    return { ok: false, error: 'oversize' };
  }
  let message;
  try {
    message = Message.fromBuffer(buffer);
  } catch (err) {
    return { ok: false, error: (err && err.message) || 'parse failed' };
  }
  if (!verifyBodyHash(message)) {
    return { ok: false, error: 'body-hash-mismatch' };
  }
  return { ok: true, message, buffer };
}

/**
 * @param {Message} message
 * @param {Object} [meta]
 * @param {Buffer} [meta.buffer]
 * @param {string} [meta.peer]
 * @param {string} [meta.origin]
 * @param {string} [meta.ts]
 * @returns {object}
 */
function recordFromMessage (message, meta = {}) {
  const buffer = Buffer.isBuffer(meta.buffer) ? meta.buffer : message.toBuffer();
  const hash = messageHashHex(message);
  const type = message.type || message.wireType || null;
  const author = authorXOnlyHex(message);
  const record = {
    hash,
    hex: buffer.toString('hex'),
    type
  };
  if (author) record.author = author;
  const inner = parseContractMessageBody(message);
  if (inner) {
    record.appType = inner.type;
    record.contract = inner.contract;
  }
  if (meta.peer) record.peer = String(meta.peer);
  if (meta.origin) record.origin = String(meta.origin);
  if (meta.ts) record.ts = String(meta.ts);
  return record;
}

/**
 * @param {*} input
 * @returns {{ ok: true, buffer: Buffer }|{ ok: false, error: string }}
 */
function bufferFromInput (input) {
  if (Buffer.isBuffer(input)) return { ok: true, buffer: input };
  if (input instanceof Uint8Array) return { ok: true, buffer: Buffer.from(input) };
  if (input && typeof input.toBuffer === 'function') {
    try {
      return { ok: true, buffer: input.toBuffer() };
    } catch (err) {
      return { ok: false, error: (err && err.message) || 'toBuffer failed' };
    }
  }
  if (input && typeof input === 'object') {
    const hex = input.hex || input.messageHex || input.bufferHex;
    if (hex) {
      try {
        return { ok: true, buffer: bufferFromPaste(hex) };
      } catch (err) {
        return { ok: false, error: (err && err.message) || 'invalid hex' };
      }
    }
  }
  if (typeof input === 'string') {
    try {
      return { ok: true, buffer: bufferFromPaste(input) };
    } catch (err) {
      return { ok: false, error: (err && err.message) || 'invalid hex' };
    }
  }
  return { ok: false, error: 'unsupported input' };
}

/**
 * Append one AMP frame. Dedupes by body hash. Fail-closed on parse / body-hash.
 * @param {object} collection
 * @param {*} input Message, Buffer, hex, or `{ hex }` / journal `fabricMessage`
 * @param {Object} [meta]
 * @returns {{ accepted: boolean, duplicate: boolean, skipped: boolean, record: object|null, message: Message|null, error: string|null }}
 */
function ingest (collection, input, meta = {}) {
  const empty = {
    accepted: false,
    duplicate: false,
    skipped: true,
    record: null,
    message: null,
    error: null
  };
  if (!collection || !Array.isArray(collection.messages)) {
    empty.error = 'invalid collection';
    return empty;
  }
  if (!collection.seen) collection.seen = new Set(collection.messages.map((m) => m && m.hash).filter(Boolean));

  const decoded = bufferFromInput(input);
  if (!decoded.ok) {
    empty.error = decoded.error;
    return empty;
  }

  const parsed = parseFrame(decoded.buffer);
  if (!parsed.ok) {
    empty.error = parsed.error;
    return empty;
  }

  const record = recordFromMessage(parsed.message, Object.assign({}, meta, {
    buffer: parsed.buffer
  }));
  if (input && typeof input === 'object' && input.hash && !input.toBuffer) {
    const claimed = String(input.hash).toLowerCase().replace(/^0x/, '');
    if (/^[0-9a-f]{64}$/.test(claimed) && claimed !== record.hash) {
      empty.error = 'hash-claim-mismatch';
      return empty;
    }
  }

  if (collection.seen.has(record.hash)) {
    return {
      accepted: false,
      duplicate: true,
      skipped: false,
      record,
      message: parsed.message,
      error: null
    };
  }

  collection.seen.add(record.hash);
  collection.messages.push(record);
  return {
    accepted: true,
    duplicate: false,
    skipped: false,
    record,
    message: parsed.message,
    error: null
  };
}

/**
 * @param {object} collection
 * @param {Array<*>} list
 * @param {Object} [meta]
 * @returns {{ accepted: number, duplicate: number, skipped: number, errors: string[] }}
 */
function ingestMany (collection, list, meta = {}) {
  const errors = [];
  let accepted = 0;
  let duplicate = 0;
  let skipped = 0;
  const rows = Array.isArray(list) ? list : [];
  for (const item of rows) {
    const result = ingest(collection, item, meta);
    if (result.accepted) accepted += 1;
    else if (result.duplicate) duplicate += 1;
    else {
      skipped += 1;
      if (result.error) errors.push(result.error);
    }
  }
  return { accepted, duplicate, skipped, errors };
}

/**
 * Pull `{ hash, hex, type }` from GroupJournalBatch-style journal rows.
 * @param {Array<object>} entries
 * @returns {object[]}
 */
function recordsFromJournalEntries (entries) {
  const out = [];
  const rows = Array.isArray(entries) ? entries : [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const fm = row.fabricMessage && typeof row.fabricMessage === 'object'
      ? row.fabricMessage
      : null;
    if (fm && fm.hex) out.push(fm);
    else if (row.hex) out.push(row);
  }
  return out;
}

/**
 * SHA-256 of concatenated ordered 32-byte hashes (order-sensitive).
 * @param {object[]} messages
 * @returns {string}
 */
function rootOf (messages) {
  const rows = Array.isArray(messages) ? messages : [];
  const parts = [];
  for (const row of rows) {
    const hash = row && row.hash != null ? String(row.hash).toLowerCase() : '';
    if (!/^[0-9a-f]{64}$/.test(hash)) continue;
    parts.push(Buffer.from(hash, 'hex'));
  }
  return Hash256.digest(parts.length ? Buffer.concat(parts) : Buffer.alloc(0));
}

/**
 * Public JSON document (no `seen` set).
 * @param {object} collection
 * @returns {object}
 */
function toJSON (collection) {
  const messages = (collection && Array.isArray(collection.messages) ? collection.messages : [])
    .map((row) => publicRecord(row));
  return {
    type: COLLECTION_TYPE,
    v: SCHEMA_VERSION,
    count: messages.length,
    root: rootOf(messages),
    messages
  };
}

/**
 * @param {object} row
 * @returns {object}
 * @private
 */
function publicRecord (row) {
  if (!row || typeof row !== 'object') return { hash: null, hex: '' };
  const out = {
    hash: row.hash != null ? String(row.hash) : null,
    hex: row.hex != null ? String(row.hex) : ''
  };
  if (row.type) out.type = String(row.type);
  if (row.author) out.author = String(row.author);
  if (row.appType) out.appType = String(row.appType);
  if (row.contract) out.contract = String(row.contract);
  if (row.peer) out.peer = String(row.peer);
  if (row.origin) out.origin = String(row.origin);
  if (row.ts) out.ts = String(row.ts);
  return out;
}

/**
 * Re-parse every `hex` so restore is fail-closed.
 * @param {object} doc
 * @returns {object}
 */
function fromJSON (doc) {
  const collection = createCollection();
  if (!doc || typeof doc !== 'object') return collection;
  const list = Array.isArray(doc.messages) ? doc.messages : [];
  ingestMany(collection, list, { origin: 'restore' });
  return collection;
}

/**
 * One JSON record or raw hex per line. `#` comments ignored.
 * @param {object} collection
 * @returns {string}
 */
function toJSONL (collection) {
  const messages = collection && Array.isArray(collection.messages) ? collection.messages : [];
  return messages.map((row) => JSON.stringify(publicRecord(row))).join('\n') + (messages.length ? '\n' : '');
}

/**
 * @param {string} text
 * @param {Object} [meta]
 * @returns {object}
 */
function fromJSONL (text, meta = {}) {
  const collection = createCollection();
  ingestText(collection, text, meta);
  return collection;
}

/**
 * Ingest a JSON collection, JSONL, a single record, or hex blob.
 * @param {object} collection
 * @param {string} text
 * @param {Object} [meta]
 * @returns {{ accepted: number, duplicate: number, skipped: number, errors: string[] }}
 */
function ingestText (collection, text, meta = {}) {
  const raw = text == null ? '' : String(text);
  const trimmed = raw.trim();
  if (!trimmed) return { accepted: 0, duplicate: 0, skipped: 0, errors: [] };

  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && parsed.type === COLLECTION_TYPE && Array.isArray(parsed.messages)) {
        return ingestMany(collection, parsed.messages, meta);
      }
      if (parsed && (parsed.hex || parsed.messageHex)) {
        const one = ingest(collection, parsed, meta);
        return summarizeOne(one);
      }
    } catch (_) {
      // fall through to JSONL / hex
    }
  }

  if (trimmed.includes('\n')) {
    const stats = { accepted: 0, duplicate: 0, skipped: 0, errors: [] };
    const lines = raw.split(/\r?\n/);
    for (const line of lines) {
      const s = line.trim();
      if (!s || s.startsWith('#')) continue;
      const chunk = ingestText(collection, s, meta);
      stats.accepted += chunk.accepted;
      stats.duplicate += chunk.duplicate;
      stats.skipped += chunk.skipped;
      for (const err of chunk.errors) stats.errors.push(err);
    }
    return stats;
  }

  const one = ingest(collection, trimmed, meta);
  return summarizeOne(one);
}

/**
 * @param {{ accepted: boolean, duplicate: boolean, skipped: boolean, error: string|null }} result
 * @returns {{ accepted: number, duplicate: number, skipped: number, errors: string[] }}
 * @private
 */
function summarizeOne (result) {
  return {
    accepted: result.accepted ? 1 : 0,
    duplicate: result.duplicate ? 1 : 0,
    skipped: result.skipped ? 1 : 0,
    errors: result.error ? [result.error] : []
  };
}

/**
 * Replay frames in collection order. Handler sees a live {@link Message}.
 * @param {object} collection
 * @param {Function} handler
 * @returns {{ applied: number, skipped: number, errors: Array<{ index: number, hash: string|null, error: string }> }}
 */
function replay (collection, handler) {
  const applied = { applied: 0, skipped: 0, errors: [] };
  const rows = collection && Array.isArray(collection.messages) ? collection.messages : [];
  if (typeof handler !== 'function') {
    applied.errors.push({ index: -1, hash: null, error: 'handler required' });
    return applied;
  }
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const decoded = bufferFromInput(row);
    if (!decoded.ok) {
      applied.skipped += 1;
      applied.errors.push({ index: i, hash: row && row.hash ? String(row.hash) : null, error: decoded.error });
      continue;
    }
    const parsed = parseFrame(decoded.buffer);
    if (!parsed.ok) {
      applied.skipped += 1;
      applied.errors.push({ index: i, hash: row && row.hash ? String(row.hash) : null, error: parsed.error });
      continue;
    }
    try {
      handler({
        message: parsed.message,
        record: row,
        index: i,
        buffer: parsed.buffer,
        inner: parseContractMessageBody(parsed.message)
      });
      applied.applied += 1;
    } catch (err) {
      applied.skipped += 1;
      applied.errors.push({
        index: i,
        hash: row && row.hash ? String(row.hash) : null,
        error: (err && err.message) || 'handler failed'
      });
    }
  }
  return applied;
}

/**
 * Deterministic fold: `folder(state, ctx)` returns next state.
 * @param {object} collection
 * @param {Function} folder
 * @param {*} initialState
 * @returns {{ applied: number, skipped: number, errors: Array, state: * }}
 */
function replayFold (collection, folder, initialState) {
  let state = initialState;
  const result = replay(collection, (ctx) => {
    state = folder(state, ctx);
  });
  return {
    applied: result.applied,
    skipped: result.skipped,
    errors: result.errors,
    state
  };
}

/**
 * @param {string} filePath
 * @param {object} collection
 */
function writeFile (filePath, collection) {
  const dest = path.resolve(String(filePath || ''));
  const ext = path.extname(dest).toLowerCase();
  const body = ext === '.jsonl' ? toJSONL(collection) : JSON.stringify(toJSON(collection), null, 2) + '\n';
  fs.writeFileSync(dest, body, 'utf8');
  return dest;
}

/**
 * @param {string} filePath
 * @returns {object}
 */
function readFile (filePath) {
  const src = path.resolve(String(filePath || ''));
  const text = fs.readFileSync(src, 'utf8');
  const collection = createCollection();
  ingestText(collection, text, { origin: src });
  return collection;
}

/**
 * CLI: collect | replay | verify. Reads files or stdin (`-`).
 * @param {string[]} argv
 * @param {{ stdin?: NodeJS.ReadableStream, stdout?: NodeJS.WritableStream, stderr?: NodeJS.WritableStream }} [io]
 * @returns {number} process exit code
 */
function runCli (argv = [], io = {}) {
  const out = io.stdout || process.stdout;
  const err = io.stderr || process.stderr;
  const action = String(argv[0] || 'help').toLowerCase();
  const files = argv.slice(1);

  if (action === 'help' || action === '-h' || action === '--help') {
    out.write([
      'Usage: node scripts/replay-messages.js <collect|replay|verify> [file ...]',
      '',
      '  collect  Ingest AMP hex / JSON / JSONL into a FabricMessageCollection.',
      '  replay   Parse each stored frame and print hash, type, appType.',
      '  verify   Same as replay; exit 1 if any frame fails body-hash / parse.',
      '',
      'Canonical bytes are Message.toBuffer() hex. JSON application objects are not.',
      ''
    ].join('\n'));
    return 0;
  }

  const collection = createCollection();
  const inputs = files.length ? files : ['-'];
  for (const file of inputs) {
    let text;
    if (file === '-') {
      text = fs.readFileSync(0, 'utf8');
    } else {
      text = fs.readFileSync(path.resolve(file), 'utf8');
    }
    ingestText(collection, text, { origin: file });
  }

  if (action === 'collect') {
    out.write(JSON.stringify(toJSON(collection), null, 2) + '\n');
    return 0;
  }

  if (action === 'replay' || action === 'verify') {
    const rows = [];
    const result = replay(collection, (ctx) => {
      rows.push({
        index: ctx.index,
        hash: ctx.record && ctx.record.hash,
        type: ctx.message.type,
        appType: ctx.inner && ctx.inner.type ? ctx.inner.type : null,
        contract: ctx.inner && ctx.inner.contract ? ctx.inner.contract : null
      });
    });
    out.write(JSON.stringify({
      type: COLLECTION_TYPE,
      count: collection.messages.length,
      root: rootOf(collection.messages),
      applied: result.applied,
      skipped: result.skipped,
      errors: result.errors,
      messages: rows
    }, null, 2) + '\n');
    if (action === 'verify' && (result.skipped || result.errors.length)) {
      err.write('verify failed\n');
      return 1;
    }
    return 0;
  }

  err.write('unknown action: ' + action + '\n');
  return 2;
}

module.exports = {
  COLLECTION_TYPE,
  SCHEMA_VERSION,
  createCollection,
  verifyBodyHash,
  parseFrame,
  recordFromMessage,
  bufferFromInput,
  ingest,
  ingestMany,
  ingestText,
  recordsFromJournalEntries,
  rootOf,
  toJSON,
  fromJSON,
  toJSONL,
  fromJSONL,
  replay,
  replayFold,
  writeFile,
  readFile,
  runCli
};
