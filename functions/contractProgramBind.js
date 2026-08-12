'use strict';

/**
 * Bind {@link Machine}/{@link Program} run commitments into ARC tip / withdrawal
 * policy without changing the authority P2TR address.
 *
 * Machine provides deterministic `programHash` + `runCommitmentHex`
 * (`FabricProgramRun`). ARC Taproot (`resolveSpend`) remains the k-of-n
 * redeemable surface; co-signers refuse withdrawals whose program digests
 * do not match the tip-sealed run.
 *
 * @module functions/contractProgramBind
 * @see docs/PROGRAM.md
 * @see docs/ARC.md
 */

const crypto = require('crypto');

const FABRIC_PROGRAM_RUN_KIND = 'FabricProgramRun';

/**
 * @param {object} [tip]
 * @returns {{ programHash: string|null, runCommitmentHex: string|null, programId: string|null, clock: number|null }|null}
 */
function programMetaFromTip (tip = {}) {
  const content = tip && tip.content && typeof tip.content === 'object' ? tip.content : {};
  const bag = content.program
    || (content.meta && content.meta.program)
    || tip.program
    || null;
  if (!bag || typeof bag !== 'object') return null;
  const programHash = bag.programHash ? String(bag.programHash).trim().toLowerCase() : null;
  const runCommitmentHex = bag.runCommitmentHex
    ? String(bag.runCommitmentHex).trim().toLowerCase()
    : (bag.runCommitment ? String(bag.runCommitment).trim().toLowerCase() : null);
  if (!programHash && !runCommitmentHex) return null;
  return {
    programHash: programHash && /^[0-9a-f]{64}$/.test(programHash) ? programHash : null,
    runCommitmentHex: runCommitmentHex && /^[0-9a-f]{64}$/.test(runCommitmentHex)
      ? runCommitmentHex
      : null,
    programId: bag.programId != null ? String(bag.programId) : null,
    clock: bag.clock != null ? Number(bag.clock) : (tip.clock != null ? Number(tip.clock) : null)
  };
}

/**
 * True when genesis declares a Program / opcode surface that withdrawals must bind.
 * @param {object} [genesis] raw or normalizeArcGenesis output
 * @returns {boolean}
 */
function requiresProgramBind (genesis = {}) {
  const g = genesis && typeof genesis === 'object' ? genesis : {};
  const spend = g.spendPolicy && typeof g.spendPolicy === 'object' ? g.spendPolicy : {};
  if (spend.requireProgramRun === true || g.requireProgramRun === true) return true;
  const interfaces = Array.isArray(g.interfaces) ? g.interfaces.map(String) : [];
  if (interfaces.some((i) => /^(arc\.)?program$|^fabric\.program$/i.test(i))) return true;
  const opcodes = (g.primitives && Array.isArray(g.primitives.opcodes))
    ? g.primitives.opcodes
    : (Array.isArray(g.opcodes) ? g.opcodes : []);
  return opcodes.length > 0;
}

/**
 * Fold a Machine/Program run onto tip content (does not mutate P2TR keys).
 * Returns a shallow-cloned tip; caller persists / digests as needed.
 *
 * @param {object} tip ARC tip
 * @param {{ programHash: string, runCommitmentHex: string, programId?: string, clock?: number }} run
 * @returns {object} tip with `content.program`
 */
function bindProgramRunToTip (tip = {}, run = {}) {
  const programHash = String(run.programHash || '').trim().toLowerCase();
  const runCommitmentHex = String(run.runCommitmentHex || run.runCommitment || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(programHash)) {
    throw new Error('bindProgramRunToTip: programHash required (64-hex)');
  }
  if (!/^[0-9a-f]{64}$/.test(runCommitmentHex)) {
    throw new Error('bindProgramRunToTip: runCommitmentHex required (64-hex)');
  }
  const prev = tip && typeof tip === 'object' ? tip : {};
  const content = Object.assign({}, prev.content && typeof prev.content === 'object' ? prev.content : {});
  const program = {
    kind: FABRIC_PROGRAM_RUN_KIND,
    programHash,
    runCommitmentHex,
    programId: run.programId != null ? String(run.programId) : null,
    clock: run.clock != null ? Number(run.clock) : (prev.clock != null ? Number(prev.clock) : null),
    boundAt: run.boundAt || new Date().toISOString()
  };
  content.program = program;
  return Object.assign({}, prev, { content });
}

/**
 * Validate withdrawal (or any object) program digests against tip / genesis policy.
 * @param {object} opts
 * @param {object} [opts.object] withdrawal body
 * @param {object} [opts.tip]
 * @param {object} [opts.genesis]
 * @returns {{ ok: true }|{ ok: false, error: string }}
 */
function validateProgramRunBinding (opts = {}) {
  const object = opts.object && typeof opts.object === 'object' ? opts.object : {};
  const tip = opts.tip && typeof opts.tip === 'object' ? opts.tip : {};
  const genesis = opts.genesis && typeof opts.genesis === 'object' ? opts.genesis : {};
  const tipProgram = programMetaFromTip(tip);
  const required = requiresProgramBind(genesis);

  const reqHash = object.programHash
    ? String(object.programHash).trim().toLowerCase()
    : null;
  const reqRun = object.runCommitmentHex
    ? String(object.runCommitmentHex).trim().toLowerCase()
    : (object.runCommitment ? String(object.runCommitment).trim().toLowerCase() : null);

  if (required) {
    if (!tipProgram || !tipProgram.programHash || !tipProgram.runCommitmentHex) {
      return {
        ok: false,
        error: 'tip.content.program (programHash + runCommitmentHex) required for program-bound contract'
      };
    }
    if (!reqHash || !reqRun) {
      return {
        ok: false,
        error: 'withdrawal programHash + runCommitmentHex required when tip seals a Program run'
      };
    }
  }

  // If either side carries program digests, they must agree.
  if (reqHash || reqRun || tipProgram) {
    if (!tipProgram || !tipProgram.programHash || !tipProgram.runCommitmentHex) {
      if (reqHash || reqRun) {
        return { ok: false, error: 'withdrawal carries program digests but tip has no sealed Program run' };
      }
      return { ok: true };
    }
    if (!reqHash || !reqRun) {
      if (required || tipProgram.programHash) {
        return {
          ok: false,
          error: 'withdrawal must include programHash + runCommitmentHex matching tip.content.program'
        };
      }
      return { ok: true };
    }
    if (!/^[0-9a-f]{64}$/.test(reqHash) || !/^[0-9a-f]{64}$/.test(reqRun)) {
      return { ok: false, error: 'programHash and runCommitmentHex must be 64-hex' };
    }
    if (reqHash !== tipProgram.programHash) {
      return { ok: false, error: 'programHash does not match tip.content.program' };
    }
    if (reqRun !== tipProgram.runCommitmentHex) {
      return { ok: false, error: 'runCommitmentHex does not match tip.content.program (stale or forged run)' };
    }
  }

  return { ok: true };
}

/**
 * Assert a Machine.runProgram result matches Program.runCommitmentHex.
 * @param {object} opts
 * @param {object} opts.program Program instance (needs programHash + runCommitmentHex)
 * @param {{ tip?: *, stack?: Array, runCommitmentHex?: string|null }} opts.run
 * @returns {{ ok: true, programHash: string, runCommitmentHex: string }|{ ok: false, error: string }}
 */
function assertMachineRunMatches (opts = {}) {
  const program = opts.program;
  const run = opts.run && typeof opts.run === 'object' ? opts.run : {};
  if (!program || typeof program.runCommitmentHex !== 'function') {
    return { ok: false, error: 'program with runCommitmentHex required' };
  }
  const programHash = String(program.programHash || program.hash && program.hash() || '')
    .trim()
    .toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(programHash)) {
    return { ok: false, error: 'program.programHash unavailable' };
  }
  const expected = String(program.runCommitmentHex({
    tip: run.tip,
    // Machine commits to the trace delta, not the full stack.
    stack: run.trace || run.stack || []
  })).toLowerCase();
  const got = run.runCommitmentHex != null
    ? String(run.runCommitmentHex).trim().toLowerCase()
    : null;
  if (got && got !== expected) {
    return {
      ok: false,
      error: 'Machine runCommitmentHex does not match Program.runCommitmentHex({ tip, stack })'
    };
  }
  return {
    ok: true,
    programHash,
    runCommitmentHex: expected,
    kind: FABRIC_PROGRAM_RUN_KIND
  };
}

/**
 * Stable id helper for tests / logging (not a wire type).
 * @param {string} programHash
 * @param {string} runCommitmentHex
 * @returns {string}
 */
function programRunId (programHash, runCommitmentHex) {
  return crypto.createHash('sha256')
    .update(String(programHash || '').toLowerCase() + ':' + String(runCommitmentHex || '').toLowerCase())
    .digest('hex');
}

module.exports = {
  FABRIC_PROGRAM_RUN_KIND,
  programMetaFromTip,
  requiresProgramBind,
  bindProgramRunToTip,
  validateProgramRunBinding,
  assertMachineRunMatches,
  programRunId
};
