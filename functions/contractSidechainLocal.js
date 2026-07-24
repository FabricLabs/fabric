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

function storePathsForLocalContract (contractId, storeRoot) {
  const id = Statechain.normalizeContractId(contractId);
  const base = path.join(String(storeRoot || ''), 'sidechains', id);
  return {
    contractId: id,
    base,
    state: path.join(base, 'STATE.json')
  };
}

function loadState (storeRoot, contractId) {
  const paths = storePathsForLocalContract(contractId, storeRoot);
  try {
    if (!fs.existsSync(paths.state)) return Statechain.createInitialState();
    const parsed = JSON.parse(fs.readFileSync(paths.state, 'utf8'));
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
  fs.mkdirSync(paths.base, { recursive: true });
  const doc = {
    version: state.version != null ? Number(state.version) : 1,
    clock: Number(state.clock) || 0,
    content: state.content || {}
  };
  fs.writeFileSync(paths.state, JSON.stringify(doc, null, 2));
  return paths;
}

/**
 * Ensure a local contract Statechain document exists.
 * @returns {{ paths: object, state: object, head: object, created: boolean }}
 */
function ensureLocalContractChain (storeRoot, contractId, meta = {}) {
  const paths = storePathsForLocalContract(contractId, storeRoot);
  const created = !fs.existsSync(paths.state);
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
