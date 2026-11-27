'use strict';

/**
 * @fileoverview Multi-language Program — executable artifact for {@link Machine}, with optional
 * L1 Bitcoin redeem scaffolding for `bitcoin-script`.
 *
 * Languages: `fabric-opcodes` | `javascript` | `bitcoin-script` are RC-supported.
 * `solidity` | `asm` remain listed for forward compatibility but `compile()` returns
 * `{ ok: false }` until Compiler frontends land — do not claim they execute.
 *
 * @see docs/PROGRAM.md
 */

const crypto = require('crypto');
const { spawnSync } = require('child_process');
const path = require('path');
const Circuit = require('./circuit');
const Script = require('./script');
const Hash256 = require('./hash256');
const fabricCanonicalJson = require('../functions/fabricCanonicalJson');
const { FABRIC_PROGRAM_RUN_KIND } = require('../functions/executionRunBridge');
const { jsonSafe } = fabricCanonicalJson;

const LANGUAGES = Object.freeze([
  'fabric-opcodes',
  'javascript',
  'bitcoin-script',
  'solidity',
  'asm',
  'fabric-execution'
]);

class Program extends Circuit {
  /**
   * @param {object} [settings]
   * @param {string} [settings.language]
   * @param {string|object} [settings.source]
   * @param {*} [settings.bytecode]
   * @param {string[]} [settings.steps]
   * @param {string} [settings.programId]
   */
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      language: 'fabric-opcodes',
      source: null,
      bytecode: null,
      steps: [],
      instructions: [],
      programId: null
    }, settings);

    this.circuit = new Circuit();
    this.script = new Script();
    this.state = {};

    if (Array.isArray(this.settings.instructions) && this.settings.instructions.length &&
        !(this.settings.steps && this.settings.steps.length)) {
      this.settings.steps = this.settings.instructions.slice();
    }

    return this;
  }

  /**
   * @param {Object} [opts]
   * @param {string} [opts.language]
   * @param {*} [opts.source]
   * @param {*} [opts.bytecode]
   * @param {Array.<string>} [opts.steps]
   * @param {string} [opts.programId]
   * @returns {Program}
   */
  static from (opts = {}) {
    return new Program(opts);
  }

  /**
   * Program run sealed on a contract tip (`content.program`, `content.meta.program`, or `tip.program`).
   * @param {object} [tip]
   * @returns {({programHash: (string|null), runCommitmentHex: (string|null), programId: (string|null), clock: (number|null)}|null)}
   */
  static runFromTip (tip = {}) {
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
   * True when a contract genesis declares a Program / opcode surface that withdrawals must bind.
   * @param {object} [genesis] raw or {@link Contract.normalizeGenesis} output
   * @returns {boolean}
   */
  static requiresBinding (genesis = {}) {
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
   * Fold a Machine/Program run onto tip content without touching P2TR keys.
   * Returns a shallow-cloned tip; the caller persists / digests it.
   * @param {object} tip contract tip
   * @param {Object} run
   * @param {string} run.programHash
   * @param {string} run.runCommitmentHex
   * @param {string} [run.programId]
   * @param {number} [run.clock]
   * @returns {object} tip with `content.program`
   */
  static bindRun (tip = {}, run = {}) {
    const programHash = String(run.programHash || '').trim().toLowerCase();
    const runCommitmentHex = String(run.runCommitmentHex || run.runCommitment || '').trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(programHash)) {
      throw new Error('Program.bindRun: programHash required (64-hex)');
    }
    if (!/^[0-9a-f]{64}$/.test(runCommitmentHex)) {
      throw new Error('Program.bindRun: runCommitmentHex required (64-hex)');
    }
    const prev = tip && typeof tip === 'object' ? tip : {};
    const content = Object.assign({}, prev.content && typeof prev.content === 'object' ? prev.content : {});
    content.program = {
      kind: FABRIC_PROGRAM_RUN_KIND,
      programHash,
      runCommitmentHex,
      programId: run.programId != null ? String(run.programId) : null,
      clock: run.clock != null ? Number(run.clock) : (prev.clock != null ? Number(prev.clock) : null),
      boundAt: run.boundAt || new Date().toISOString()
    };
    return Object.assign({}, prev, { content });
  }

  /**
   * Check a withdrawal's (or any object's) program digests against tip / genesis policy.
   * @param {Object} opts
   * @param {Object} [opts.object] withdrawal body
   * @param {Object} [opts.tip]
   * @param {Object} [opts.genesis]
   * @returns {{ok: boolean, error: (string|undefined)}}
   */
  static validateBinding (opts = {}) {
    const object = opts.object && typeof opts.object === 'object' ? opts.object : {};
    const tip = opts.tip && typeof opts.tip === 'object' ? opts.tip : {};
    const genesis = opts.genesis && typeof opts.genesis === 'object' ? opts.genesis : {};
    const tipProgram = Program.runFromTip(tip);
    const required = Program.requiresBinding(genesis);

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
   * Check a `Machine.runProgram` result against `program.runCommitmentHex`.
   * @param {Object} opts
   * @param {Program} opts.program needs `programHash` + `runCommitmentHex`
   * @param {Object} opts.run `{ tip, trace, runCommitmentHex }` (`stack` in place of `trace` also works)
   * @returns {{ok: boolean, error: (string|undefined), programHash: (string|undefined), runCommitmentHex: (string|undefined), kind: (string|undefined)}}
   */
  static verifyMachineRun (opts = {}) {
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
   * Stable id for a program run (tests / logging; not a wire type).
   * @param {string} programHash
   * @param {string} runCommitmentHex
   * @returns {string}
   */
  static runId (programHash, runCommitmentHex) {
    return crypto.createHash('sha256')
      .update(String(programHash || '').toLowerCase() + ':' + String(runCommitmentHex || '').toLowerCase())
      .digest('hex');
  }

  get language () {
    return String(this.settings.language || 'fabric-opcodes');
  }

  get source () {
    return this.settings.source;
  }

  get bytecode () {
    return this.settings.bytecode;
  }

  get steps () {
    return Array.isArray(this.settings.steps) ? this.settings.steps : [];
  }

  get programId () {
    if (this.settings.programId) return String(this.settings.programId);
    return this.programHash.slice(0, 32);
  }

  get programHash () {
    return this.hash();
  }

  /**
   * Content-address of language + source/bytecode/steps.
   * @returns {string} 64-char hex
   */
  hash () {
    const body = fabricCanonicalJson({
      language: this.language,
      source: this.settings.source != null ? jsonSafe(this.settings.source) : null,
      bytecode: this.settings.bytecode != null ? jsonSafe(this.settings.bytecode) : null,
      steps: this.steps
    });
    return Hash256.compute(Buffer.from(body, 'utf8'));
  }

  toJSON () {
    return {
      language: this.language,
      source: this.settings.source,
      bytecode: this.settings.bytecode,
      steps: this.steps.slice(),
      programId: this.programId,
      programHash: this.programHash
    };
  }

  /**
   * Normalize language-specific form into `steps` / `bytecode`.
   * @returns {{ok: boolean, error: (string|undefined), program: (Program|undefined)}}
   */
  compile () {
    const lang = this.language;
    if (!LANGUAGES.includes(lang)) {
      return { ok: false, error: `unsupported language: ${lang}` };
    }

    if (lang === 'fabric-opcodes') {
      let steps = this.steps.slice();
      if (!steps.length && typeof this.settings.source === 'string') {
        steps = this.settings.source.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      } else if (!steps.length && Array.isArray(this.settings.source)) {
        steps = this.settings.source.map(String);
      }
      this.settings.steps = steps;
      this.settings.bytecode = steps.slice();
      this.settings.instructions = steps.slice();
      return { ok: true, program: this };
    }

    if (lang === 'javascript') {
      let steps = this.steps.slice();
      if (!steps.length && typeof this.settings.source === 'string') {
        steps = this.settings.source.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      } else if (!steps.length && this.settings.source && typeof this.settings.source === 'object') {
        steps = Object.keys(this.settings.source);
      }
      this.settings.steps = steps;
      this.settings.bytecode = steps.slice();
      return { ok: true, program: this };
    }

    if (lang === 'bitcoin-script') {
      try {
        const bitcoin = require('bitcoinjs-lib');
        let compiled = null;
        if (Buffer.isBuffer(this.settings.bytecode)) {
          compiled = this.settings.bytecode;
        } else if (typeof this.settings.bytecode === 'string' && /^[0-9a-fA-F]+$/.test(this.settings.bytecode)) {
          compiled = Buffer.from(this.settings.bytecode, 'hex');
        } else if (Array.isArray(this.settings.source)) {
          compiled = bitcoin.script.compile(this.settings.source);
        } else if (typeof this.settings.source === 'string') {
          const parts = this.settings.source.trim().split(/\s+/).filter(Boolean);
          const chunks = parts.map((p) => {
            if (p.startsWith('OP_') && bitcoin.opcodes[p] != null) return bitcoin.opcodes[p];
            if (/^[0-9a-fA-F]+$/.test(p) && p.length % 2 === 0) return Buffer.from(p, 'hex');
            throw new Error(`unrecognized script token: ${p}`);
          });
          compiled = bitcoin.script.compile(chunks);
        } else {
          return { ok: false, error: 'bitcoin-script requires source asm string, opcode array, or bytecode hex' };
        }
        this.settings.bytecode = compiled;
        this.settings.steps = ['OP_CHECKREDEEM'];
        return { ok: true, program: this };
      } catch (err) {
        return {
          ok: false,
          error: err && err.message ? err.message : 'bitcoin-script compile failed'
        };
      }
    }

    if (lang === 'fabric-execution') {
      let src = this.settings.source;
      if ((!src || typeof src !== 'object') && Array.isArray(this.settings.steps) &&
          this.settings.steps.length && typeof this.settings.steps[0] === 'object') {
        src = { version: 1, steps: this.settings.steps };
      }
      if (!src || typeof src !== 'object' || Array.isArray(src)) {
        return { ok: false, error: 'fabric-execution requires source object with steps[]' };
      }
      if (!Array.isArray(src.steps)) {
        return { ok: false, error: 'fabric-execution source.steps must be an array' };
      }
      const safe = jsonSafe(src);
      this.settings.source = safe;
      this.settings.bytecode = safe;
      // Machine structured runner reads source.steps; script names stay empty.
      this.settings.steps = [];
      this.settings.instructions = [];
      return { ok: true, program: this };
    }

    if (lang === 'solidity' || lang === 'asm') {
      return {
        ok: false,
        error: `${lang} compile not implemented — use Compiler frontend when available`
      };
    }

    return { ok: false, error: `unsupported language: ${lang}` };
  }

  /**
   * L1 redeem script scaffold (bitcoin-script only).
   * @returns {{ok: boolean, error: (string|undefined), scriptHex: (string|undefined), asm: (string|undefined)}}
   */
  toRedeemScript () {
    if (this.language !== 'bitcoin-script') {
      return { ok: false, error: 'toRedeemScript requires language bitcoin-script' };
    }
    const compiled = this.compile();
    if (!compiled.ok) return { ok: false, error: compiled.error };
    const buf = Buffer.isBuffer(this.settings.bytecode)
      ? this.settings.bytecode
      : Buffer.from(String(this.settings.bytecode || ''), 'hex');
    let asm = null;
    try {
      const bitcoin = require('bitcoinjs-lib');
      asm = bitcoin.script.toASM(buf);
    } catch (_) {
      asm = null;
    }
    return {
      ok: true,
      scriptHex: buf.toString('hex'),
      asm
    };
  }

  /**
   * Stable digest binding program identity to a compute result (L1 / OP_RETURN / witness).
   * @param {*} result
   * @returns {string} 64-char hex
   */
  runCommitmentHex (result) {
    const body = fabricCanonicalJson({
      version: 1,
      kind: 'FabricProgramRun',
      programHash: this.programHash,
      result: jsonSafe(result == null ? null : result)
    });
    return crypto.createHash('sha256').update(Buffer.from(body, 'utf8')).digest('hex');
  }

  /**
   * Environment for an untrusted program child. Nothing else from `process.env` is copied.
   * @returns {Object}
   */
  static isolateChildEnv () {
    const env = { FABRIC_PROGRAM_ISOLATE: '1' };
    if (process.env.PATH) env.PATH = process.env.PATH;
    return env;
  }

  /**
   * Run a JSON payload in a short-lived Node process. The default child is this file.
   * @param {Object} payload
   * @param {Object} [options]
   * @param {number} [options.isolateTimeoutMs]
   * @param {string} [options.isolateWorker] test-only worker script
   * @returns {Object} `timedOut`, `parsed`, and `error`
   */
  static spawnIsolate (payload, options = {}) {
    const timeout = Math.min(
      Math.max(1, Number(options.isolateTimeoutMs) || Program.ISOLATE_TIMEOUT_MS),
      60000
    );
    const worker = options.isolateWorker ? String(options.isolateWorker) : __filename;
    const result = spawnSync(process.execPath, [worker], {
      input: JSON.stringify(payload),
      encoding: 'utf8',
      timeout,
      maxBuffer: 1024 * 1024,
      env: Program.isolateChildEnv(),
      cwd: path.join(__dirname, '..')
    });
    if (result.error && result.error.code === 'ETIMEDOUT') {
      return { timedOut: true, parsed: null, error: 'isolate timed out' };
    }
    if (result.error) {
      return {
        timedOut: false,
        parsed: null,
        error: result.error.message || 'isolate failed to start'
      };
    }
    const text = String(result.stdout || '').trim();
    if (result.status !== 0) {
      const stderr = String(result.stderr || '').trim();
      return {
        timedOut: false,
        parsed: null,
        error: stderr || text || `isolate exited ${result.status}`
      };
    }
    try {
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object') {
        return { timedOut: false, parsed: null, error: 'isolate produced no result' };
      }
      return { timedOut: false, parsed, error: undefined };
    } catch (_) {
      return { timedOut: false, parsed: null, error: 'isolate produced no result' };
    }
  }

  /**
   * Run a `fabric-execution` program outside this process.
   * The parent resolves `FabricOpcode` steps. The child does not receive that function.
   * @param {Object} program
   * @param {Object} [options]
   * @returns {Object}
   */
  static runIsolated (program, options = {}) {
    const { executionProgramFromHub, normalizeOpName } = require('../functions/executionProgramRunner');
    const steps = program && program.steps;
    if (!Array.isArray(steps)) {
      return Program._isolateFailure('program.steps must be an array', null, null);
    }
    let built = null;
    try {
      built = executionProgramFromHub(program);
    } catch (err) {
      return Program._isolateFailure(err && err.message ? err.message : String(err), null, null);
    }
    let normalized = steps;
    if (typeof options.resolveFabricEntry === 'function') {
      try {
        normalized = steps.map((step) => {
          if (!step || typeof step !== 'object') return step;
          const copy = {};
          for (const key of Object.keys(step)) {
            if (key === 'resolved') continue;
            copy[key] = step[key];
          }
          if (normalizeOpName(step.op) !== 'FabricOpcode') return copy;
          const entry = options.resolveFabricEntry(copy);
          copy.resolved = {
            name: entry && entry.name != null ? String(entry.name) : '',
            opcodeDec: entry && entry.opcodeDec != null && Number.isFinite(Number(entry.opcodeDec))
              ? Number(entry.opcodeDec)
              : null,
            stability: entry && entry.stability != null ? entry.stability : null,
            encoding: entry && entry.encoding != null ? entry.encoding : null,
            notes: entry && entry.notes != null ? entry.notes : null
          };
          return copy;
        });
      } catch (err) {
        return Program._isolateFailure(err && err.message ? err.message : String(err), built.programHash, built.program);
      }
    }
    const childOptions = { inProcess: true, useResolvedEntries: true };
    if (options.maxSteps != null) childOptions.maxSteps = options.maxSteps;
    if (options.maxStack != null) childOptions.maxStack = options.maxStack;
    if (options.maxDepth != null) childOptions.maxDepth = options.maxDepth;
    if (options.maxTrace != null) childOptions.maxTrace = options.maxTrace;
    if (Array.isArray(options.allowedOpcodes)) childOptions.allowedOpcodes = options.allowedOpcodes.slice();
    if (options.genesis && typeof options.genesis === 'object') childOptions.genesis = options.genesis;
    const spawned = Program.spawnIsolate({
      kind: 'fabric-execution',
      program: jsonSafe(program),
      steps: jsonSafe(normalized),
      options: jsonSafe(childOptions)
    }, options);
    if (!spawned.parsed) {
      return Program._isolateFailure(spawned.error || 'isolate produced no result', built.programHash, built.program);
    }
    const child = spawned.parsed;
    const trace = Array.isArray(child.trace) ? child.trace : [];
    const tip = child.tip != null ? child.tip : null;
    return {
      ok: child.ok === true,
      stepsExecuted: child.stepsExecuted,
      stack: Array.isArray(child.stack) ? child.stack : [],
      tip,
      trace,
      error: child.ok === true ? undefined : (child.error || spawned.error || 'isolate failed'),
      programHash: built.programHash,
      runCommitmentHex: child.ok === true
        ? built.program.runCommitmentHex({ tip, stack: trace })
        : null,
      program: built.program
    };
  }

  /**
   * Run `fabric-opcodes` in a child with an empty opcode table.
   * Parent `define()` functions are not called.
   * @param {Array} steps
   * @param {Object} [options]
   * @returns {Object}
   */
  static runIsolatedOpcodes (steps, options = {}) {
    const spawned = Program.spawnIsolate({
      kind: 'fabric-opcodes',
      steps: jsonSafe(steps || []),
      allowedOpcodes: Array.isArray(options.allowedOpcodes) ? options.allowedOpcodes.slice() : [],
      maxSteps: options.maxSteps,
      maxStack: options.maxStack
    }, options);
    if (!spawned.parsed) {
      return {
        ok: false,
        stack: [],
        tip: null,
        trace: [],
        runCommitmentHex: null,
        programHash: null,
        error: spawned.error || 'isolate produced no result'
      };
    }
    const child = spawned.parsed;
    return {
      ok: child.ok === true,
      stack: Array.isArray(child.stack) ? child.stack : [],
      tip: child.tip != null ? child.tip : null,
      trace: Array.isArray(child.trace) ? child.trace : [],
      runCommitmentHex: child.runCommitmentHex || null,
      programHash: child.programHash || null,
      error: child.ok === true ? undefined : (child.error || 'isolate failed')
    };
  }

  /**
   * @param {string} error
   * @param {string|null} programHash
   * @param {Program|null} program
   * @returns {Object}
   * @private
   */
  static _isolateFailure (error, programHash, program) {
    return {
      ok: false,
      error,
      stack: [],
      tip: null,
      trace: [],
      programHash: programHash || null,
      runCommitmentHex: null,
      program: program || null
    };
  }

  step () {
    return this;
  }

  async start () {
    return this;
  }
}

Program.LANGUAGES = LANGUAGES;
Program.ISOLATE_TIMEOUT_MS = 1000;

module.exports = Program;

const program_run = (function () {
/**
 * Federation attestation strings for execution program runs.
 */

const crypto = require('crypto');
const fabricCanonicalJson = require('../functions/fabricCanonicalJson');
const keyHasPrivateSigningMaterial = require('./key').hasPrivateSigningMaterial;


const EXECUTION_RUN_SIGNING_KIND = 'FabricProgramRun';

/**
 * UTF-8 string federation members sign for an execution run commitment.
 * @param {Object} run
 * @param {string} run.programHash
 * @param {string} run.runCommitmentHex
 * @param {string|null} [run.contractId]
 * @returns {string}
 */
function signingStringForExecutionRun (run) {
  return fabricCanonicalJson({
    version: 1,
    kind: EXECUTION_RUN_SIGNING_KIND,
    programHash: String(run.programHash || ''),
    runCommitmentHex: String(run.runCommitmentHex || '').toLowerCase(),
    contractId: run.contractId != null ? String(run.contractId) : null
  });
}

/**
 * SHA-256 hex digest of {@link signingStringForExecutionRun}.
 * @param {Object} run
 * @param {string} run.programHash
 * @param {string} run.runCommitmentHex
 * @param {string|null} [run.contractId]
 * @returns {string}
 */
function executionRunCommitmentDigestHex (run) {
  const s = signingStringForExecutionRun(run);
  return crypto.createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex');
}

/**
 * Build federation witness for an execution run attestation.
 * @param {Object} opts
 * @param {string} opts.programHash
 * @param {string} opts.runCommitmentHex
 * @param {string|null} [opts.contractId]
 * @param {Object} opts.signKey
 * @param {string[]} [opts.validators]
 * @param {number} [opts.threshold]
 * @returns {object|null}
 */
function buildFederationWitnessForExecutionRun (opts) {
  const signKey = opts.signKey;
  if (!signKey || typeof signKey.signSchnorr !== 'function') return null;
  if (!keyHasPrivateSigningMaterial(signKey)) return null;
  const msgBuf = Buffer.from(signingStringForExecutionRun(opts), 'utf8');
  const sigHex = signKey.signSchnorr(msgBuf, require('../functions/beaconFederationSigning').FEDERATION_WITNESS_TAG).toString('hex');
  const pk = signKey.pubkey != null ? String(signKey.pubkey) : '';
  if (!pk) return null;
  const witness = { version: 1, signatures: { [pk]: sigHex } };
  if (Array.isArray(opts.validators) && opts.validators.length) {
    witness.validators = opts.validators.slice();
    witness.threshold = Math.max(1, Number(opts.threshold) || 1);
  }
  return witness;
}

/**
 * Verify federation witness over an execution run attestation.
 * @param {Object} run
 * @param {string} run.programHash
 * @param {string} run.runCommitmentHex
 * @param {string|null} [run.contractId]
 * @param {object|null} federationWitness
 * @param {string[]} validators
 * @param {number} threshold
 * @returns {boolean}
 */
function verifyExecutionRunFederationWitness (run, federationWitness, validators, threshold) {
  const msgBuf = Buffer.from(signingStringForExecutionRun(run), 'utf8');
  return require('../functions/beaconFederationSigning').verifyFederationWitnessOnMessage(msgBuf, federationWitness, validators, threshold);
}
  return {
    EXECUTION_RUN_SIGNING_KIND,
    signingStringForExecutionRun,
    executionRunCommitmentDigestHex,
    buildFederationWitnessForExecutionRun,
    verifyExecutionRunFederationWitness
  };
})();
Program.EXECUTION_RUN_SIGNING_KIND = program_run.EXECUTION_RUN_SIGNING_KIND;
Program.signingStringForExecutionRun = program_run.signingStringForExecutionRun;
Program.executionRunCommitmentDigestHex = program_run.executionRunCommitmentDigestHex;
Program.buildFederationWitnessForExecutionRun = program_run.buildFederationWitnessForExecutionRun;
Program.verifyExecutionRunFederationWitness = program_run.verifyExecutionRunFederationWitness;

if (require.main === module) {
  const { runExecutionProgramInProcess } = require('../functions/executionProgramRunner');

  function write (value) {
    process.stdout.write(JSON.stringify(value));
  }

  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    raw += chunk;
  });
  process.stdin.on('end', () => {
    let payload;
    try {
      payload = JSON.parse(raw || '{}');
    } catch (_) {
      write({ ok: false, error: 'isolate input is not JSON' });
      return;
    }
    try {
      if (payload.kind === 'fabric-opcodes') {
        const Machine = require('./machine');
        const machine = new Machine({
          deterministic: true,
          allowedOpcodes: payload.allowedOpcodes || null,
          maxSteps: payload.maxSteps,
          maxStack: payload.maxStack
        });
        machine.runProgram({
          language: 'fabric-opcodes',
          steps: Array.isArray(payload.steps) ? payload.steps : []
        }).then((result) => {
          write({
            ok: result.ok === true,
            stack: result.stack || [],
            tip: result.tip != null ? result.tip : null,
            trace: result.trace || [],
            runCommitmentHex: result.runCommitmentHex || null,
            programHash: result.programHash || null,
            error: result.error
          });
        }).catch((err) => {
          write({ ok: false, error: err && err.message ? err.message : String(err) });
        });
        return;
      }
      const program = Object.assign({}, payload.program, {
        steps: Array.isArray(payload.steps) ? payload.steps : (payload.program && payload.program.steps)
      });
      const result = runExecutionProgramInProcess(program, Object.assign({}, payload.options, {
        inProcess: true,
        useResolvedEntries: true
      }));
      write({
        ok: result.ok === true,
        stepsExecuted: result.stepsExecuted,
        stack: result.stack || [],
        tip: result.tip != null ? result.tip : null,
        trace: result.trace || [],
        programHash: result.programHash || null,
        runCommitmentHex: result.runCommitmentHex || null,
        error: result.error
      });
    } catch (err) {
      write({ ok: false, error: err && err.message ? err.message : String(err) });
    }
  });
}
