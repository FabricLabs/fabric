'use strict';

/**
 * Tip-bound / opaque Application Resource Contract message accumulation.
 *
 * Publisher and participants ingest the same signed Fabric Message bytes from
 * any origin (mesh, hub queue, copy-paste). Identity is the AMP body hash;
 * fold order is sorted by hash so arrival order does not change tip state.
 *
 * Authz (ARC / PR #183 F1): member and spend mutations require the AMP author
 * to be in the current tip signer set (or genesis signers when the tip roster
 * is empty) or to present a verified OP_CONTRACT_SIGN Token for this contract.
 *
 * @module functions/contractMessageAccumulate
 */

const crypto = require('crypto');
const Message = require('../types/message');
const Key = require('../types/key');
const { HEADER_SIZE, MAX_MESSAGE_SIZE } = require('../constants');
const { OUTER, CONTRACT_BODY_TYPES, isKnownContractBodyType } = require('./applicationNamespaces');
const { pubkeyXOnly, pubkeyCompressed } = require('./groupChatSeal');
const {
  OP_CONTRACT_READ,
  OP_CONTRACT_SIGN,
  verifyContractCapability
} = require('./contractCapability');
const {
  validateWithdrawalRequest,
  verifyWithdrawalWitnessSignature
} = require('./contractSpend');
const {
  GOVERNANCE_ACTIONS,
  proposalIdOf,
  verifyProposalVote,
  applyGroupChangeAction,
  foldProposals
} = require('./groupChangeGovernance');

const Actor = require('../types/actor');

const COLLECTION = 'contractmessages';
const ORIGINS = Object.freeze(['mesh', 'queue', 'paste', 'local']);
/** Compactable journal rows (mutations are never dropped). */
const COMPACTABLE_TYPES = Object.freeze(['GroupChat', 'MessageReceived', 'MessageReceipt']);
const ABSOLUTE_MAX_JOURNAL_ENTRIES = 20000;
const DEFAULT_MAX_JOURNAL_ENTRIES = ABSOLUTE_MAX_JOURNAL_ENTRIES;

/**
 * Body types that require current signer / federation validator (or verified
 * OP_CONTRACT_SIGN). Includes governance / invite / journal-request frames so
 * outsiders cannot advance tip clock / stateDigest with AMP-signed spam.
 */
const SIGNER_MUTATION_TYPES = Object.freeze([
  'GroupChange',
  'GroupChangeProposal',
  'GroupChangeVote',
  'FederationContractInvite',
  'FederationContractInviteResponse',
  'GroupJournalRequest',
  'ContractCapabilityGrant',
  'ContractWithdrawalRequest',
  'ContractWithdrawalWitness',
  'GroupJournalBatch',
  'GroupStateJournal'
]);

/**
 * Delivery 2PC ACKs — stored + relayed as CONTRACT_MESSAGE like any other type, but
 * excluded from tip clock / stateDigest (sidecar via contractMessageCommit).
 *
 * They are also excluded from the **synchronization filter**: ACKs never
 * themselves open a new pending 2PC row (no ack-of-ack).
 */
const DELIVERY_ACK_TYPES = Object.freeze([
  CONTRACT_BODY_TYPES.MessageReceived,
  CONTRACT_BODY_TYPES.MessageReceipt
]);

/**
 * Control-plane types excluded from delivery sync by default (still tip-stored
 * when allowed by primitives). Apps override via genesis
 * `primitives.deliverySync`.
 */
const DEFAULT_SYNC_EXCLUDE = Object.freeze([
  CONTRACT_BODY_TYPES.MessageReceived,
  CONTRACT_BODY_TYPES.MessageReceipt,
  CONTRACT_BODY_TYPES.GroupJournalRequest || 'GroupJournalRequest'
]);

function isDeliveryAckType (type) {
  return DELIVERY_ACK_TYPES.includes(String(type || ''));
}

function isCompactableType (type) {
  return COMPACTABLE_TYPES.includes(String(type || ''));
}

function clampJournalEntries (value, fallback = DEFAULT_MAX_JOURNAL_ENTRIES) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), ABSOLUTE_MAX_JOURNAL_ENTRIES);
}

/**
 * Drop lowest-hash compactable rows until length ≤ max. Mutation / governance
 * rows are never evicted (fold must still reconstruct the roster).
 * @param {object[]} entries
 * @param {number} maxEntries
 * @returns {object[]}
 */
function compactJournalEntries (entries, maxEntries) {
  const list = Array.isArray(entries) ? entries : [];
  const max = clampJournalEntries(maxEntries, DEFAULT_MAX_JOURNAL_ENTRIES);
  if (list.length <= max) return list;
  const pinned = [];
  const compactable = [];
  for (const row of list) {
    if (isCompactableType(row && row.type)) compactable.push(row);
    else pinned.push(row);
  }
  const overflow = pinned.length + compactable.length - max;
  if (overflow <= 0) return list;
  compactable.sort((a, b) => {
    const ha = String(a && a.hash || '');
    const hb = String(b && b.hash || '');
    if (ha < hb) return -1;
    if (ha > hb) return 1;
    return 0;
  });
  const keptCompact = compactable.slice(overflow);
  return pinned.concat(keptCompact);
}

function resolveMaxJournalEntries (doc, meta = {}) {
  const fromGenesis = doc && doc.genesis && doc.genesis.primitives
    && doc.genesis.primitives.maxJournalEntries;
  if (fromGenesis != null) {
    return clampJournalEntries(fromGenesis, DEFAULT_MAX_JOURNAL_ENTRIES);
  }
  if (doc && doc.maxJournalEntries != null) {
    return clampJournalEntries(doc.maxJournalEntries, DEFAULT_MAX_JOURNAL_ENTRIES);
  }
  // Local bootstrap only: never overrides a contract-wide cap.
  if (meta.maxJournalEntries != null) {
    return clampJournalEntries(meta.maxJournalEntries, DEFAULT_MAX_JOURNAL_ENTRIES);
  }
  return DEFAULT_MAX_JOURNAL_ENTRIES;
}

function _commit () {
  // Lazy require avoids circular init with contractMessageCommit → groupChatSeal.
  return require('./contractMessageCommit');
}

/**
 * Resolve genesis/meta delivery-sync policy.
 * @param {object} doc
 * @param {object} [meta]
 * @returns {{ mode: string, types: string[] }}
 */
function resolveDeliverySyncPolicy (doc = {}, meta = {}) {
  const fromGenesis = doc.genesis && doc.genesis.primitives && doc.genesis.primitives.deliverySync;
  const fromMeta = meta.primitives && meta.primitives.deliverySync;
  const raw = (fromGenesis && typeof fromGenesis === 'object')
    ? fromGenesis
    : ((fromMeta && typeof fromMeta === 'object') ? fromMeta : null);
  if (!raw) return { mode: 'all', types: [] };
  const mode = String(raw.mode || 'all').toLowerCase();
  const types = Array.isArray(raw.types)
    ? raw.types.map((t) => String(t || '').trim()).filter(Boolean)
    : [];
  return { mode, types };
}

/**
 * Synchronization filter: which accumulated CONTRACT_MESSAGE body types open a
 * per-reader MessageReceived / MessageReceipt 2PC row.
 *
 * Hard rule: delivery ACK types never open a new pending row.
 * Default: all other types except {@link DEFAULT_SYNC_EXCLUDE}.
 * Override: genesis `primitives.deliverySync` =
 *   `{ mode: 'all'|'none'|'include'|'exclude', types?: string[] }`.
 *
 * @param {string} type
 * @param {object} [doc]
 * @param {object} [meta]
 * @returns {boolean}
 */
function isSyncTrackedType (type, doc = {}, meta = {}) {
  const t = String(type || '').trim();
  if (!t || isDeliveryAckType(t)) return false;
  const policy = resolveDeliverySyncPolicy(doc, meta);
  if (policy.mode === 'none') return false;
  if (policy.mode === 'include') return policy.types.includes(t);
  if (policy.mode === 'exclude') {
    // Explicit denylist on top of the hard ACK exclusion above.
    return !policy.types.includes(t);
  }
  // mode === 'all' (default): track content types; skip default control-plane excludes
  return !DEFAULT_SYNC_EXCLUDE.includes(t);
}

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

/**
 * @param {Iterable<*>} list
 * @returns {string[]}
 */
function normalizePubkeyList (list) {
  const out = [];
  const seen = new Set();
  let publicRead = false;
  for (const m of list || []) {
    if (m === '*' || String(m == null ? '' : m).trim() === '*') {
      publicRead = true;
      continue;
    }
    const x = pubkeyXOnly(m);
    if (!x || seen.has(x)) continue;
    seen.add(x);
    out.push(x);
  }
  // Preserve ARC public-reader wildcard (docs/CONTRACTS.md, beacon / blinded genesis).
  if (publicRead) out.push('*');
  return out.sort();
}

/**
 * @param {string[]} readers
 * @param {string} authorXOnly
 * @returns {boolean}
 */
function authorAllowedByReaders (readers, authorXOnly) {
  if (!Array.isArray(readers) || !readers.length) return false;
  if (readers.includes('*')) return true;
  return readers.includes(authorXOnly);
}

/**
 * Normalize genesis / meta into a persisted ARC policy bag.
 * @param {object} raw
 * @returns {object}
 */
function normalizeGenesis (raw = {}) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const members = src.members && typeof src.members === 'object' ? src.members : {};
  const proposed = src.proposedPolicy && typeof src.proposedPolicy === 'object'
    ? src.proposedPolicy
    : {};
  const spendPolicy = src.spendPolicy && typeof src.spendPolicy === 'object'
    ? src.spendPolicy
    : {};
  const signers = normalizePubkeyList(
    src.signers
    || members.signers
    || src.validators
    || src.parties
    || spendPolicy.validators
    || proposed.validators
    || []
  );
  const readers = normalizePubkeyList(src.readers || members.readers || []);
  let primitives = null;
  if (src.primitives && typeof src.primitives === 'object') {
    primitives = {};
    if (Array.isArray(src.primitives.messageTypes)) {
      primitives.messageTypes = src.primitives.messageTypes.map((t) => String(t || '').trim()).filter(Boolean);
    }
    if (Array.isArray(src.primitives.opcodes)) {
      primitives.opcodes = src.primitives.opcodes.map((t) => String(t || '').trim()).filter(Boolean);
    }
    if (src.primitives.deliverySync && typeof src.primitives.deliverySync === 'object') {
      const ds = src.primitives.deliverySync;
      primitives.deliverySync = {
        mode: String(ds.mode || 'all').toLowerCase(),
        types: Array.isArray(ds.types)
          ? ds.types.map((t) => String(t || '').trim()).filter(Boolean)
          : []
      };
    }
    if (src.primitives.maxJournalEntries != null) {
      primitives.maxJournalEntries = clampJournalEntries(
        src.primitives.maxJournalEntries,
        DEFAULT_MAX_JOURNAL_ENTRIES
      );
    }
  }
  // Hub / Federation application genesis may declare messageTypes at the top level.
  if (Array.isArray(src.messageTypes)) {
    if (!primitives) primitives = {};
    if (!Array.isArray(primitives.messageTypes)) {
      primitives.messageTypes = src.messageTypes.map((t) => String(t || '').trim()).filter(Boolean);
    }
  }
  let bitcoinAnchor = null;
  if (src.bitcoinAnchor && src.bitcoinAnchor.blockHash) {
    bitcoinAnchor = {
      blockHash: String(src.bitcoinAnchor.blockHash).trim().toLowerCase(),
      height: src.bitcoinAnchor.height != null ? Number(src.bitcoinAnchor.height) : undefined
    };
  }
  const thresholdRaw = src.threshold != null
    ? src.threshold
    : (members.threshold != null
      ? members.threshold
      : (proposed.threshold != null
        ? proposed.threshold
        : spendPolicy.threshold));
  const threshold = thresholdRaw != null ? Number(thresholdRaw) : undefined;
  return {
    signers,
    readers,
    primitives,
    bitcoinAnchor,
    threshold: Number.isFinite(threshold) ? threshold : undefined
  };
}

/**
 * Merge genesis from ingest meta into doc (first write wins).
 * @param {object} doc
 * @param {object} meta
 * @returns {object} doc
 */
function applyGenesisMeta (doc, meta = {}) {
  if (doc.genesis && typeof doc.genesis === 'object') return doc;
  let raw = null;
  if (meta.genesis && typeof meta.genesis === 'object') raw = meta.genesis;
  else if (Array.isArray(meta.signers) && meta.signers.length) {
    raw = {
      signers: meta.signers,
      readers: meta.readers,
      primitives: meta.primitives,
      bitcoinAnchor: meta.bitcoinAnchor,
      threshold: meta.threshold
    };
  } else if (meta.primitives || meta.bitcoinAnchor) {
    raw = {
      signers: meta.signers || [],
      readers: meta.readers || [],
      primitives: meta.primitives,
      bitcoinAnchor: meta.bitcoinAnchor,
      threshold: meta.threshold
    };
  }
  if (raw) doc.genesis = normalizeGenesis(raw);
  return doc;
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
      entries: Array.isArray(existing.entries) ? existing.entries.slice() : [],
      genesis: existing.genesis && typeof existing.genesis === 'object' ? existing.genesis : null,
      maxJournalEntries: existing.maxJournalEntries != null
        ? Number(existing.maxJournalEntries)
        : null,
      bitcoinBlockHash: existing.bitcoinBlockHash
        ? String(existing.bitcoinBlockHash).toLowerCase()
        : null,
      bitcoinHeight: existing.bitcoinHeight != null ? Number(existing.bitcoinHeight) : null
    };
  }
  return {
    id,
    version: 1,
    clock: 0,
    content: {},
    entries: [],
    genesis: null,
    maxJournalEntries: null,
    bitcoinBlockHash: null,
    bitcoinHeight: null
  };
}

function persistDoc (store, doc) {
  const row = {
    id: doc.id,
    version: doc.version,
    clock: doc.clock,
    content: doc.content,
    entries: doc.entries
  };
  if (doc.genesis) row.genesis = doc.genesis;
  if (doc.maxJournalEntries != null) row.maxJournalEntries = doc.maxJournalEntries;
  if (doc.bitcoinBlockHash) row.bitcoinBlockHash = doc.bitcoinBlockHash;
  if (doc.bitcoinHeight != null) row.bitcoinHeight = doc.bitcoinHeight;
  store.put(COLLECTION, doc.id, row);
  return doc;
}

/**
 * Tip roster when non-empty; otherwise genesis signers (bootstrap).
 * Prefer explicit `content.signers` (even when empty — do not widen to
 * participant `members`). Legacy tips without a `signers` field still use
 * `members` as the authority roster.
 * @param {object} doc
 * @returns {string[]}
 */
function currentSignerSet (doc) {
  if (doc.content && Object.prototype.hasOwnProperty.call(doc.content, 'signers')
    && Array.isArray(doc.content.signers)) {
    const tipSigners = normalizePubkeyList(doc.content.signers);
    if (tipSigners.length) return tipSigners;
    if (doc.genesis && Array.isArray(doc.genesis.signers)) {
      return normalizePubkeyList(doc.genesis.signers);
    }
    return [];
  }
  const tipMembers = normalizePubkeyList(
    (doc.content && Array.isArray(doc.content.members)) ? doc.content.members : []
  );
  if (tipMembers.length) return tipMembers;
  if (doc.genesis && Array.isArray(doc.genesis.signers)) {
    return normalizePubkeyList(doc.genesis.signers);
  }
  return [];
}

/**
 * @param {object} doc
 * @param {string} type
 * @param {object} [meta]
 * @returns {boolean}
 */
function messageTypeAllowed (doc, type, meta = {}) {
  const fromGenesis = doc.genesis && doc.genesis.primitives && Array.isArray(doc.genesis.primitives.messageTypes)
    ? doc.genesis.primitives.messageTypes
    : null;
  const fromMeta = meta.primitives && Array.isArray(meta.primitives.messageTypes)
    ? meta.primitives.messageTypes.map(String)
    : null;
  const allowed = fromGenesis || fromMeta;
  // Explicit empty allowlist is deny-all (presence of the array is the policy signal).
  if (allowed) return allowed.includes(type);
  return isKnownContractBodyType(type);
}

/**
 * Verified OP_CONTRACT_SIGN Token for author (issuer must be a current signer).
 * @param {object} doc
 * @param {string} authorXOnly
 * @param {string} [tokenString]
 * @returns {boolean}
 */
/**
 * @param {object} doc
 * @param {string} authorXOnly
 * @param {string} [tokenString]
 * @param {string} expectedCap
 * @returns {boolean}
 */
function authorHasCapabilityToken (doc, authorXOnly, tokenString, expectedCap) {
  if (!tokenString || typeof tokenString !== 'string') return false;
  if (!/^[0-9a-f]{64}$/.test(authorXOnly)) return false;
  const issuers = currentSignerSet(doc);
  if (!issuers.length) return false;
  for (const iss of issuers) {
    const candidates = [];
    try {
      candidates.push(pubkeyCompressed(iss));
    } catch (_) { /* fall through */ }
    // Try both SEC parity prefixes — Key.public may be even or odd Y.
    candidates.push(`02${iss}`, `03${iss}`);
    const seen = new Set();
    for (const compressed of candidates) {
      const c = String(compressed || '').toLowerCase();
      if (!/^(02|03)[0-9a-f]{64}$/.test(c) || seen.has(c)) continue;
      seen.add(c);
      try {
        const payload = verifyContractCapability(tokenString, {
          contractId: doc.id,
          expectedCap,
          issuerKey: { public: c }
        });
        if (!payload || payload.verified !== true) continue;
        if (pubkeyXOnly(payload.sub) === authorXOnly) return true;
      } catch (_) {
        /* try next candidate */
      }
    }
  }
  return false;
}

function authorHasSignToken (doc, authorXOnly, tokenString) {
  return authorHasCapabilityToken(doc, authorXOnly, tokenString, OP_CONTRACT_SIGN);
}

function authorHasReadToken (doc, authorXOnly, tokenString) {
  return authorHasCapabilityToken(doc, authorXOnly, tokenString, OP_CONTRACT_READ)
    || authorHasSignToken(doc, authorXOnly, tokenString);
}

/**
 * @param {object} doc
 * @param {string} type
 * @param {string} authorXOnly
 * @param {object} [meta]
 * @param {object} [bodyObject]
 * @returns {{ ok: boolean, error?: string }}
 */
function authorizeIngest (doc, type, authorXOnly, meta = {}, bodyObject = null) {
  if (!messageTypeAllowed(doc, type, meta)) {
    return { ok: false, error: 'message type not allowed by contract primitives' };
  }

  if (isDeliveryAckType(type)) {
    if (!/^[0-9a-f]{64}$/.test(authorXOnly)) {
      return { ok: false, error: 'invalid author' };
    }
    const readers = readerSetForDelivery(doc, meta);
    if (!readers.length) {
      return {
        ok: false,
        error: 'delivery ack requires genesis readers/signers or tip members (fail closed)'
      };
    }
    if (!authorAllowedByReaders(readers, authorXOnly)) {
      return { ok: false, error: 'author not in contract reader set' };
    }
    const target = String(
      (bodyObject && (bodyObject.messageId || bodyObject.wireHash || bodyObject.hash)) || ''
    ).toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(target)) {
      return { ok: false, error: 'delivery ack requires messageId (wire hash)' };
    }
    return { ok: true };
  }

  // GroupChat: reader ∪ signer (or verified OP_CONTRACT_READ / OP_CONTRACT_SIGN).
  if (type === 'GroupChat') {
    if (!/^[0-9a-f]{64}$/.test(authorXOnly)) {
      return { ok: false, error: 'invalid author' };
    }
    const readers = readerSetForDelivery(doc, meta);
    const signers = currentSignerSet(doc);
    const allowed = new Set(readers.concat(signers));
    if (!allowed.size) {
      return {
        ok: false,
        error: 'GroupChat requires genesis readers/signers or tip members (fail closed)'
      };
    }
    const token = meta.capabilityToken || meta.token;
    if (!authorAllowedByReaders(readers, authorXOnly)
      && !signers.includes(authorXOnly)
      && !authorHasReadToken(doc, authorXOnly, token)) {
      return { ok: false, error: 'author not in contract reader/signer set' };
    }
    return { ok: true };
  }

  const needsSigner = SIGNER_MUTATION_TYPES.includes(type);
  if (!needsSigner) {
    // Remaining types (custom genesis `primitives.messageTypes`, etc.): still require
    // author ∈ reader ∪ signer (or verified capability). Do not fail open.
    if (!/^[0-9a-f]{64}$/.test(authorXOnly)) {
      return { ok: false, error: 'invalid author' };
    }
    const readers = readerSetForDelivery(doc, meta);
    const signers = currentSignerSet(doc);
    const allowed = new Set(readers.concat(signers));
    if (!allowed.size) {
      return {
        ok: false,
        error: 'contract message requires genesis readers/signers or tip members (fail closed)'
      };
    }
    const token = meta.capabilityToken || meta.token;
    if (!authorAllowedByReaders(readers, authorXOnly)
      && !signers.includes(authorXOnly)
      && !authorHasReadToken(doc, authorXOnly, token)
      && !authorHasSignToken(doc, authorXOnly, token)) {
      return { ok: false, error: 'author not in contract reader/signer set' };
    }
    return { ok: true };
  }

  if (!/^[0-9a-f]{64}$/.test(authorXOnly)) {
    return { ok: false, error: 'invalid author' };
  }

  const signers = currentSignerSet(doc);
  if (!signers.length) {
    return {
      ok: false,
      error: 'signer mutation requires genesis.signers or tip members (fail closed)'
    };
  }

  const isSigner = signers.includes(authorXOnly)
    || authorHasSignToken(doc, authorXOnly, meta.capabilityToken || meta.token);
  if (!isSigner) {
    return { ok: false, error: 'author not authorized for signer mutation' };
  }

  if (type === 'ContractWithdrawalRequest' && bodyObject) {
    const tip = tipFromDoc(doc);
    const check = validateWithdrawalRequest(bodyObject, tip, {
      genesis: doc.genesis || meta.genesis || null
    });
    if (!check.ok) return { ok: false, error: check.error };
  }

  if (type === 'ContractWithdrawalWitness' && bodyObject) {
    const tip = tipFromDoc(doc);
    const requestId = String(bodyObject.requestId || '').toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(requestId)) {
      return { ok: false, error: 'witness requestId required' };
    }
    const pending = ((tip.content && tip.content.withdrawals) || [])
      .find((w) => w && String(w.requestId || '').toLowerCase() === requestId);
    if (!pending) {
      return { ok: false, error: 'witness requestId not found in tip withdrawals' };
    }
    const reqDigest = String(bodyObject.stateDigest || '').toLowerCase();
    const reqHash = String(bodyObject.bitcoinBlockHash || '').toLowerCase();
    // Bind to the withdrawal request's tip fields (not the post-request tip digest).
    if (pending.stateDigest) {
      if (!/^[0-9a-f]{64}$/.test(reqDigest)) {
        return { ok: false, error: 'witness stateDigest required' };
      }
      if (reqDigest !== String(pending.stateDigest).toLowerCase()) {
        return { ok: false, error: 'witness stateDigest does not match request' };
      }
    }
    if (pending.bitcoinBlockHash) {
      if (!/^[0-9a-f]{64}$/.test(reqHash)) {
        return { ok: false, error: 'witness bitcoinBlockHash required' };
      }
      if (reqHash !== String(pending.bitcoinBlockHash).toLowerCase()) {
        return { ok: false, error: 'witness bitcoinBlockHash does not match request' };
      }
    }
    const claimed = pubkeyXOnly(bodyObject.signer) || String(bodyObject.signer || '').toLowerCase();
    if (claimed && claimed !== authorXOnly) {
      return { ok: false, error: 'witness signer must match AMP author' };
    }
    const verified = verifyWithdrawalWitnessSignature({
      ...bodyObject,
      signer: authorXOnly
    });
    if (!verified.ok) {
      return { ok: false, error: verified.error || 'invalid witness signature' };
    }
  }

  if (type === 'GroupChangeProposal' && bodyObject) {
    const action = String(bodyObject.action || '');
    if (!GOVERNANCE_ACTIONS.includes(action)) {
      return { ok: false, error: 'unsupported proposal action' };
    }
    if (!proposalIdOf(bodyObject)) {
      return { ok: false, error: 'proposal id required' };
    }
  }

  if (type === 'GroupChangeVote' && bodyObject) {
    const voter = pubkeyXOnly(bodyObject.voter) || String(bodyObject.voter || '').toLowerCase();
    if (voter !== authorXOnly) {
      return { ok: false, error: 'vote voter must match AMP author' };
    }
    const sig = String(bodyObject.signature || '').trim().toLowerCase();
    if (sig.startsWith('local:')) {
      return { ok: false, error: 'local vote signatures are not valid on the wire' };
    }
    if (!/^[0-9a-f]{128}$/.test(sig)) {
      return { ok: false, error: 'vote signature required (64-byte BIP340 hex)' };
    }
    const pid = String(bodyObject.proposalId || '').trim();
    if (!pid) return { ok: false, error: 'vote proposalId required' };
    const prior = (doc.entries || []).find((row) => {
      return row && row.type === 'GroupChangeProposal' && proposalIdOf(row.object) === pid;
    });
    if (prior && prior.object) {
      if (!verifyProposalVote(prior.object, authorXOnly, sig)) {
        return { ok: false, error: 'invalid vote signature' };
      }
    }
  }

  return { ok: true };
}

/**
 * Deterministic fold: sort by message hash, apply GroupChange then collect chats.
 * @param {object[]} entries
 * @returns {{ version: number, clock: number, content: object }}
 */
function foldContractState (entries = [], genesis = null) {
  const sorted = (Array.isArray(entries) ? entries.slice() : []).sort((a, b) => {
    // Byte-order / plain lexicographic on hex — not ICU localeCompare (tips must
    // converge across Node ICU builds).
    const ha = String(a.hash || '');
    const hb = String(b.hash || '');
    if (ha < hb) return -1;
    if (ha > hb) return 1;
    return 0;
  });
  const ctx = {
    members: new Set(),
    signers: new Set(),
    readerOnlyAdds: false,
    threshold: genesis && genesis.threshold != null ? Number(genesis.threshold) : null
  };
  const messages = [];
  const withdrawals = Object.create(null);
  for (const row of sorted) {
    const type = String(row.type || '');
    const obj = row.object && typeof row.object === 'object' ? row.object : {};
    if (type === 'GroupChange') {
      applyGroupChangeAction(ctx, obj);
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
    } else if (type === 'ContractWithdrawalRequest' && obj.requestId) {
      const id = String(obj.requestId).toLowerCase();
      withdrawals[id] = {
        requestId: id,
        hash: row.hash,
        author: row.author || null,
        stateDigest: obj.stateDigest || null,
        bitcoinBlockHash: obj.bitcoinBlockHash || null,
        bitcoinHeight: obj.bitcoinHeight != null ? Number(obj.bitcoinHeight) : null,
        destinationAddress: obj.destinationAddress || obj.destination || null,
        feeSats: obj.feeSats != null ? Number(obj.feeSats) : 0,
        action: obj.action === 'migrate' ? 'migrate' : 'spend',
        witnesses: (withdrawals[id] && withdrawals[id].witnesses) || []
      };
    } else if (type === 'ContractWithdrawalWitness' && obj.requestId) {
      const id = String(obj.requestId).toLowerCase();
      if (!withdrawals[id]) {
        withdrawals[id] = {
          requestId: id,
          hash: null,
          author: null,
          stateDigest: obj.stateDigest || null,
          bitcoinBlockHash: obj.bitcoinBlockHash || null,
          witnesses: []
        };
      }
      const sig = String(obj.signature || '').toLowerCase();
      const signer = pubkeyXOnly(obj.signer || row.author) || String(obj.signer || row.author || '').toLowerCase();
      // Fold only witnesses already accepted at ingest (AMP author === signer + BIP340).
      if (signer && sig && signer === String(row.author || '').toLowerCase()
        && !withdrawals[id].witnesses.some((w) => w.signer === signer && w.signature === sig)) {
        withdrawals[id].witnesses.push({
          hash: row.hash,
          signer,
          signature: sig
        });
      }
    }
  }
  const proposals = foldProposals(
    sorted,
    ctx,
    ctx.threshold,
    genesis && Array.isArray(genesis.signers) ? genesis.signers : []
  );
  const memberList = Array.from(ctx.members).sort();
  const signerList = ctx.readerOnlyAdds
    ? Array.from(ctx.signers).sort()
    : (ctx.signers.size ? Array.from(ctx.signers).sort() : memberList.slice());
  const content = {
    members: memberList,
    signers: signerList,
    messages,
    withdrawals: Object.keys(withdrawals).sort().map((k) => withdrawals[k])
  };
  if (proposals.length) content.proposals = proposals;
  if (ctx.threshold != null && Number.isFinite(Number(ctx.threshold))) {
    content.threshold = Math.max(1, Math.floor(Number(ctx.threshold)));
  }
  // Delivery ACKs are persisted in entries but do not advance tip clock / digest.
  const tipEntries = sorted.filter((row) => !isDeliveryAckType(row.type));
  const state = {
    version: 1,
    clock: tipEntries.length,
    content
  };
  return state;
}

/**
 * Reader roster for MessageReceived / MessageReceipt authz + 2PC sidecar.
 * @param {object} doc
 * @param {object} [meta]
 * @returns {string[]}
 */
function readerSetForDelivery (doc, meta = {}) {
  const tipMembers = normalizePubkeyList(
    (doc.content && Array.isArray(doc.content.members)) ? doc.content.members : []
  );
  if (tipMembers.length) return tipMembers;
  if (doc.genesis) {
    const fromGenesis = normalizePubkeyList(
      (doc.genesis.readers && doc.genesis.readers.length)
        ? doc.genesis.readers
        : doc.genesis.signers
    );
    if (fromGenesis.length) return fromGenesis;
  }
  return normalizePubkeyList(meta.readers || meta.signers || []);
}

/**
 * Open a pending 2PC sidecar row for a sync-tracked content frame.
 * @param {{ get: Function, put: Function }} store
 * @param {object} doc
 * @param {object} entry
 * @param {object} [meta]
 * @returns {object|null}
 */
function ensureDeliveryPending (store, doc, entry, meta = {}) {
  if (!store || !entry || !isSyncTrackedType(entry.type, doc, meta)) return null;
  const hash = String(entry.hash || '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hash)) return null;
  let readers = readerSetForDelivery(doc, meta);
  const author = String(entry.author || '').toLowerCase();
  if (author && !readers.includes(author)) readers = readers.concat([author]);
  if (!readers.length && author) readers = [author];
  if (!readers.length) return null;

  let record = store.get('contractmessagecommits', hash);
  if (record) return record;
  record = _commit().createPending({
    id: hash,
    contractId: doc.id,
    wireHash: hash,
    contentHash: entry.object && entry.object.contentHash
      ? String(entry.object.contentHash).toLowerCase()
      : null,
    readers
  });
  record.sourceType = String(entry.type);
  store.put('contractmessagecommits', hash, record);
  return record;
}

/**
 * Fold a stored MessageReceived / MessageReceipt entry into the 2PC sidecar.
 * Does not alter tip content / stateDigest.
 * @param {{ get: Function, put: Function }} store
 * @param {object} doc
 * @param {object} entry
 * @param {object} [meta]
 * @returns {object|null}
 */
function applyDeliveryAckEntry (store, doc, entry, meta = {}) {
  if (!store || !entry || !isDeliveryAckType(entry.type)) return null;
  const obj = entry.object && typeof entry.object === 'object' ? entry.object : {};
  const targetHash = String(obj.messageId || obj.wireHash || obj.hash || '').toLowerCase();
  const author = String(entry.author || '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(targetHash) || !/^[0-9a-f]{64}$/.test(author)) return null;

  let readers = readerSetForDelivery(doc, meta);
  if (!readers.includes(author)) readers = readers.concat([author]);
  if (!readers.length) readers = [author];

  let record = store.get('contractmessagecommits', targetHash);
  if (!record) {
    record = _commit().createPending({
      id: targetHash,
      contractId: doc.id,
      wireHash: targetHash,
      readers
    });
  }
  try {
    const commit = _commit();
    commit.markReceived(record, author, obj.receivedAt || entry.acceptedAt || undefined);
    if (entry.type === CONTRACT_BODY_TYPES.MessageReceipt ||
        obj.receipt || obj.receiptAt || obj['@type'] === 'MessageReceipt') {
      try {
        commit.markReceipt(
          record,
          author,
          obj.receiptAt || entry.acceptedAt || undefined,
          obj.receiptSig || null
        );
      } catch (receiptErr) {
        // Keep MessageReceived; leave receipt phase unset until a valid BIP340 receiptSig.
        void receiptErr;
      }
    }
    // Retain the AMP frame hex on the sidecar for later relay / audit.
    if (!Array.isArray(record.ackMessages)) record.ackMessages = [];
    if (entry.hex && !record.ackMessages.some((a) => a && a.hash === entry.hash)) {
      record.ackMessages.push({
        hash: entry.hash,
        type: entry.type,
        author,
        hex: entry.hex,
        acceptedAt: entry.acceptedAt || null
      });
    }
    store.put('contractmessagecommits', targetHash, record);
    return record;
  } catch (_) {
    return null;
  }
}

function tipFromDoc (doc) {
  const state = {
    version: doc.version,
    clock: doc.clock,
    content: doc.content
  };
  const tip = {
    contractId: doc.id,
    clock: state.clock,
    stateDigest: stateDigest(state),
    content: state.content
  };
  const blockHash = doc.bitcoinBlockHash
    || (doc.genesis && doc.genesis.bitcoinAnchor && doc.genesis.bitcoinAnchor.blockHash)
    || null;
  if (blockHash) tip.bitcoinBlockHash = blockHash;
  const height = doc.bitcoinHeight != null
    ? doc.bitcoinHeight
    : (doc.genesis && doc.genesis.bitcoinAnchor && doc.genesis.bitcoinAnchor.height);
  if (height != null && Number.isFinite(Number(height))) tip.bitcoinHeight = Number(height);
  return tip;
}

/**
 * Ingest signed Message bytes for a contract namespace.
 * @param {{ get: Function, put: Function }} store
 * @param {string} contractId
 * @param {Buffer|string} bufferOrPaste Buffer or fabric:/hex paste
 * @param {{
 *   origin?: string,
 *   genesis?: object,
 *   signers?: string[],
 *   readers?: string[],
 *   primitives?: object,
 *   bitcoinAnchor?: object,
 *   bitcoinBlockHash?: string,
 *   bitcoinHeight?: number,
 *   capabilityToken?: string,
 *   token?: string
 * }} [meta]
 * @returns {{ accepted: boolean, duplicate: boolean, entry: object|null, tip: object, error?: string }}
 */
function ingestMessageBuffer (store, contractId, bufferOrPaste, meta = {}) {
  const id = normalizeContractId(contractId);
  const origin = ORIGINS.includes(meta.origin) ? meta.origin : 'mesh';
  // Load once so rejected paths still return tipFromDoc without re-reading.
  const doc = loadDoc(store, id);
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
      tip: tipFromDoc(doc),
      error: e.message || 'invalid buffer'
    };
  }

  // Match Peer wire gate: drop oversized frames before parse / verify / JSON.
  if (buffer.length > HEADER_SIZE + MAX_MESSAGE_SIZE) {
    return {
      accepted: false,
      duplicate: false,
      entry: null,
      tip: tipFromDoc(doc),
      error: `message exceeds MAX_MESSAGE_SIZE (${MAX_MESSAGE_SIZE})`
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
      tip: tipFromDoc(doc),
      error: e.message || 'parse failed'
    };
  }

  if (!verifyMessageSignature(msg)) {
    return {
      accepted: false,
      duplicate: false,
      entry: null,
      tip: tipFromDoc(doc),
      error: 'invalid signature'
    };
  }

  const body = parseContractMessageBody(msg);
  if (!body) {
    return {
      accepted: false,
      duplicate: false,
      entry: null,
      tip: tipFromDoc(doc),
      error: 'not a CONTRACT_MESSAGE body'
    };
  }
  if (body.contract !== id) {
    return {
      accepted: false,
      duplicate: false,
      entry: null,
      tip: tipFromDoc(doc),
      error: 'contract id mismatch'
    };
  }

  const hash = messageHashHex(msg);
  applyGenesisMeta(doc, meta);

  if (doc.entries.some((e) => e && e.hash === hash)) {
    // Duplicate AMP frame: tip unchanged — skip re-fold / persist.
    return {
      accepted: false,
      duplicate: true,
      entry: null,
      tip: tipFromDoc(doc)
    };
  }

  const author = authorXOnlyHex(msg);
  const authz = authorizeIngest(doc, body.type, author, meta, body.object);
  if (!authz.ok) {
    return {
      accepted: false,
      duplicate: false,
      entry: null,
      tip: tipFromDoc(doc),
      error: authz.error || 'unauthorized'
    };
  }

  let bitcoinBlockHash = null;
  let bitcoinHeight = null;
  if (meta.bitcoinBlockHash != null && String(meta.bitcoinBlockHash).trim() !== '') {
    const bh = String(meta.bitcoinBlockHash).trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(bh)) {
      return {
        accepted: false,
        duplicate: false,
        entry: null,
        tip: tipFromDoc(doc),
        error: 'meta.bitcoinBlockHash must be 64 hex chars'
      };
    }
    bitcoinBlockHash = bh;
    if (meta.bitcoinHeight != null) bitcoinHeight = Number(meta.bitcoinHeight);
  }

  const entry = {
    hash,
    type: body.type,
    author,
    object: body.object,
    hex: buffer.toString('hex'),
    origin,
    acceptedAt: new Date().toISOString()
  };
  doc.entries.push(entry);
  const maxJournal = resolveMaxJournalEntries(doc, meta);
  doc.maxJournalEntries = maxJournal;
  doc.entries = compactJournalEntries(doc.entries, maxJournal);
  const state = foldContractState(doc.entries, doc.genesis);
  doc.version = state.version;
  doc.clock = state.clock;
  doc.content = state.content;

  if (bitcoinBlockHash) {
    doc.bitcoinBlockHash = bitcoinBlockHash;
    if (bitcoinHeight != null) doc.bitcoinHeight = bitcoinHeight;
  } else if (!doc.bitcoinBlockHash && doc.genesis && doc.genesis.bitcoinAnchor) {
    const genesisHash = String(doc.genesis.bitcoinAnchor.blockHash || '').trim().toLowerCase();
    if (/^[0-9a-f]{64}$/.test(genesisHash)) {
      doc.bitcoinBlockHash = genesisHash;
      if (doc.genesis.bitcoinAnchor.height != null) {
        doc.bitcoinHeight = Number(doc.genesis.bitcoinAnchor.height);
      }
    }
  }

  persistDoc(store, doc);

  if (isDeliveryAckType(entry.type)) {
    applyDeliveryAckEntry(store, doc, entry, meta);
  } else if (isSyncTrackedType(entry.type, doc, meta)) {
    ensureDeliveryPending(store, doc, entry, meta);
  }

  return {
    accepted: true,
    duplicate: false,
    entry,
    tip: tipFromDoc(doc)
  };
}

/**
 * Persist ARC genesis from a signed CONTRACT_PUBLISH so later GroupChange
 * ingest does not need meta.genesis on every call (first write wins).
 * @param {{ get: Function, put: Function }} store
 * @param {Buffer|string} bufferOrPaste
 * @param {object} [meta]
 * @returns {{ accepted: boolean, duplicate: boolean, contractId: string|null, genesis: object|null, error?: string }}
 */
function ingestContractPublishBuffer (store, bufferOrPaste, meta = {}) {
  let buffer;
  try {
    buffer = Buffer.isBuffer(bufferOrPaste) ? bufferOrPaste : bufferFromPaste(bufferOrPaste);
  } catch (e) {
    return { accepted: false, duplicate: false, contractId: null, genesis: null, error: e.message || 'invalid buffer' };
  }
  if (buffer.length > HEADER_SIZE + MAX_MESSAGE_SIZE) {
    return { accepted: false, duplicate: false, contractId: null, genesis: null, error: 'message exceeds MAX_MESSAGE_SIZE' };
  }
  let msg;
  try {
    msg = Message.fromBuffer(buffer);
  } catch (e) {
    return { accepted: false, duplicate: false, contractId: null, genesis: null, error: e.message || 'parse failed' };
  }
  if (msg.type !== OUTER.CONTRACT_PUBLISH && msg.type !== 'P2P_CONTRACT_PUBLISH') {
    return { accepted: false, duplicate: false, contractId: null, genesis: null, error: 'not a CONTRACT_PUBLISH' };
  }
  if (!verifyMessageSignature(msg)) {
    return { accepted: false, duplicate: false, contractId: null, genesis: null, error: 'invalid signature' };
  }
  let raw = msg.body != null ? msg.body : (msg.raw && msg.raw.data);
  if (Buffer.isBuffer(raw)) raw = raw.toString('utf8');
  let definition;
  try {
    definition = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (_) {
    return { accepted: false, duplicate: false, contractId: null, genesis: null, error: 'invalid publish body' };
  }
  if (!definition || typeof definition !== 'object') {
    return { accepted: false, duplicate: false, contractId: null, genesis: null, error: 'invalid publish body' };
  }
  const contractId = new Actor(definition).id;
  const genesis = normalizeGenesis(definition);
  const author = authorXOnlyHex(msg);
  if (!/^[0-9a-f]{64}$/.test(String(author || ''))) {
    return { accepted: false, duplicate: false, contractId, genesis: null, error: 'invalid publish author' };
  }
  if (genesis.signers.length && !genesis.signers.includes(author)) {
    return {
      accepted: false,
      duplicate: false,
      contractId,
      genesis: null,
      error: 'publish signer not in genesis authorities'
    };
  }
  const doc = loadDoc(store, contractId);
  if (doc.genesis && typeof doc.genesis === 'object') {
    return { accepted: false, duplicate: true, contractId, genesis: doc.genesis };
  }
  applyGenesisMeta(doc, { ...meta, genesis: definition });
  if (!doc.genesis) doc.genesis = genesis;
  persistDoc(store, doc);
  return { accepted: true, duplicate: false, contractId, genesis: doc.genesis };
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
  SIGNER_MUTATION_TYPES,
  DELIVERY_ACK_TYPES,
  DEFAULT_SYNC_EXCLUDE,
  isDeliveryAckType,
  resolveDeliverySyncPolicy,
  isSyncTrackedType,
  normalizeContractId,
  normalizeGenesis,
  normalizePubkeyList,
  authorAllowedByReaders,
  stateDigest,
  bufferFromPaste,
  verifyMessageSignature,
  parseContractMessageBody,
  loadDoc,
  persistDoc,
  applyGenesisMeta,
  currentSignerSet,
  readerSetForDelivery,
  messageTypeAllowed,
  authorHasSignToken,
  authorizeIngest,
  foldContractState,
  tipFromDoc,
  ensureDeliveryPending,
  applyDeliveryAckEntry,
  ingestMessageBuffer,
  ingestContractPublishBuffer,
  compactJournalEntries,
  clampJournalEntries,
  resolveMaxJournalEntries,
  ABSOLUTE_MAX_JOURNAL_ENTRIES,
  COMPACTABLE_TYPES,
  createMemoryStore,
  messageHashHex,
  authorXOnlyHex
};
