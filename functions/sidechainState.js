'use strict';

/**
 * Sidechain document helpers (distributed execution) — shared mutual state as ordered
 * snapshots under contract rules. **Not a Fabric type**; prefer this module over any
 * legacy `types/statechain` path.
 *
 * Hub often says “sidechain state”: a logical JSON document `{ version, clock, content }`
 * advanced by RFC6902 patches, authorized by federation (or operator policy), and sealed
 * into L1-tied epoch digests with full snapshots for reorg rewind. Optional path policy
 * encodes the contract’s allowed mutations.
 *
 * @module functions/sidechainState
 * @see docs/DISTRIBUTED_EXECUTION.md
 * @see snippets/sidechains.md
 */

const crypto = require('crypto');
const { applyPatch, validate } = require('fast-json-patch');
const fabricCanonicalJson = require('./fabricCanonicalJson');
const { jsonSafe, stableStringify } = fabricCanonicalJson;
const {
  signingStringForBeaconEpoch,
  verifyFederationWitnessOnMessage
} = require('./beaconFederationSigning');

const SIDECHAIN_STATE_PATH = 'sidechain/STATE';
const SIDECHAIN_SNAPSHOTS_PATH = 'sidechain/SNAPSHOTS';
const SIDECHAIN_JOURNAL_PATH = 'sidechain/JOURNAL';
const SIDECHAIN_PATCH_KIND = 'SidechainStatePatch';
/** Manifest / GenericMessage / activity type name (not yet a dedicated outer opcode). */
const SIDECHAIN_STATE_PATCH_TYPE = 'SIDECHAIN_STATE_PATCH';

/**
 * @typedef {{ version?: number, clock: number, content: object }} StatechainState
 * @typedef {{
 *   maxOps?: number,
 *   maxPathDepth?: number,
 *   allowedPathPrefixes?: string[],
 *   deniedPathPrefixes?: string[],
 *   allowEmptyPolicy?: boolean
 * }} StatechainPathPolicy
 */

function stablePatchBody (basisClock, basisDigest, patches) {
  return stableStringify({
    version: 1,
    kind: SIDECHAIN_PATCH_KIND,
    basisClock: Number(basisClock),
    basisDigest: String(basisDigest || ''),
    patches: jsonSafe(patches)
  });
}

/**
 * UTF-8 string federation members sign (same bytes for all validators).
 * @param {{ basisClock: number, basisDigest: string, patches: object[] }} proposal
 * @returns {string}
 */
function signingStringForSidechainStatePatch (proposal) {
  return stablePatchBody(proposal.basisClock, proposal.basisDigest, proposal.patches);
}

/**
 * @param {{ basisClock: number, basisDigest: string, patches: object[] }} proposal
 * @returns {string}
 */
function patchCommitmentDigestHex (proposal) {
  const s = signingStringForSidechainStatePatch(proposal);
  return crypto.createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex');
}

/** @returns {StatechainState} */
function createInitialState () {
  return { version: 1, clock: 0, content: {} };
}

/**
 * Digest of the full statechain document (public commitment).
 * @param {StatechainState} state
 * @returns {string}
 */
function stateDigest (state) {
  const s = stableStringify({
    version: state.version != null ? Number(state.version) : 1,
    clock: Number(state.clock) || 0,
    content: jsonSafe(state.content || {})
  });
  return crypto.createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex');
}

/**
 * Normalize optional contract path policy from a distributed manifest or settings.
 * @param {object|null|undefined} raw
 * @returns {StatechainPathPolicy|null}
 */
function parseStatechainPathPolicy (raw) {
  if (!raw || typeof raw !== 'object') return null;
  const maxOps = raw.maxOps != null ? Math.max(1, Number(raw.maxOps) || 1) : undefined;
  const maxPathDepth = raw.maxPathDepth != null ? Math.max(1, Number(raw.maxPathDepth) || 1) : undefined;
  const allowedPathPrefixes = Array.isArray(raw.allowedPathPrefixes)
    ? raw.allowedPathPrefixes.filter((p) => typeof p === 'string' && p.length)
    : undefined;
  const deniedPathPrefixes = Array.isArray(raw.deniedPathPrefixes)
    ? raw.deniedPathPrefixes.filter((p) => typeof p === 'string' && p.length)
    : undefined;
  return {
    maxOps,
    maxPathDepth,
    allowedPathPrefixes,
    deniedPathPrefixes,
    allowEmptyPolicy: raw.allowEmptyPolicy !== false
  };
}

/**
 * Enforce contract path rules on an RFC6902 patch list (before apply).
 * @param {object[]} patches
 * @param {StatechainPathPolicy|null|undefined} policy
 * @returns {{ ok: boolean, error?: string }}
 */
function validatePatchesAgainstPolicy (patches, policy) {
  if (!Array.isArray(patches) || !patches.length) {
    return { ok: false, error: 'patches must be a non-empty array' };
  }
  if (!policy) return { ok: true };

  if (policy.maxOps != null && patches.length > policy.maxOps) {
    return { ok: false, error: `patches exceed maxOps (${policy.maxOps})` };
  }

  const allowed = policy.allowedPathPrefixes;
  const denied = policy.deniedPathPrefixes || [];
  const maxDepth = policy.maxPathDepth;

  for (const op of patches) {
    if (!op || typeof op !== 'object') {
      return { ok: false, error: 'invalid patch op' };
    }
    const path = typeof op.path === 'string' ? op.path : '';
    if (!path.startsWith('/')) {
      return { ok: false, error: `invalid patch path: ${path || '(empty)'}` };
    }
    const depth = path === '/' ? 0 : path.split('/').length - 1;
    if (maxDepth != null && depth > maxDepth) {
      return { ok: false, error: `path depth exceeds maxPathDepth (${maxDepth}): ${path}` };
    }
    if (denied.some((prefix) => _pathMatchesPrefix(path, prefix))) {
      return { ok: false, error: `path denied by policy: ${path}` };
    }
    if (Array.isArray(allowed) && allowed.length) {
      const okPath = allowed.some((prefix) => _pathMatchesPrefix(path, prefix));
      if (!okPath) {
        return { ok: false, error: `path not allowed by policy: ${path}` };
      }
    }
  }
  return { ok: true };
}

/** @private */
function _pathMatchesPrefix (path, prefix) {
  if (!prefix || typeof prefix !== 'string') return false;
  if (prefix === '/') return true;
  return path === prefix || path.startsWith(prefix + '/');
}

/**
 * @param {StatechainState} state
 * @param {object[]} patches RFC6902 operations on `state.content`
 * @param {StatechainPathPolicy|null|undefined} [policy]
 * @returns {{ ok: boolean, state?: StatechainState, error?: string, newDigest?: string, basisDigest?: string }}
 */
function applyPatchesToState (state, patches, policy) {
  if (!Array.isArray(patches) || !patches.length) {
    return { ok: false, error: 'patches must be a non-empty array' };
  }
  const verr = validate(patches);
  if (verr) {
    return { ok: false, error: verr.message || String(verr) };
  }
  const policyCheck = validatePatchesAgainstPolicy(patches, policy);
  if (!policyCheck.ok) return policyCheck;

  const basisDigest = stateDigest(state);
  const next = {
    version: state.version != null ? Number(state.version) : 1,
    clock: Number(state.clock) || 0,
    content: JSON.parse(JSON.stringify(state.content || {}))
  };
  try {
    applyPatch(next.content, patches, true, true);
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
  next.clock = next.clock + 1;
  return { ok: true, state: next, newDigest: stateDigest(next), basisDigest };
}

function _cloneState (state) {
  return {
    version: state.version != null ? Number(state.version) : 1,
    clock: Number(state.clock) || 0,
    content: JSON.parse(JSON.stringify(state.content && typeof state.content === 'object' ? state.content : {}))
  };
}

/**
 * Sanitize a contract / namespace id for store paths (hex-ish Fabric Actor ids).
 * @param {string} contractId
 * @returns {string}
 */
function normalizeContractId (contractId) {
  const id = String(contractId || '').trim().toLowerCase();
  if (!id || id.includes('/') || id.includes('..') || id.length > 128) {
    throw new Error('invalid contractId for contract Statechain');
  }
  return id;
}

/**
 * Store paths for a Contract-published contract Statechain (same layout as Hub root).
 * @param {string} contractId
 * @returns {{ contractId: string, base: string, state: string, snapshots: string, journal: string }}
 */
function storePathsForContract (contractId) {
  const id = normalizeContractId(contractId);
  const base = `sidechains/${id}`;
  return {
    contractId: id,
    base,
    state: `${base}/STATE`,
    snapshots: `${base}/SNAPSHOTS`,
    journal: `${base}/JOURNAL`
  };
}

/**
 * JSON Pointer on the **parent** Statechain content where the child head is sealed.
 * @param {string} contractId
 * @returns {string}
 */
function parentSealPath (contractId) {
  return `/namespaces/${normalizeContractId(contractId)}`;
}

/**
 * Compact public head for parent seal / Beacon contracts root sync.
 * @param {string} contractId
 * @param {StatechainState} state
 * @param {{ name?: string|null, parentContractId?: string|null }} [meta]
 * @returns {{ contractId: string, clock: number, stateDigest: string, name: string|null, parentContractId: string|null }}
 */
function namespaceHeadFromState (contractId, state, meta = {}) {
  const id = normalizeContractId(contractId);
  return {
    contractId: id,
    clock: Number(state && state.clock) || 0,
    stateDigest: stateDigest(state || createInitialState()),
    name: meta.name != null ? String(meta.name) : null,
    parentContractId: meta.parentContractId != null ? String(meta.parentContractId) : null
  };
}

/**
 * RFC6902 patches to publish / replace a namespace head under `/namespaces/<id>`.
 * @param {object|null|undefined} existingContent parent content
 * @param {string} contractId
 * @param {object} head from {@link namespaceHeadFromState}
 * @returns {object[]}
 */
function patchesForNamespaceHead (existingContent, contractId, head) {
  const id = normalizeContractId(contractId);
  const path = parentSealPath(id);
  const key = 'namespaces';
  const namespaces = existingContent && existingContent[key] && typeof existingContent[key] === 'object'
    ? existingContent[key]
    : null;
  const prev = namespaces && Object.prototype.hasOwnProperty.call(namespaces, id)
    ? namespaces[id]
    : null;
  if (prev && prev.stateDigest && head && head.stateDigest && prev.stateDigest === head.stateDigest &&
      Number(prev.clock) === Number(head.clock)) {
    return [];
  }
  if (!namespaces) {
    return [{
      op: 'add',
      path: `/${key}`,
      value: { [id]: jsonSafe(head) }
    }];
  }
  if (prev) {
    return [{ op: 'replace', path, value: jsonSafe(head) }];
  }
  return [{ op: 'add', path, value: jsonSafe(head) }];
}

function loadStateAt (fs, statePath) {
  if (!fs || typeof fs.readFile !== 'function') return createInitialState();
  const path = statePath || SIDECHAIN_STATE_PATH;
  try {
    const raw = fs.readFile(path);
    if (!raw) return createInitialState();
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== 'object') return createInitialState();
    const clock = Number(parsed.clock) || 0;
    const content = parsed.content && typeof parsed.content === 'object' ? parsed.content : {};
    return { version: Number(parsed.version) || 1, clock, content };
  } catch (_) {
    return createInitialState();
  }
}

function loadState (fs) {
  return loadStateAt(fs, SIDECHAIN_STATE_PATH);
}

async function persistStateAt (fs, state, statePath) {
  if (!fs || typeof fs.publish !== 'function') return;
  const path = statePath || SIDECHAIN_STATE_PATH;
  const doc = {
    version: state.version != null ? Number(state.version) : 1,
    clock: Number(state.clock) || 0,
    content: jsonSafe(state.content || {})
  };
  await fs.publish(path, doc);
}

async function persistState (fs, state) {
  return persistStateAt(fs, state, SIDECHAIN_STATE_PATH);
}

/**
 * Ensure a contract Statechain document exists for an accepted CONTRACT_PUBLISH id.
 * @param {*} fs
 * @param {string} contractId
 * @returns {Promise<{ paths: object, state: StatechainState, created: boolean }>}
 */
async function ensureContractStatechain (fs, contractId) {
  const paths = storePathsForContract(contractId);
  let existed = false;
  if (fs && typeof fs.readFile === 'function') {
    try {
      existed = !!fs.readFile(paths.state);
    } catch (_) {
      existed = false;
    }
  }
  const state = loadStateAt(fs, paths.state);
  if (!existed) {
    await persistStateAt(fs, state, paths.state);
  }
  return { paths, state, created: !existed };
}

function loadSnapshotsDoc (fs) {
  if (!fs || typeof fs.readFile !== 'function') return { version: 1, byClock: {} };
  try {
    const raw = fs.readFile(SIDECHAIN_SNAPSHOTS_PATH);
    if (!raw) return { version: 1, byClock: {} };
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : JSON.parse(raw.toString('utf8'));
    if (!parsed || typeof parsed !== 'object') return { version: 1, byClock: {} };
    const byClock = parsed.byClock && typeof parsed.byClock === 'object' ? parsed.byClock : {};
    return { version: 1, byClock };
  } catch (_) {
    return { version: 1, byClock: {} };
  }
}

function loadSnapshotForBeaconClock (fs, beaconClock) {
  const doc = loadSnapshotsDoc(fs);
  const key = String(beaconClock);
  const s = doc.byClock[key];
  if (!s || typeof s !== 'object') return null;
  return {
    version: Number(s.version) || 1,
    clock: Number(s.clock) || 0,
    content: s.content && typeof s.content === 'object' ? JSON.parse(JSON.stringify(s.content)) : {}
  };
}

function saveSnapshotForBeaconClockSync (fs, beaconClock, state) {
  if (!fs || typeof fs.writeFile !== 'function') return false;
  const key = String(beaconClock);
  if (!key || key === 'undefined') return false;
  const doc = loadSnapshotsDoc(fs);
  doc.byClock[key] = jsonSafe(_cloneState(state));
  return fs.writeFile(SIDECHAIN_SNAPSHOTS_PATH, JSON.stringify(doc, null, 2));
}

function pruneSnapshotsForRemovedBeaconClocksSync (fs, removedBeaconClocks) {
  if (!fs || typeof fs.writeFile !== 'function') return false;
  if (!Array.isArray(removedBeaconClocks) || !removedBeaconClocks.length) return true;
  const doc = loadSnapshotsDoc(fs);
  for (const c of removedBeaconClocks) {
    const k = String(c);
    if (doc.byClock[k]) delete doc.byClock[k];
  }
  return fs.writeFile(SIDECHAIN_SNAPSHOTS_PATH, JSON.stringify(doc, null, 2));
}

function pruneSnapshotsAfterBeaconClockSync (fs, tipBeaconClock) {
  if (!fs || typeof fs.writeFile !== 'function') return false;
  const doc = loadSnapshotsDoc(fs);
  const tip = Number(tipBeaconClock);
  if (!Number.isFinite(tip)) return true;
  for (const k of Object.keys(doc.byClock)) {
    const n = Number(k);
    if (Number.isFinite(n) && n > tip) delete doc.byClock[k];
  }
  return fs.writeFile(SIDECHAIN_SNAPSHOTS_PATH, JSON.stringify(doc, null, 2));
}

function loadJournalDoc (fs) {
  if (!fs || typeof fs.readFile !== 'function') return { version: 1, entries: [] };
  try {
    const raw = fs.readFile(SIDECHAIN_JOURNAL_PATH);
    if (!raw) return { version: 1, entries: [] };
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : JSON.parse(raw.toString('utf8'));
    if (!parsed || typeof parsed !== 'object') return { version: 1, entries: [] };
    const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
    return { version: 1, entries };
  } catch (_) {
    return { version: 1, entries: [] };
  }
}

/**
 * Append a patch transition for audit / unsealed recovery.
 * @returns {object|null} the entry written
 */
function appendJournalEntrySync (fs, entry) {
  if (!fs || typeof fs.writeFile !== 'function') return null;
  const doc = loadJournalDoc(fs);
  const row = {
    seq: doc.entries.length + 1,
    at: new Date().toISOString(),
    basisClock: Number(entry.basisClock) || 0,
    clock: Number(entry.clock) || 0,
    basisDigest: String(entry.basisDigest || ''),
    newDigest: String(entry.newDigest || ''),
    patchDigest: String(entry.patchDigest || ''),
    patches: jsonSafe(entry.patches || []),
    sealedBeaconClock: entry.sealedBeaconClock != null ? Number(entry.sealedBeaconClock) : null
  };
  doc.entries.push(row);
  fs.writeFile(SIDECHAIN_JOURNAL_PATH, JSON.stringify(doc, null, 2));
  return row;
}

/**
 * Mark journal rows with sidechain clock <= sealedSidechainClock as sealed to this beacon epoch.
 */
function sealJournalThroughSidechainClockSync (fs, sealedSidechainClock, beaconClock) {
  if (!fs || typeof fs.writeFile !== 'function') return false;
  const tip = Number(sealedSidechainClock);
  const bc = Number(beaconClock);
  if (!Number.isFinite(tip) || !Number.isFinite(bc)) return false;
  const doc = loadJournalDoc(fs);
  let changed = false;
  for (const e of doc.entries) {
    if (e.sealedBeaconClock == null && Number(e.clock) <= tip) {
      e.sealedBeaconClock = bc;
      changed = true;
    }
  }
  if (!changed) return true;
  return fs.writeFile(SIDECHAIN_JOURNAL_PATH, JSON.stringify(doc, null, 2));
}

/**
 * Drop journal entries sealed to removed beacon clocks; keep unsealed and still-valid seals.
 */
function pruneJournalForRemovedBeaconClocksSync (fs, removedBeaconClocks) {
  if (!fs || typeof fs.writeFile !== 'function') return false;
  if (!Array.isArray(removedBeaconClocks) || !removedBeaconClocks.length) return true;
  const removed = new Set(removedBeaconClocks.map((c) => Number(c)).filter((n) => Number.isFinite(n)));
  const doc = loadJournalDoc(fs);
  doc.entries = doc.entries.filter((e) => {
    if (e.sealedBeaconClock == null) return true;
    return !removed.has(Number(e.sealedBeaconClock));
  });
  return fs.writeFile(SIDECHAIN_JOURNAL_PATH, JSON.stringify(doc, null, 2));
}

/**
 * Replay unsealed journal entries that build on `basis` (sequential by clock).
 * @returns {{ state: StatechainState, applied: number }}
 */
function replayUnsealedJournalEntries (basis, journalEntries, policy) {
  let state = _cloneState(basis);
  let applied = 0;
  const pending = (Array.isArray(journalEntries) ? journalEntries : [])
    .filter((e) => e && e.sealedBeaconClock == null)
    .sort((a, b) => Number(a.clock) - Number(b.clock));
  for (const e of pending) {
    if (Number(e.basisClock) !== Number(state.clock)) continue;
    const dig = stateDigest(state);
    if (e.basisDigest && e.basisDigest !== dig) continue;
    const r = applyPatchesToState(state, e.patches, policy);
    if (!r.ok) break;
    state = r.state;
    applied++;
  }
  return { state, applied };
}

/**
 * Unified tip restore: snapshot → digest-match loaded STATE → genesis.
 * Optionally replay unsealed journal entries after the sealed tip.
 *
 * @param {{
 *   tipPayload: object|null,
 *   snapshot: StatechainState|null,
 *   loadedState: StatechainState|null,
 *   journalEntries?: object[],
 *   policy?: StatechainPathPolicy|null,
 *   replayUnsealed?: boolean
 * }} args
 * @returns {{
 *   state: StatechainState,
 *   source: 'snapshot'|'digest-match'|'genesis',
 *   unsealedApplied: number,
 *   warning?: string
 * }}
 */
function resolveStateForBeaconTip (args = {}) {
  const tipPayload = args.tipPayload || null;
  const snapshot = args.snapshot || null;
  const loadedState = args.loadedState || null;
  const replay = args.replayUnsealed !== false;
  const policy = args.policy || null;
  const journalEntries = args.journalEntries || [];

  let state = null;
  let source = 'genesis';
  let warning;

  if (snapshot && typeof snapshot === 'object') {
    state = _cloneState(snapshot);
    source = 'snapshot';
  } else if (loadedState && tipPayload && tipPayload.sidechain && tipPayload.sidechain.stateDigest) {
    const dig = stateDigest(loadedState);
    if (dig === String(tipPayload.sidechain.stateDigest)) {
      state = _cloneState(loadedState);
      source = 'digest-match';
    }
  }

  if (!state) {
    state = createInitialState();
    source = 'genesis';
    if (tipPayload && tipPayload.clock != null) {
      warning = `no snapshot for beacon clock ${tipPayload.clock}; reset to genesis`;
    }
  }

  let unsealedApplied = 0;
  if (replay && journalEntries.length) {
    const r = replayUnsealedJournalEntries(state, journalEntries, policy);
    state = r.state;
    unsealedApplied = r.applied;
  }

  return { state, source, unsealedApplied, warning };
}

/**
 * Serialize async work on a single chain (patch submits, reorg vs patch races).
 * @returns {(fn: () => Promise<*>) => Promise<*>}
 */
function createSerializeQueue () {
  let tail = Promise.resolve();
  return function runSerialized (fn) {
    const next = tail.then(() => fn());
    // Keep queue alive after rejections
    tail = next.then(() => undefined, () => undefined);
    return next;
  };
}

/**
 * Build GenericMessage / activity JSON body for a statechain patch proposal.
 * @param {{ basisClock: number, basisDigest: string, patches: object[], federationWitness?: object }} proposal
 */
function encodeSidechainStatePatchMessage (proposal) {
  return {
    type: SIDECHAIN_STATE_PATCH_TYPE,
    version: 1,
    kind: SIDECHAIN_PATCH_KIND,
    basisClock: Number(proposal.basisClock),
    basisDigest: String(proposal.basisDigest || ''),
    patches: jsonSafe(proposal.patches || []),
    federationWitness: proposal.federationWitness || null
  };
}

/**
 * @param {object} body
 * @returns {{ ok: boolean, proposal?: object, error?: string }}
 */
function parseSidechainStatePatchMessage (body) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'body must be an object' };
  const type = body.type || body['@type'];
  if (type && type !== SIDECHAIN_STATE_PATCH_TYPE && body.kind !== SIDECHAIN_PATCH_KIND) {
    return { ok: false, error: 'not a SIDECHAIN_STATE_PATCH message' };
  }
  if (!Array.isArray(body.patches) || !body.patches.length) {
    return { ok: false, error: 'patches required' };
  }
  const basisClock = body.basisClock != null ? Number(body.basisClock) : NaN;
  if (!Number.isFinite(basisClock)) return { ok: false, error: 'basisClock required' };
  return {
    ok: true,
    proposal: {
      basisClock,
      basisDigest: body.basisDigest != null ? String(body.basisDigest) : '',
      patches: body.patches,
      federationWitness: body.federationWitness || null
    }
  };
}

/**
 * Fail-closed check of federation witnesses on a loaded beacon epoch chain.
 * @param {Array<{ type?: string, payload?: object, federationWitness?: object }>} epochChain
 * @param {string[]} validators
 * @param {number} threshold
 * @returns {{ ok: boolean, failures: Array<{ clock: *, reason: string }> }}
 */
function verifyEpochChainFederationWitnesses (epochChain, validators, threshold) {
  const failures = [];
  const pubs = Array.isArray(validators) ? validators : [];
  if (!pubs.length) return { ok: true, failures };
  const thr = Math.max(1, Number(threshold) || 1);
  const chain = Array.isArray(epochChain) ? epochChain : [];
  for (const e of chain) {
    if (!e || e.type !== 'BEACON_EPOCH' || !e.payload) continue;
    const buf = Buffer.from(signingStringForBeaconEpoch(e.payload), 'utf8');
    const ok = verifyFederationWitnessOnMessage(buf, e.federationWitness, pubs, thr);
    if (!ok) {
      failures.push({
        clock: e.payload.clock,
        reason: 'federationWitness missing or invalid'
      });
    }
  }
  return { ok: failures.length === 0, failures };
}

/**
 * Operator/UI summary of the append-only journal (no full patch bodies by default).
 * @param {*} fs
 * @param {{ limit?: number, includePatches?: boolean }} [opts]
 */
function summarizeJournal (fs, opts = {}) {
  const doc = loadJournalDoc(fs);
  const limit = Math.max(1, Math.min(500, Number(opts.limit) || 50));
  const includePatches = !!opts.includePatches;
  const unsealedCount = doc.entries.filter((e) => e && e.sealedBeaconClock == null).length;
  const slice = doc.entries.slice(-limit).reverse();
  const entries = slice.map((e) => {
    const row = {
      seq: e.seq,
      at: e.at || null,
      basisClock: Number(e.basisClock) || 0,
      clock: Number(e.clock) || 0,
      sealedBeaconClock: e.sealedBeaconClock != null ? Number(e.sealedBeaconClock) : null,
      basisDigest: e.basisDigest || null,
      newDigest: e.newDigest || null,
      patchDigest: e.patchDigest || null,
      opCount: Array.isArray(e.patches) ? e.patches.length : 0,
      paths: Array.isArray(e.patches)
        ? e.patches.map((p) => (p && p.path != null ? String(p.path) : '')).filter(Boolean).slice(0, 12)
        : []
    };
    if (includePatches) row.patches = e.patches || [];
    return row;
  });
  return {
    version: 1,
    path: SIDECHAIN_JOURNAL_PATH,
    entryCount: doc.entries.length,
    unsealedCount,
    entries
  };
}

/**
 * Operator/UI list of sealed snapshots keyed by beacon clock (digests, not full content).
 * @param {*} fs
 * @param {{ limit?: number, includeContent?: boolean }} [opts]
 */
function summarizeSnapshots (fs, opts = {}) {
  const doc = loadSnapshotsDoc(fs);
  const limit = Math.max(1, Math.min(500, Number(opts.limit) || 50));
  const includeContent = !!opts.includeContent;
  const clocks = Object.keys(doc.byClock)
    .map((k) => Number(k))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => b - a)
    .slice(0, limit);
  const snapshots = clocks.map((beaconClock) => {
    const s = doc.byClock[String(beaconClock)];
    const state = {
      version: Number(s && s.version) || 1,
      clock: Number(s && s.clock) || 0,
      content: (s && s.content && typeof s.content === 'object') ? s.content : {}
    };
    const row = {
      beaconClock,
      sidechainClock: state.clock,
      stateDigest: stateDigest(state)
    };
    if (includeContent) {
      row.content = state.content;
      row.version = state.version;
    }
    return row;
  });
  return {
    version: 1,
    path: SIDECHAIN_SNAPSHOTS_PATH,
    snapshotCount: Object.keys(doc.byClock).length,
    snapshots
  };
}

module.exports = {
  SIDECHAIN_STATE_PATH,
  SIDECHAIN_SNAPSHOTS_PATH,
  SIDECHAIN_JOURNAL_PATH,
  SIDECHAIN_PATCH_KIND,
  SIDECHAIN_STATE_PATCH_TYPE,
  signingStringForSidechainStatePatch,
  patchCommitmentDigestHex,
  createInitialState,
  stateDigest,
  parseStatechainPathPolicy,
  validatePatchesAgainstPolicy,
  applyPatchesToState,
  loadState,
  persistState,
  loadStateAt,
  persistStateAt,
  normalizeContractId,
  storePathsForContract,
  parentSealPath,
  namespaceHeadFromState,
  patchesForNamespaceHead,
  ensureContractStatechain,
  loadSnapshotForBeaconClock,
  saveSnapshotForBeaconClockSync,
  pruneSnapshotsForRemovedBeaconClocksSync,
  pruneSnapshotsAfterBeaconClockSync,
  loadJournalDoc,
  appendJournalEntrySync,
  sealJournalThroughSidechainClockSync,
  pruneJournalForRemovedBeaconClocksSync,
  replayUnsealedJournalEntries,
  resolveStateForBeaconTip,
  createSerializeQueue,
  encodeSidechainStatePatchMessage,
  parseSidechainStatePatchMessage,
  verifyEpochChainFederationWitnesses,
  summarizeJournal,
  summarizeSnapshots
};
