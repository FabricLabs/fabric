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
  opcodeAllowed,
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

function assertPlainJson (value, depth, maxDepth) {
  if (depth > maxDepth) throw new Error('value exceeds max nesting depth');
  if (value === null) return;
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') {
    if (t === 'number' && !Number.isFinite(value)) throw new Error('non-finite number not allowed');
    return;
  }
  if (t === 'bigint' || t === 'function' || t === 'symbol' || t === 'undefined') {
    throw new Error('unsupported value type in Push');
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) assertPlainJson(value[i], depth + 1, maxDepth);
    return;
  }
  if (t === 'object') {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) throw new Error('non-plain object in Push');
    const keys = Object.keys(value);
    for (let i = 0; i < keys.length; i++) assertPlainJson(value[keys[i]], depth + 1, maxDepth);
  }
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
 * @param {object} program Hub `{ steps: [...] }`
 * @param {object} [options]
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
function runExecutionProgram (program, options = {}) {
  const steps = program && program.steps;
  if (!Array.isArray(steps)) {
    return { ok: false, error: 'program.steps must be an array', programHash: null, runCommitmentHex: null };
  }

  const maxSteps = Math.min(Math.max(1, Number(options.maxSteps) || DEFAULT_MAX_STEPS), 4096);
  const maxStack = Math.min(Math.max(1, Number(options.maxStack) || DEFAULT_MAX_STACK), 256);
  const maxDepth = Math.min(Math.max(1, Number(options.maxDepth) || DEFAULT_MAX_DEPTH), 64);
  const maxTrace = Math.min(Math.max(1, Number(options.maxTrace) || DEFAULT_MAX_TRACE), 8192);
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
  if (allowList.length && options.machine instanceof Machine) {
    // Prefer explicit opts / genesis list when an existing Machine is injected.
    const existing = machine.allowedOpcodes || [];
    if (!existing.length) {
      machine.setAllowedOpcodes(allowList);
    } else {
      allowList = existing;
    }
  } else if (!allowList.length && options.machine instanceof Machine) {
    allowList = machine.allowedOpcodes || [];
  }

  // Structured execution owns the stack; clear any prior compute residue.
  machine.stack = [];
  machine._program = prog;

  const stack = machine.stack;
  const trace = [];

  function pushTrace (entry) {
    if (trace.length >= maxTrace) {
      if (trace.length === maxTrace) trace.push({ truncated: true });
      return;
    }
    trace.push(entry);
  }

  const ops = Object.assign(Object.create(null), {
    FabricOpcode (step, pc) {
      const entry = resolveFabricEntry(step);
      if (NON_EXECUTION_FABRIC_TYPES.has(entry.name)) {
        throw new Error(`${entry.name} is a transport keepalive, not an Execution program opcode`);
      }
      if (!opcodeAllowed(allowList, entry.name)) {
        throw new Error(`FabricOpcode "${entry.name}" not in primitives.opcodes allow-list`);
      }
      const frame = {
        kind: 'fabric',
        name: entry.name,
        opcodeDec: entry.opcodeDec,
        stability: entry.stability,
        encoding: entry.encoding,
        notes: entry.notes
      };
      stack.push(frame);
      pushTrace({ pc, op: 'FabricOpcode', name: entry.name, opcodeDec: entry.opcodeDec });
    },
    Push (step, pc) {
      if (!Object.prototype.hasOwnProperty.call(step, 'value')) {
        throw new Error('Push requires value');
      }
      assertPlainJson(step.value, 0, maxDepth);
      stack.push(step.value);
      pushTrace({ pc, op: 'Push' });
    },
    Pop (_step, pc) {
      if (stack.length < 1) throw new Error('stack underflow');
      stack.pop();
      pushTrace({ pc, op: 'Pop' });
    },
    Dup (_step, pc) {
      if (stack.length < 1) throw new Error('stack underflow');
      stack.push(stack[stack.length - 1]);
      pushTrace({ pc, op: 'Dup' });
    },
    ADD (_step, pc) {
      if (stack.length < 2) throw new Error('stack underflow');
      const b = stack.pop();
      const a = stack.pop();
      if (typeof a !== 'number' || typeof b !== 'number' || !Number.isFinite(a) || !Number.isFinite(b)) {
        throw new Error('ADD requires two finite numbers');
      }
      stack.push(a + b);
      pushTrace({ pc, op: 'ADD' });
    },
    DelegationSignRequest (step, pc) {
      if (!step || typeof step.envelope !== 'object' || !step.envelope) {
        throw new Error('DelegationSignRequest requires envelope object');
      }
      assertPlainJson(step.envelope, 0, maxDepth);
      stack.push({ kind: 'DelegationSignRequest', envelope: step.envelope });
      pushTrace({ pc, op: 'DelegationSignRequest' });
    }
  });

  try {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (!step || typeof step !== 'object') {
        return {
          ok: false,
          error: `invalid step at index ${i}`,
          trace,
          stack: stack.slice(),
          programHash,
          runCommitmentHex: null,
          program: prog,
          machine
        };
      }
      const op = normalizeOpName(step.op);
      if (!op || !Object.prototype.hasOwnProperty.call(ops, op)) {
        return {
          ok: false,
          error: `unknown op "${step.op}" at index ${i}`,
          trace,
          stack: stack.slice(),
          programHash,
          runCommitmentHex: null,
          program: prog,
          machine
        };
      }
      ops[op](step, i);
      if (stack.length > maxStack) {
        return {
          ok: false,
          error: 'stack overflow',
          trace,
          stack: stack.slice(),
          programHash,
          runCommitmentHex: null,
          program: prog,
          machine
        };
      }
    }

    ++machine.clock;
    const tip = stack.length ? stack[stack.length - 1] : null;
    machine._state.content = tip != null ? tip : machine._state.content;
    if (typeof machine.commit === 'function') machine.commit();

    const runCommitmentHex = prog.runCommitmentHex({ tip, stack: trace });
    return {
      ok: true,
      stepsExecuted: steps.length,
      stack: stack.slice(),
      tip,
      trace,
      programHash,
      runCommitmentHex,
      program: prog,
      machine
    };
  } catch (err) {
    return {
      ok: false,
      error: err && err.message ? err.message : String(err),
      trace,
      stack: stack.slice(),
      tip: null,
      programHash,
      runCommitmentHex: null,
      program: prog,
      machine
    };
  }
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
  normalizeOpName
};
