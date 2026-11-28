'use strict';

/**
 * Full {@link Machine}/{@link Program} runner for Hub-style execution programs
 * (`language: 'fabric-execution'`): structured `{ op, ... }` steps with a real
 * stack (Push/Pop/Dup/ADD/FabricOpcode/DelegationSignRequest).
 *
 * @module functions/executionProgramRunner
 * @see docs/PROGRAM.md
 */

const { jsonSafe } = require('./fabricCanonicalJson');
const {
  opcodesFromGenesis,
  normalizeOpcodeAllowList
} = require('./opcodeAllowList');

const DEFAULT_MAX_STEPS = 256;
const DEFAULT_MAX_STACK = 64;
const DEFAULT_MAX_DEPTH = 16;
const DEFAULT_MAX_TRACE = 512;

/** Outer wire names that are transport keepalives — not allowed in FabricOpcode steps. */
const NON_EXECUTION_FABRIC_TYPES = new Set(['Ping', 'Pong']);

/**
 * Optional Hub registry resolver. Core stays free of Hub deps; Hub injects
 * `options.resolveFabricEntry` or we no-op metadata frames.
 * @type {null|function}
 */
let _resolveFabricEntry = null;

/**
 * @param {function} fn `(step) => { name, opcodeDec, stability?, encoding?, notes? }`
 */
function setFabricEntryResolver (fn) {
  _resolveFabricEntry = typeof fn === 'function' ? fn : null;
}

function normalizeOpName (op) {
  const raw = String(op || '').trim();
  if (!raw) return '';
  const lower = raw.toLowerCase();
  const map = {
    push: 'Push',
    pop: 'Pop',
    dup: 'Dup',
    add: 'ADD',
    fabricopcode: 'FabricOpcode',
    delegationsignrequest: 'DelegationSignRequest'
  };
  return map[lower] || raw;
}

function defaultResolveFabricEntry (step) {
  if (_resolveFabricEntry) return _resolveFabricEntry(step);
  const hasName = step.fabricType != null && String(step.fabricType).trim() !== '';
  const name = hasName ? String(step.fabricType).trim() : 'Unknown';
  if (NON_EXECUTION_FABRIC_TYPES.has(name)) {
    throw new Error(`${name} is a transport keepalive, not an Execution program opcode`);
  }
  const opcodeDec = step.fabricOpcode != null ? Number(step.fabricOpcode) : null;
  return {
    name,
    opcodeDec: Number.isFinite(opcodeDec) ? opcodeDec : null,
    stability: null,
    encoding: null,
    notes: null
  };
}

/**
 * Content-address a Hub execution program via {@link Program}.
 * @param {object} program `{ version?, steps: [...] }`
 * @returns {{ program: object, programHash: string }}
 */
function executionProgramFromHub (program) {
  const Program = require('../types/program');
  const safe = jsonSafe(program && typeof program === 'object' ? program : {});
  const prog = Program.from({
    language: 'fabric-execution',
    source: safe
  });
  const compiled = prog.compile();
  if (!compiled.ok) {
    throw new Error(compiled.error || 'fabric-execution compile failed');
  }
  return { program: prog, programHash: prog.programHash };
}

/**
 * Run structured execution steps on a {@link Machine} stack.
 *
 * Allow-list precedence when `options.machine` is injected:
 * 1. non-empty `options.allowedOpcodes` / genesis opcodes (applied via
 *    `setAllowedOpcodes`)
 * 2. otherwise the Machine's existing `allowedOpcodes`
 *
 * @param {object} program Hub `{ steps: [...] }`
 * @param {object} [options]
 * @param {string[]} [options.allowedOpcodes]
 * @param {object} [options.genesis]
 * @param {import('../types/machine')} [options.machine]
 * @returns {{
 *   ok: boolean,
 *   stepsExecuted?: number,
 *   stack?: any[],
 *   trace?: any[],
 *   error?: string,
 *   programHash?: string|null,
 *   runCommitmentHex?: string|null,
 *   program?: object|null,
 *   machine?: object|null
 * }}
 */
function isolateForced (options) {
  if (options && options.inProcess === true) return true;
  return typeof process !== 'undefined' && process != null && process.env &&
    process.env.FABRIC_PROGRAM_ISOLATE === '1';
}

function clampLimit (value, fallback, max) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  // A positive fraction floors to 0. The isolate treats that as one step.
  const whole = Math.max(1, Math.floor(n));
  if (whole > max) return max;
  return whole;
}

function runExecutionProgram (program, options = {}) {
  if (isolateForced(options)) {
    return runExecutionProgramInProcess(program, options);
  }
  const wrapped = Object.assign({}, options);
  if (typeof wrapped.resolveFabricEntry !== 'function') {
    wrapped.resolveFabricEntry = defaultResolveFabricEntry;
  }
  const Machine = require('../types/machine');
  if (!Machine.nodeIsolate()) return Machine.runIsolatedAsync(program, wrapped);
  return Machine.runIsolated(program, wrapped);
}

function runExecutionProgramInProcess (program, options = {}) {
  const steps = program && program.steps;
  if (!Array.isArray(steps)) {
    return { ok: false, error: 'program.steps must be an array', programHash: null, runCommitmentHex: null };
  }

  const maxSteps = clampLimit(options.maxSteps, DEFAULT_MAX_STEPS, 4096);
  const maxStack = clampLimit(options.maxStack, DEFAULT_MAX_STACK, 256);
  const maxDepth = clampLimit(options.maxDepth, DEFAULT_MAX_DEPTH, 64);
  const maxTrace = clampLimit(options.maxTrace, DEFAULT_MAX_TRACE, 8192);
  const resolveFabricEntry = typeof options.resolveFabricEntry === 'function'
    ? options.resolveFabricEntry
    : defaultResolveFabricEntry;

  if (steps.length > maxSteps) {
    return {
      ok: false,
      error: `program exceeds maxSteps (${maxSteps})`,
      programHash: null,
      runCommitmentHex: null
    };
  }

  let prog = null;
  let programHash = null;
  try {
    const built = executionProgramFromHub(program);
    prog = built.program;
    programHash = built.programHash;
  } catch (e) {
    return {
      ok: false,
      error: e && e.message ? e.message : String(e),
      programHash: null,
      runCommitmentHex: null
    };
  }

  const Machine = require('../types/machine');
  let allowList = normalizeOpcodeAllowList(options.allowedOpcodes || []);
  if (!allowList.length && options.genesis) {
    allowList = opcodesFromGenesis(options.genesis);
  }
  const machine = options.machine instanceof Machine
    ? options.machine
    : new Machine({
      deterministic: true,
      allowedOpcodes: allowList.length ? allowList : null
    });
  if (options.machine instanceof Machine) {
    if (allowList.length) {
      // Prefer explicit opts / genesis list over any preloaded Machine allow-list.
      machine.setAllowedOpcodes(allowList);
    } else {
      allowList = machine.allowedOpcodes || [];
    }
  }

  // Structured execution owns the stack. The thread interpreter is the same
  // loop a Worker runs, so an in-process call cannot drift from the isolate.
  machine.stack = [];
  machine._program = prog;
  const threadOptions = {
    maxSteps,
    maxStack,
    maxDepth,
    maxTrace,
    allowedOpcodes: allowList,
    useResolvedEntries: options.useResolvedEntries === true
  };
  if (Object.prototype.hasOwnProperty.call(options, 'seedValue')) {
    threadOptions.seedValue = options.seedValue;
  }
  const result = require('../types/machine').runPayload({
    kind: 'fabric-execution',
    steps,
    options: threadOptions
  }, { resolveFabricEntry });
  const trace = Array.isArray(result.trace) ? result.trace : [];
  const stack = Array.isArray(result.stack) ? result.stack.slice() : [];
  machine.stack = stack;
  if (result.ok === true) {
    ++machine.clock;
    const tip = result.tip != null ? result.tip : (stack.length ? stack[stack.length - 1] : null);
    machine._state.content = tip != null ? tip : machine._state.content;
    if (typeof machine.commit === 'function') machine.commit();
    return {
      ok: true,
      stepsExecuted: result.stepsExecuted,
      stack,
      tip,
      trace,
      programHash,
      runCommitmentHex: prog.runCommitmentHex({ tip, stack: trace }),
      program: prog,
      machine
    };
  }
  return {
    ok: false,
    error: result.error,
    trace,
    stack,
    tip: null,
    programHash,
    runCommitmentHex: null,
    program: prog,
    machine
  };
}

module.exports = {
  DEFAULT_MAX_STEPS,
  DEFAULT_MAX_STACK,
  DEFAULT_MAX_DEPTH,
  DEFAULT_MAX_TRACE,
  NON_EXECUTION_FABRIC_TYPES,
  setFabricEntryResolver,
  executionProgramFromHub,
  runExecutionProgram,
  runExecutionProgramInProcess,
  normalizeOpName
};
