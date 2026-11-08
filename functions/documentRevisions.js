'use strict';

/**
 * @fileoverview Editable documents as contracts. A `DocumentContract` is a
 * `CONTRACT_PUBLISH` whose signers are the document's editors; every edit is a
 * signed `CONTRACT_MESSAGE` of type `DocumentRevision` whose header `parent`
 * is the frame id ({@link Message#id}) of the revision it replaces (revision 1
 * points at the publish frame). Each version keeps its own content-addressed
 * document identifier, so older versions stay shareable and purchasable; the
 * frames from the publish to a version are that version's provenance, which
 * anyone can check offline.
 *
 * Folding does not depend on arrival order. Two edits on the same parent are
 * both kept: the head is the highest revision (lowest frame id on a tie), and
 * revisions off the head's chain are reported as `forks`.
 *
 * @module functions/documentRevisions
 * @see docs/DOCUMENT_REVISIONS.md
 */

const crypto = require('crypto');

const Actor = require('../types/actor');
const Message = require('../types/message');
const {
  MAX_DOCUMENT_ID_LENGTH,
  P2P_CONTRACT_PUBLISH,
  P2P_CONTRACT_MESSAGE
} = require('../constants');
const { CONTRACT_BODY_TYPES } = require('./applicationNamespaces');
const { pubkeyXOnly } = require('./pubkey');
const collections = require('./fabricMessageCollection');

const DOCUMENT_CONTRACT_TYPE = 'DocumentContract';
const DOCUMENT_REVISION_TYPE = CONTRACT_BODY_TYPES.DocumentRevision;
const DOCUMENT_PROVENANCE_TYPE = 'DocumentProvenance';
const DOCUMENT_REVISIONS_VERSION = 1;
/** Editors one contract may list. */
const MAX_EDITORS = 64;
const NAME_MAX = 256;
const MIME_MAX = 128;
const NOTE_MAX = 1024;

/**
 * @param {*} value
 * @param {number} max
 * @returns {string}
 * @private
 */
function cleanText (value, max) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, max);
}

/**
 * @param {*} value
 * @returns {string|null}
 * @private
 */
function hex64 (value) {
  const s = String(value || '').trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(s) ? s : null;
}

/**
 * A document identifier as stored: 1–128 safe characters, hex lowercased.
 * @param {*} value
 * @returns {string|null}
 */
function normalizeDocumentIdentifier (value) {
  let s = String(value == null ? '' : value).trim();
  if (!s || s.length > MAX_DOCUMENT_ID_LENGTH) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return null;
  if (/^[0-9a-fA-F]+$/.test(s)) s = s.toLowerCase();
  return s;
}

/**
 * @param {*} value
 * @returns {string}
 * @private
 */
function isoTime (value) {
  if (value) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

/**
 * x-only hex of a Key (or a pubkey string).
 * @param {*} keyOrPubkey
 * @returns {string|null}
 * @private
 */
function xOnlyOf (keyOrPubkey) {
  if (!keyOrPubkey) return null;
  if (typeof keyOrPubkey === 'string') return pubkeyXOnly(keyOrPubkey);
  if (keyOrPubkey.public && typeof keyOrPubkey.public.encodeCompressed === 'function') {
    return pubkeyXOnly(keyOrPubkey.public.encodeCompressed('hex'));
  }
  return pubkeyXOnly(keyOrPubkey.pubkey || keyOrPubkey.publicKey);
}

/**
 * The `CONTRACT_PUBLISH` body for an editable document.
 * @param {Object} opts
 * @param {string} opts.name Document name.
 * @param {string} [opts.mime]
 * @param {string} opts.publisher Publisher pubkey (x-only or compressed). Always an editor.
 * @param {Array<string>} [opts.editors] Further editor pubkeys.
 * @param {number} [opts.threshold=1] Editors that must sign a revision (only 1 is enforced in v1).
 * @param {string} [opts.created] ISO time.
 * @param {string} [opts.nonce] 32-hex; random when omitted, so two contracts for one document differ.
 * @returns {object}
 */
function buildDocumentContractGenesis (opts = {}) {
  const publisher = xOnlyOf(opts.publisher);
  if (!publisher) throw new Error('publisher pubkey required');
  const editors = new Set([publisher]);
  for (const entry of Array.isArray(opts.editors) ? opts.editors : []) {
    const x = xOnlyOf(entry);
    if (!x) throw new Error(`invalid editor pubkey: ${String(entry).slice(0, 80)}`);
    editors.add(x);
  }
  if (editors.size > MAX_EDITORS) throw new Error(`at most ${MAX_EDITORS} editors`);
  const signers = [...editors].sort();
  const threshold = opts.threshold == null ? 1 : Number(opts.threshold);
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > signers.length) {
    throw new Error('threshold must be an integer between 1 and the number of editors');
  }
  const nonce = opts.nonce != null
    ? String(opts.nonce).trim().toLowerCase()
    : crypto.randomBytes(16).toString('hex');
  if (!/^[0-9a-f]{32}$/.test(nonce)) throw new Error('nonce must be 16 bytes of hex');
  return {
    type: DOCUMENT_CONTRACT_TYPE,
    v: DOCUMENT_REVISIONS_VERSION,
    name: cleanText(opts.name, NAME_MAX) || 'document',
    mime: cleanText(opts.mime || 'application/octet-stream', MIME_MAX) || 'application/octet-stream',
    publisher,
    members: { signers, threshold },
    primitives: { messageTypes: [DOCUMENT_REVISION_TYPE] },
    created: isoTime(opts.created),
    nonce
  };
}

/**
 * Contract (namespace) id of a genesis, as every Peer computes it.
 * @param {object} definition
 * @returns {string}
 */
function documentContractId (definition) {
  return new Actor(definition).id;
}

/**
 * Whether a `CONTRACT_PUBLISH` body is a document contract.
 * @param {*} definition
 * @returns {boolean}
 */
function isDocumentContractDefinition (definition) {
  return !!(definition && typeof definition === 'object' && !Array.isArray(definition) &&
    definition.type === DOCUMENT_CONTRACT_TYPE &&
    definition.members && Array.isArray(definition.members.signers));
}

/**
 * Editors (x-only) of a genesis.
 * @param {object} definition
 * @returns {string[]}
 */
function documentContractEditors (definition) {
  if (!isDocumentContractDefinition(definition)) return [];
  const out = [];
  for (const entry of definition.members.signers) {
    const x = pubkeyXOnly(entry);
    if (x && !out.includes(x)) out.push(x);
  }
  return out;
}

/**
 * Signed `CONTRACT_PUBLISH` frame for a genesis (genesis parent).
 * @param {Object} opts
 * @param {object} opts.definition From {@link buildDocumentContractGenesis}.
 * @param {Object} opts.key Fabric Key of an editor (with private key).
 * @returns {Message}
 */
function buildDocumentContractPublishMessage (opts = {}) {
  const definition = opts.definition;
  if (!isDocumentContractDefinition(definition)) throw new Error('document contract definition required');
  const author = xOnlyOf(opts.key);
  if (!author || !documentContractEditors(definition).includes(author)) {
    throw new Error('the publishing key must be one of the editors');
  }
  const message = Message.fromLegacyBody('CONTRACT_PUBLISH', definition);
  message.signWithKey(opts.key);
  return message;
}

/**
 * The `DocumentRevision` body (without the signature or parent).
 * @param {Object} opts
 * @param {string} opts.contract Document contract id.
 * @param {Object} opts.document Version: `id` (or `documentIdentifier`), `sha256`, `name`, `mime`, `size`, `merkleRootHex`.
 * @param {number} opts.revision 1 for the first version.
 * @param {string|null} [opts.previousDocumentIdentifier] Identifier of the version this one replaces.
 * @param {string} [opts.editedAt] ISO time.
 * @param {string} [opts.note]
 * @returns {object}
 */
function buildDocumentRevisionBody (opts = {}) {
  const contract = hex64(opts.contract);
  if (!contract) throw new Error('contract id required');
  const doc = opts.document && typeof opts.document === 'object' ? opts.document : {};
  const documentIdentifier = normalizeDocumentIdentifier(doc.documentIdentifier || doc.id || doc.sha256);
  if (!documentIdentifier) throw new Error('document identifier required');
  const revision = Number(opts.revision);
  if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('revision must be a positive integer');
  let previous = null;
  if (revision > 1) {
    previous = normalizeDocumentIdentifier(opts.previousDocumentIdentifier);
    if (!previous) throw new Error('previousDocumentIdentifier required after revision 1');
  }
  const body = {
    contract,
    type: DOCUMENT_REVISION_TYPE,
    v: DOCUMENT_REVISIONS_VERSION,
    documentIdentifier,
    revision,
    previousDocumentIdentifier: previous,
    name: cleanText(doc.name, NAME_MAX) || 'document',
    mime: cleanText(doc.mime || 'application/octet-stream', MIME_MAX) || 'application/octet-stream',
    editedAt: isoTime(opts.editedAt)
  };
  const sha256 = hex64(doc.sha256);
  if (sha256) body.sha256 = sha256;
  const merkleRootHex = hex64(doc.merkleRootHex);
  if (merkleRootHex) body.merkleRootHex = merkleRootHex;
  const size = Number(doc.size);
  if (Number.isSafeInteger(size) && size >= 0) body.size = size;
  const note = cleanText(opts.note, NOTE_MAX);
  if (note) body.note = note;
  return body;
}

/**
 * Signed `DocumentRevision` frame chained to `opts.previous`.
 * @param {Object} opts Fields of {@link buildDocumentRevisionBody}, plus:
 * @param {Message|Buffer|string|Object} opts.previous The publish frame (revision 1) or the replaced revision's frame (Message, bytes, hex, or a record with `id`).
 * @param {Object} opts.key Fabric Key of an editor (with private key).
 * @returns {Message}
 */
function buildDocumentRevisionMessage (opts = {}) {
  const parent = frameIdOfInput(opts.previous);
  if (!parent) throw new Error('previous frame required');
  const body = buildDocumentRevisionBody(opts);
  const message = Message.fromLegacyBody('CONTRACT_MESSAGE', body);
  message.parent = parent;
  message.signWithKey(opts.key);
  return message;
}

/**
 * @param {*} input
 * @returns {string|null}
 * @private
 */
function frameIdOfInput (input) {
  if (!input) return null;
  if (typeof input === 'string') {
    const id = hex64(input);
    if (id) return id;
  }
  if (input && typeof input === 'object' && !Buffer.isBuffer(input) && typeof input.toBuffer !== 'function') {
    if (hex64(input.id)) return hex64(input.id);
  }
  const decoded = collections.bufferFromInput(input);
  return decoded.ok ? Message.frameIdOf(decoded.buffer) : null;
}

/**
 * Parse and verify one frame of a document contract.
 * @param {*} input Message, Buffer, hex, `fabric:<hex>`, or a collection record.
 * @returns {{ ok: boolean, reason?: string, kind?: 'publish'|'revision', id?: string, hash?: string, hex?: string, parent?: string, author?: string, contractId?: string, definition?: object, body?: object }}
 */
function parseDocumentContractFrame (input) {
  const decoded = collections.bufferFromInput(input);
  if (!decoded.ok) return { ok: false, reason: decoded.error || 'not a frame' };
  const parsed = collections.parseFrame(decoded.buffer);
  if (!parsed.ok) return { ok: false, reason: parsed.error };
  const signed = Message.verifyFrameAuthor(decoded.buffer);
  if (!signed.ok) return { ok: false, reason: signed.reason };
  const out = {
    ok: true,
    id: Message.frameIdOf(decoded.buffer),
    hash: signed.hash,
    hex: decoded.buffer.toString('hex'),
    parent: signed.parent,
    author: signed.author
  };
  const body = Message.tryParseLegacyBody(parsed.message);
  if (!body.ok || !body.value || typeof body.value !== 'object') {
    return { ok: false, reason: 'unreadable body' };
  }
  if (signed.type === P2P_CONTRACT_PUBLISH) {
    if (!isDocumentContractDefinition(body.value)) return { ok: false, reason: 'not a document contract' };
    out.kind = 'publish';
    out.definition = body.value;
    out.contractId = documentContractId(body.value);
    return out;
  }
  if (signed.type === P2P_CONTRACT_MESSAGE) {
    if (body.value.type !== DOCUMENT_REVISION_TYPE) return { ok: false, reason: 'not a document revision' };
    out.kind = 'revision';
    out.body = body.value;
    out.contractId = hex64(body.value.contract);
    if (!out.contractId) return { ok: false, reason: 'revision has no contract id' };
    return out;
  }
  return { ok: false, reason: 'not a contract frame' };
}

/**
 * @param {*} frames Collection, `{ messages }`, provenance, or an array.
 * @returns {Array}
 * @private
 */
function frameList (frames) {
  if (!frames) return [];
  if (Array.isArray(frames)) return frames;
  if (frames.type === DOCUMENT_PROVENANCE_TYPE && frames.collection) return frameList(frames.collection);
  if (Array.isArray(frames.messages)) return frames.messages;
  return [];
}

/**
 * @param {object} parsed
 * @returns {object}
 * @private
 */
function revisionView (parsed) {
  const b = parsed.body;
  const out = {
    revision: b.revision,
    documentIdentifier: b.documentIdentifier,
    previousDocumentIdentifier: b.previousDocumentIdentifier || null,
    name: b.name,
    mime: b.mime,
    editedAt: b.editedAt,
    author: parsed.author,
    frameId: parsed.id,
    parent: parsed.parent,
    hash: parsed.hash
  };
  if (b.sha256) out.sha256 = b.sha256;
  if (b.merkleRootHex) out.merkleRootHex = b.merkleRootHex;
  if (b.size != null) out.size = b.size;
  if (b.note) out.note = b.note;
  return out;
}

/**
 * @param {object} a
 * @param {object} b
 * @returns {number}
 * @private
 */
function byId (a, b) {
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

/**
 * Fold the frames of one document contract.
 * @param {*} frames Publish + revision frames (any order; other contracts' frames are ignored).
 * @param {Object} [opts]
 * @param {string} [opts.contractId] Which contract, when the frames hold several.
 * @returns {{ ok: boolean, reason?: string, contractId: string|null, definition: object|null, editors: string[], publish: object|null, head: object|null, revisions: object[], forks: object[], invalid: object[], frames: object[] }}
 */
function foldDocumentRevisions (frames, opts = {}) {
  const empty = {
    ok: false,
    contractId: null,
    definition: null,
    editors: [],
    publish: null,
    head: null,
    revisions: [],
    forks: [],
    invalid: [],
    frames: []
  };
  const parsedAll = [];
  const seen = new Set();
  for (const input of frameList(frames)) {
    const parsed = parseDocumentContractFrame(input);
    if (!parsed.ok) {
      empty.invalid.push({ id: null, reason: parsed.reason });
      continue;
    }
    if (seen.has(parsed.id)) continue;
    seen.add(parsed.id);
    parsedAll.push(parsed);
  }
  const wanted = hex64(opts.contractId);
  const publishes = parsedAll
    .filter((p) => p.kind === 'publish' && (!wanted || p.contractId === wanted))
    .sort(byId);
  const invalid = empty.invalid;
  let publish = null;
  for (const p of publishes) {
    const editors = documentContractEditors(p.definition);
    if (!Message.isZeroParent(p.parent)) {
      invalid.push({ id: p.id, reason: 'publish frame must be genesis' });
      continue;
    }
    if (!editors.includes(p.author)) {
      invalid.push({ id: p.id, reason: 'publish not signed by an editor' });
      continue;
    }
    if (publish && publish.contractId !== p.contractId) {
      return Object.assign(empty, { reason: 'frames hold several document contracts; pass contractId' });
    }
    if (!publish) publish = p;
  }
  if (!publish) return Object.assign(empty, { reason: 'no document contract publish frame' });

  const contractId = publish.contractId;
  const editors = documentContractEditors(publish.definition);
  const accepted = new Map();
  accepted.set(publish.id, { revision: 0, documentIdentifier: null, parsed: publish });
  let pending = parsedAll
    .filter((p) => p.kind === 'revision' && p.contractId === contractId)
    .sort(byId);
  for (const p of parsedAll) {
    if (p.kind === 'revision' && p.contractId !== contractId && !wanted) {
      invalid.push({ id: p.id, reason: 'revision for another contract' });
    }
  }

  // Accept revisions whose parent is already accepted, until nothing changes.
  let progressed = true;
  while (pending.length && progressed) {
    progressed = false;
    const waiting = [];
    for (const p of pending) {
      const parent = accepted.get(p.parent);
      if (!parent) {
        waiting.push(p);
        continue;
      }
      progressed = true;
      const b = p.body;
      let reason = null;
      if (!editors.includes(p.author)) reason = 'revision not signed by an editor';
      else if (b.v !== DOCUMENT_REVISIONS_VERSION) reason = 'unsupported revision version';
      else if (!normalizeDocumentIdentifier(b.documentIdentifier)) reason = 'invalid document identifier';
      else if (b.revision !== parent.revision + 1) reason = 'revision number does not follow its parent';
      else if ((b.previousDocumentIdentifier || null) !== parent.documentIdentifier) {
        reason = 'previousDocumentIdentifier does not match the parent revision';
      }
      if (reason) {
        invalid.push({ id: p.id, reason });
        continue;
      }
      accepted.set(p.id, { revision: b.revision, documentIdentifier: b.documentIdentifier, parsed: p });
    }
    pending = waiting;
  }
  for (const p of pending) invalid.push({ id: p.id, reason: 'parent frame missing' });

  const valid = [...accepted.values()].filter((row) => row.revision > 0).map((row) => row.parsed);
  let head = null;
  for (const p of valid) {
    if (!head || p.body.revision > head.body.revision ||
      (p.body.revision === head.body.revision && p.id < head.id)) head = p;
  }
  const mainline = [];
  const onMainline = new Set();
  let cursor = head;
  while (cursor) {
    mainline.unshift(revisionView(cursor));
    onMainline.add(cursor.id);
    const parent = accepted.get(cursor.parent);
    cursor = parent && parent.revision > 0 ? parent.parsed : null;
  }
  const forks = valid
    .filter((p) => !onMainline.has(p.id))
    .sort((a, b) => (a.body.revision - b.body.revision) || byId(a, b))
    .map(revisionView);
  const ordered = [publish].concat(
    valid.slice().sort((a, b) => (a.body.revision - b.body.revision) || byId(a, b))
  );
  return {
    ok: true,
    contractId,
    definition: publish.definition,
    editors,
    publish: { frameId: publish.id, hash: publish.hash, author: publish.author },
    head: mainline.length ? mainline[mainline.length - 1] : null,
    revisions: mainline,
    forks,
    invalid,
    frames: ordered.map((p) => ({ id: p.id, hash: p.hash, hex: p.hex, parent: p.parent, author: p.author }))
  };
}

/**
 * Provenance of one version: the publish frame and every revision from 1 to
 * that version (never later edits), as a `FabricMessageCollection`.
 * @param {*} frames Frames of the contract.
 * @param {string} documentIdentifier Version to prove.
 * @param {Object} [opts]
 * @param {string} [opts.contractId]
 * @returns {object|null} `{ type: 'DocumentProvenance', v, contractId, documentIdentifier, revision, collection }`, or null when the version is not in the contract.
 */
function documentProvenance (frames, documentIdentifier, opts = {}) {
  const target = normalizeDocumentIdentifier(documentIdentifier);
  if (!target) return null;
  const fold = foldDocumentRevisions(frames, opts);
  if (!fold.ok) return null;
  // A rename keeps the content id, so one id may name several revisions: take
  // the latest on the head's chain, else the earliest fork.
  const onChain = fold.revisions.filter((r) => r.documentIdentifier === target);
  const offChain = fold.forks.filter((r) => r.documentIdentifier === target);
  const chosen = onChain.length ? onChain[onChain.length - 1] : offChain[0];
  if (!chosen) return null;
  const byFrame = new Map(fold.frames.map((f) => [f.id, f]));
  const chain = [];
  let cur = byFrame.get(chosen.frameId);
  while (cur) {
    chain.unshift(cur);
    if (cur.id === fold.publish.frameId) break;
    cur = byFrame.get(cur.parent);
  }
  const collection = collections.createCollection();
  for (const frame of chain) collections.ingest(collection, frame.hex);
  return {
    type: DOCUMENT_PROVENANCE_TYPE,
    v: DOCUMENT_REVISIONS_VERSION,
    contractId: fold.contractId,
    documentIdentifier: target,
    revision: chosen.revision,
    collection: collections.toJSON(collection)
  };
}

/**
 * Check a provenance offline: one unbroken chain of editor-signed frames from
 * the publish to the claimed version, with nothing invalid or forked.
 * @param {*} provenance From {@link documentProvenance} (or its collection / frames).
 * @param {Object} [expect]
 * @param {string} [expect.documentIdentifier]
 * @param {string} [expect.contractId]
 * @param {string} [expect.sha256]
 * @returns {{ ok: boolean, reason?: string, contractId?: string, documentIdentifier?: string, revision?: number, definition?: object, revisions?: object[] }}
 */
function verifyDocumentProvenance (provenance, expect = {}) {
  const fold = foldDocumentRevisions(provenance, { contractId: expect.contractId });
  if (!fold.ok) return { ok: false, reason: fold.reason || 'no document contract' };
  if (fold.invalid.length) return { ok: false, reason: `invalid frame: ${fold.invalid[0].reason}` };
  if (fold.forks.length) return { ok: false, reason: 'provenance holds more than one chain' };
  if (!fold.head) return { ok: false, reason: 'provenance has no revision' };
  const head = fold.head;
  if (provenance && provenance.type === DOCUMENT_PROVENANCE_TYPE) {
    if (provenance.contractId && provenance.contractId !== fold.contractId) {
      return { ok: false, reason: 'contract id does not match the frames' };
    }
    if (provenance.documentIdentifier && provenance.documentIdentifier !== head.documentIdentifier) {
      return { ok: false, reason: 'documentIdentifier does not match the last revision' };
    }
    if (provenance.revision != null && Number(provenance.revision) !== head.revision) {
      return { ok: false, reason: 'revision does not match the last revision' };
    }
  }
  const expected = normalizeDocumentIdentifier(expect.documentIdentifier);
  if (expect.documentIdentifier != null && expected !== head.documentIdentifier) {
    return { ok: false, reason: 'provenance is for another document' };
  }
  const sha = hex64(expect.sha256);
  if (sha && head.sha256 && sha !== head.sha256) {
    return { ok: false, reason: 'sha256 does not match the revision' };
  }
  return {
    ok: true,
    contractId: fold.contractId,
    documentIdentifier: head.documentIdentifier,
    revision: head.revision,
    definition: fold.definition,
    revisions: fold.revisions
  };
}

module.exports = {
  DOCUMENT_CONTRACT_TYPE,
  DOCUMENT_REVISION_TYPE,
  DOCUMENT_PROVENANCE_TYPE,
  DOCUMENT_REVISIONS_VERSION,
  MAX_EDITORS,
  normalizeDocumentIdentifier,
  buildDocumentContractGenesis,
  documentContractId,
  isDocumentContractDefinition,
  documentContractEditors,
  buildDocumentContractPublishMessage,
  buildDocumentRevisionBody,
  buildDocumentRevisionMessage,
  parseDocumentContractFrame,
  foldDocumentRevisions,
  documentProvenance,
  verifyDocumentProvenance
};
