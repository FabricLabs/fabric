'use strict';

/**
 * Bridge Hub ExecutionRun digests toward {@link FabricProgramRun}.
 *
 * Prefer {@link Program#runCommitmentHex} when a Program instance is supplied
 * (full Machine runner). Legacy `ExecutionRun` commitments remain as
 * `executionRunCommitmentHex`.
 *
 * @module functions/executionRunBridge
 * @see docs/PROGRAM.md
 */

const crypto = require('crypto');
const { fabricCanonicalJson, jsonSafe } = require('./fabricCanonicalJson');

const EXECUTION_RUN_KIND = 'ExecutionRun';
const FABRIC_PROGRAM_RUN_KIND = 'FabricProgramRun';

/**
 * @param {object} [result]
 * @returns {{ ok: boolean, stepsExecuted: number|null, error: string|null, trace: any[], stack: any[] }}
 */
function normalizeExecutionResult (result) {
  const r = result && typeof result === 'object' ? result : {};
  return {
    ok: !!r.ok,
    stepsExecuted: r.stepsExecuted != null ? Number(r.stepsExecuted) : null,
    error: r.ok ? null : (r.error != null ? String(r.error) : null),
    trace: Array.isArray(r.trace) ? r.trace : [],
    stack: Array.isArray(r.stack) ? r.stack : []
  };
}

/**
 * Legacy Hub digest: SHA-256 over canonical ExecutionRun body (contractId-scoped).
 * @param {string} contractId
 * @param {object} result
 * @returns {string} 64-char lowercase hex
 */
function computeExecutionRunCommitmentHex (contractId, result) {
  const id = String(contractId || '').trim();
  if (!id) throw new Error('contractId required');
  const r = normalizeExecutionResult(result);
  const body = {
    version: 1,
    kind: EXECUTION_RUN_KIND,
    contractId: id,
    ok: r.ok,
    stepsExecuted: r.stepsExecuted,
    error: r.error,
    trace: r.trace,
    stack: r.stack
  };
  return crypto.createHash('sha256')
    .update(Buffer.from(fabricCanonicalJson(body), 'utf8'))
    .digest('hex');
}

/**
 * Nested ExecutionRun under FabricProgramRun (compat when no Program instance).
 * @param {object} opts
 * @returns {string}
 */
function computeFabricProgramRunFromExecution (opts = {}) {
  const programHash = String(opts.programHash || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(programHash)) {
    throw new Error('programHash required (64-hex)');
  }
  const contractId = String(opts.contractId || '').trim();
  if (!contractId) throw new Error('contractId required');
  const r = normalizeExecutionResult(opts.result);
  const body = {
    version: 1,
    kind: FABRIC_PROGRAM_RUN_KIND,
    programHash,
    result: jsonSafe({
      kind: EXECUTION_RUN_KIND,
      contractId,
      ok: r.ok,
      stepsExecuted: r.stepsExecuted,
      error: r.error,
      trace: r.trace,
      stack: r.stack
    })
  };
  return crypto.createHash('sha256')
    .update(Buffer.from(fabricCanonicalJson(body), 'utf8'))
    .digest('hex');
}

/**
 * Build forward-compatible RunExecutionContract digest fields.
 *
 * @param {object} opts
 * @param {string} opts.contractId
 * @param {string} [opts.programHash]
 * @param {object} opts.result
 * @param {object} [opts.program] Program instance with runCommitmentHex()
 * @returns {object}
 */
function buildExecutionRunOutput (opts = {}) {
  const contractId = String(opts.contractId || '').trim();
  if (!contractId) throw new Error('contractId required');
  const r = normalizeExecutionResult(opts.result);
  const executionRunCommitmentHex = computeExecutionRunCommitmentHex(contractId, r);

  let programHashRaw = opts.programHash != null
    ? String(opts.programHash).trim().toLowerCase()
    : '';
  if (!programHashRaw && opts.program && opts.program.programHash) {
    programHashRaw = String(opts.program.programHash).trim().toLowerCase();
  }
  const programHash = /^[0-9a-f]{64}$/.test(programHashRaw) ? programHashRaw : null;

  let fabricProgramRunCommitmentHex = null;
  let fabricProgramRun = null;
  if (programHash) {
    if (opts.program && typeof opts.program.runCommitmentHex === 'function' && r.ok) {
      const tip = opts.result && opts.result.tip != null
        ? opts.result.tip
        : (r.stack.length ? r.stack[r.stack.length - 1] : null);
      fabricProgramRunCommitmentHex = String(opts.program.runCommitmentHex({
        tip,
        stack: r.trace.length ? r.trace : r.stack
      })).toLowerCase();
    } else if (opts.result && opts.result.runCommitmentHex &&
        /^[0-9a-f]{64}$/i.test(String(opts.result.runCommitmentHex))) {
      fabricProgramRunCommitmentHex = String(opts.result.runCommitmentHex).trim().toLowerCase();
    } else {
      fabricProgramRunCommitmentHex = computeFabricProgramRunFromExecution({
        programHash,
        contractId,
        result: r
      });
    }
    fabricProgramRun = {
      kind: FABRIC_PROGRAM_RUN_KIND,
      programHash,
      runCommitmentHex: fabricProgramRunCommitmentHex
    };
  }

  return {
    programHash,
    runCommitmentHex: fabricProgramRunCommitmentHex || executionRunCommitmentHex,
    executionRunCommitmentHex,
    fabricProgramRunCommitmentHex,
    fabricProgramRun
  };
}

module.exports = {
  EXECUTION_RUN_KIND,
  FABRIC_PROGRAM_RUN_KIND,
  normalizeExecutionResult,
  computeExecutionRunCommitmentHex,
  computeFabricProgramRunFromExecution,
  buildExecutionRunOutput
};
