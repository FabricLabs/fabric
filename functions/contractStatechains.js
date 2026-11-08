'use strict';

/**
 * Contract-namespace sidechain documents for accepted CONTRACT_PUBLISH ids.
 *
 * Each accepted application contract gets `sidechains/<contractId>/` using the
 * **same** sidechain document helpers as a Hub (or other) root document. The
 * parent seals the child head at `/namespaces/<contractId>`.
 *
 * Expects a Fabric Filesystem-like `fs` (`readFile` / `publish` / optional `writeFile`).
 *
 * @see functions/sidechainState.js
 * @see docs/DISTRIBUTED_EXECUTION.md
 * @see docs/APPLICATION_NAMESPACES.md
 */

const Statechain = require('./sidechainState');

/**
 * Ensure a contract Statechain exists and seal its head into the parent document.
 * @param {*} fs
 * @param {object} parentState `{ version, clock, content }`
 * @param {{ contractId: string, name?: string|null, parentContractId?: string|null }} entry
 * @param {object|null} [policy]
 */
async function provisionAcceptedContract (fs, parentState, entry, policy = null) {
  const contractId = entry && entry.contractId;
  if (!contractId) return { ok: false, error: 'contractId required' };

  let contractChain;
  try {
    contractChain = await Statechain.ensureContractStatechain(fs, contractId);
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }

  const head = Statechain.namespaceHeadFromState(contractId, contractChain.state, {
    name: entry.name || null,
    parentContractId: entry.parentContractId || null
  });

  const parentPatches = Statechain.patchesForNamespaceHead(
    parentState && parentState.content,
    contractId,
    head
  );
  if (!parentPatches.length) {
    return { ok: true, contractChain, head, parentPatches: [], parentState };
  }

  const applied = Statechain.applyPatchesToState(parentState, parentPatches, policy);
  if (!applied.ok) {
    return { ok: false, error: applied.error || 'parent seal patch failed', contractChain, head };
  }

  try {
    await Statechain.persistState(fs, applied.state);
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e), contractChain, head };
  }

  return {
    ok: true,
    contractChain,
    head,
    parentPatches,
    parentState: applied.state,
    newDigest: applied.newDigest
  };
}

/**
 * Refresh parent `/namespaces/<id>` seal from the contract Statechain’s current head.
 */
async function sealNamespaceHeadIntoParent (fs, parentState, contractId, meta = {}, policy = null) {
  const paths = Statechain.storePathsForContract(contractId);
  const contractState = Statechain.loadStateAt(fs, paths.state);
  const head = Statechain.namespaceHeadFromState(contractId, contractState, meta);
  const parentPatches = Statechain.patchesForNamespaceHead(
    parentState && parentState.content,
    contractId,
    head
  );
  if (!parentPatches.length) {
    return { ok: true, skipped: true, head, parentState };
  }
  const applied = Statechain.applyPatchesToState(parentState, parentPatches, policy);
  if (!applied.ok) {
    return { ok: false, error: applied.error || 'seal failed', head };
  }
  await Statechain.persistState(fs, applied.state);
  return { ok: true, head, parentPatches, parentState: applied.state, newDigest: applied.newDigest };
}

/**
 * Apply patches to a contract-namespace Statechain (same rules as root).
 */
async function applyPatchesToContractStatechain (fs, contractId, patches, policy = null) {
  const paths = Statechain.storePathsForContract(contractId);
  const state = Statechain.loadStateAt(fs, paths.state);
  const basisDigest = Statechain.stateDigest(state);
  const applied = Statechain.applyPatchesToState(state, patches, policy);
  if (!applied.ok) return applied;
  await Statechain.persistStateAt(fs, applied.state, paths.state);
  return {
    ok: true,
    state: applied.state,
    newDigest: applied.newDigest,
    basisDigest,
    paths,
    head: Statechain.namespaceHeadFromState(contractId, applied.state)
  };
}

module.exports = {
  provisionAcceptedContract,
  sealNamespaceHeadIntoParent,
  applyPatchesToContractStatechain
};
