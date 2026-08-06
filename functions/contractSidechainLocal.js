'use strict';

/**
 * Node `fs` persistence for contract-namespace sidechain documents (desktop / relay apps).
 *
 * Digests, parent-seal paths, and RFC6902 namespace patches come from
 * {@link module:functions/sidechainState}. This module only maps them onto a local
 * directory tree (`<storeRoot>/sidechains/<contractId>/STATE.json`).
 *
 * Hub and other Fabric Filesystem hosts should use
 * {@link module:functions/contractStatechains} instead.
 *
 * @see docs/DISTRIBUTED_EXECUTION.md
 */

const fs = require('fs');
const path = require('path');
const Statechain = require('./sidechainState');

const STATE_FILE = 'STATE.json';
const SIDECHAINS_DIR = 'sidechains';

/**
 * Resolve storeRoot + sanitized contractId under a containment check.
 * @param {string} contractId
 * @param {string} storeRoot
 * @returns {{ contractId: string, base: string, state: string }}
 */
function storePathsForLocalContract (contractId, storeRoot) {
  const id = Statechain.normalizeContractId(contractId);
  if (storeRoot == null || typeof storeRoot !== 'string') {
    throw new Error('invalid storeRoot for contract Statechain');
  }
  const trimmedRoot = storeRoot.trim();
  if (!trimmedRoot || trimmedRoot.includes('\0') || trimmedRoot.length > 4096) {
    throw new Error('invalid storeRoot for contract Statechain');
  }
  const root = path.resolve(trimmedRoot);
  // Fixed literals after normalizeContractId; reject escapes via path.relative.
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  const base = path.resolve(root, SIDECHAINS_DIR, id);
  const relBase = path.relative(root, base);
  if (
    !relBase ||
    relBase === '..' ||
    relBase.startsWith('..' + path.sep) ||
    path.isAbsolute(relBase)
  ) {
    throw new Error('contract Statechain path escapes storeRoot');
  }
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  const state = path.resolve(base, STATE_FILE);
  if (path.relative(base, state) !== STATE_FILE) {
    throw new Error('invalid contract Statechain state path');
  }
  return {
    contractId: id,
    base,
    state
  };
}

/**
 * Read UTF-8 from a previously containment-checked absolute path.
 * @param {string} absolutePath
 * @returns {string}
 */
function readCheckedUtf8 (absolutePath) {
  const p = path.normalize(String(absolutePath || ''));
  if (!p || p.includes('\0') || !path.isAbsolute(p)) {
    throw new Error('invalid absolute path for contract Statechain read');
  }
  // Path already validated by storePathsForLocalContract.
  // nosemgrep: javascript.lang.security.audit.path-traversal.tainted-path
  return fs.readFileSync(p, 'utf8');
}

/**
 * Write UTF-8 to a previously containment-checked absolute path.
 * @param {string} absolutePath
 * @param {string} body
 */
function writeCheckedUtf8 (absolutePath, body) {
  const p = path.normalize(String(absolutePath || ''));
  if (!p || p.includes('\0') || !path.isAbsolute(p)) {
    throw new Error('invalid absolute path for contract Statechain write');
  }
  // Path already validated by storePathsForLocalContract.
  // nosemgrep: javascript.lang.security.audit.path-traversal.tainted-path
  fs.writeFileSync(p, body);
}

function pathExistsChecked (absolutePath) {
  const p = path.normalize(String(absolutePath || ''));
  if (!p || p.includes('\0') || !path.isAbsolute(p)) return false;
  // nosemgrep: javascript.lang.security.audit.path-traversal.tainted-path
  return fs.existsSync(p);
}

function mkdirChecked (absolutePath) {
  const p = path.normalize(String(absolutePath || ''));
  if (!p || p.includes('\0') || !path.isAbsolute(p)) {
    throw new Error('invalid absolute path for contract Statechain mkdir');
  }
  // nosemgrep: javascript.lang.security.audit.path-traversal.tainted-path
  fs.mkdirSync(p, { recursive: true });
}

function loadState (storeRoot, contractId) {
  const paths = storePathsForLocalContract(contractId, storeRoot);
  try {
    if (!pathExistsChecked(paths.state)) return Statechain.createInitialState();
    const parsed = JSON.parse(readCheckedUtf8(paths.state));
    if (!parsed || typeof parsed !== 'object') return Statechain.createInitialState();
    return {
      version: Number(parsed.version) || 1,
      clock: Number(parsed.clock) || 0,
      content: parsed.content && typeof parsed.content === 'object' ? parsed.content : {}
    };
  } catch (_) {
    return Statechain.createInitialState();
  }
}

function persistState (storeRoot, contractId, state) {
  const paths = storePathsForLocalContract(contractId, storeRoot);
  mkdirChecked(paths.base);
  const doc = {
    version: state.version != null ? Number(state.version) : 1,
    clock: Number(state.clock) || 0,
    content: state.content || {}
  };
  writeCheckedUtf8(paths.state, JSON.stringify(doc, null, 2));
  return paths;
}

/**
 * Ensure a local contract Statechain document exists.
 * @returns {{ paths: object, state: object, head: object, created: boolean }}
 */
function ensureLocalContractChain (storeRoot, contractId, meta = {}) {
  const paths = storePathsForLocalContract(contractId, storeRoot);
  const created = !pathExistsChecked(paths.state);
  const state = loadState(storeRoot, contractId);
  if (created) persistState(storeRoot, contractId, state);
  const head = Statechain.namespaceHeadFromState(contractId, state, meta);
  return { paths, state, head, created };
}

/**
 * Replace contract Statechain content and bump clock.
 */
function publishContent (storeRoot, contractId, content, meta = {}) {
  const prev = loadState(storeRoot, contractId);
  const next = {
    version: 1,
    clock: (Number(prev.clock) || 0) + 1,
    content: content && typeof content === 'object' ? content : {}
  };
  const paths = persistState(storeRoot, contractId, next);
  return {
    paths,
    state: next,
    head: Statechain.namespaceHeadFromState(contractId, next, meta)
  };
}

module.exports = {
  storePathsForLocalContract,
  /** Alias used by some desktop/relay call sites. */
  storePathsForContract: storePathsForLocalContract,
  loadState,
  persistState,
  ensureLocalContractChain,
  publishContent,
  // Re-export common Statechain namespace helpers so apps need one import.
  normalizeContractId: Statechain.normalizeContractId,
  parentSealPath: Statechain.parentSealPath,
  createInitialState: Statechain.createInitialState,
  stateDigest: Statechain.stateDigest,
  namespaceHeadFromState: Statechain.namespaceHeadFromState,
  patchesForNamespaceHead: Statechain.patchesForNamespaceHead,
  fromCore: true
};
