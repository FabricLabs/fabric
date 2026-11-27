'use strict'; // commit (.) and continue (,) ⇒ ;

// Constants
const {
  MACHINE_MAX_MEMORY
} = require('../constants');

// Dependencies
const monitor = require('fast-json-patch');
const BN = require('bn.js');

// Fabric Types
const Actor = require('./actor');
const State = require('./state');
const Key = require('./key');

// Fabric Functions
const {
  createDefaultOpcodeRegistry,
  defineOpcode: defineOpcodeEntry,
  resolveOpcodeContract
} = require('../functions/opcodeRegistry');
const {
  normalizeOpcodeAllowList,
  opcodesFromGenesis,
  opcodeAllowed,
  assertStepsAllowed
} = require('../functions/opcodeAllowList');
const {
  DEFAULT_MAX_STEPS,
  DEFAULT_MAX_STACK
} = require('../functions/executionProgramRunner');

/**
 * Step cap for one `compute`. Settings may lower or raise it up to 4096.
 * @param {Object} settings
 * @returns {number}
 * @private
 */
function stepCap (settings) {
  const n = Number(settings && settings.maxSteps);
  if (Number.isFinite(n) && n > 0) return Math.min(Math.floor(n), 4096);
  return DEFAULT_MAX_STEPS;
}

/**
 * Stack cap for one `compute`. Settings may lower or raise it up to 256.
 * @param {Object} settings
 * @returns {number}
 * @private
 */
function stackCap (settings) {
  const n = Number(settings && settings.maxStack);
  if (Number.isFinite(n) && n > 0) return Math.min(Math.floor(n), 256);
  return DEFAULT_MAX_STACK;
}

// Strict JSON
const { parsePersistedJson } = require('../functions/wireJson');
const { jsonSafe } = require('../functions/fabricCanonicalJson');

/**
 * @classdesc Deterministic <strong>virtual machine</strong> layer extending {@link Actor}: script/stack, fixed memory buffer,
 * clock, and a {@link Key}-backed generator for reproducible “random” bits (<code>sip</code>). Consumes {@link State}-signed
 * instruction entries from {@link Fabric#push} — not the same as P2P {@link Message} dispatch (see
 * <code>types/message.js</code>).
 * @class Machine
 * @extends Actor
 */
class Machine extends Actor {
  /**
   * Parse a JSON object of Buffer-like entries into an array of {@link Buffer}s (legacy wire / script helper).
   * @param {string} [input='']
   * @returns {Buffer[]}
   */
  static fromObjectString (input = '') {
    if (!input) throw new Error('Must provide input.');
    if (typeof input !== 'string') input = JSON.stringify(input);
    const result = [];
    const object = parsePersistedJson(input);

    for (const i in object) {
      let element = object[i];

      if (element instanceof Array) {
        element = Buffer.from(element);
      } else {
        element = Buffer.from(element.data);
      }

      result.push(element);
    }

    return result;
  }

  /**
   * Create a Machine.
   * @param {Object} settings Run-time configuration.
   */
  constructor (settings) {
    super(settings);

    // settings
    this.settings = Object.assign({
      path: './stores/machine',
      clock: 0,
      debug: false,
      deterministic: true,
      interval: 60, // seconds
      key: null,
      precision: 8,
      script: [],
      type: 'x86',
      // Opcode allow-list. Null or empty still fail-closes unknown opcodes.
      allowedOpcodes: null,
      maxSteps: null,
      maxStack: null
    }, settings);

    // machine key
    this.key = new Key(this.settings.key);

    // internal clock
    this.clock = this.settings.clock;

    // deterministic entropy and RNG
    this.entropy = this.sip();
    // `memory` is allocated on first access (see getter); most Machines never touch it.
    Object.defineProperty(this, '_memory', { value: null, writable: true, enumerable: false, configurable: true });

    this.known = Object.create(null);
    this.opcodes = createDefaultOpcodeRegistry();
    this.stack = []; // output
    this.history = []; // State tree
    this._allowedOpcodes = normalizeOpcodeAllowList(this.settings.allowedOpcodes || []);

    this._state = {
      content: {
        clock: this.clock
      },
      status: 'PAUSED'
    };

    // watch for changes
    this.observer = monitor.observe(this._state.content);

    // ensure chainability
    return this;
  }

  /**
   * VM memory (`MACHINE_MAX_MEMORY` bytes), allocated on first access.
   * @type {Buffer}
   */
  get memory () {
    if (this._memory === null || this._memory === undefined) {
      this._memory = Buffer.alloc(MACHINE_MAX_MEMORY);
    }
    return this._memory;
  }

  set memory (value) {
    this._memory = value;
  }

  get interval () {
    return this.settings.interval;
  }

  get frequency () {
    return (1 / this.interval).toFixed(this.settings.precision);
  }

  get script () {
    return this.settings.script;
  }

  get tip () {
    this.log(`tip requested, history: ${JSON.stringify(this.history)}`);
    return this.history[this.history.length - 1] || null;
  }

  /**
   * Active opcode allow-list (empty = no extra name filter).
   * Unknown opcodes still throw.
   * @returns {string[]}
   */
  get allowedOpcodes () {
    return this._allowedOpcodes.slice();
  }

  /**
   * Restrict `define` / `loadProgram` / `compute` to this opcode set.
   * Empty / null clears the name filter. Unknown opcodes still throw.
   * @param {Iterable<*>|null} list
   * @returns {Machine}
   */
  setAllowedOpcodes (list) {
    this._allowedOpcodes = normalizeOpcodeAllowList(list || []);
    this.settings.allowedOpcodes = this._allowedOpcodes.length
      ? this._allowedOpcodes.slice()
      : null;
    return this;
  }

  /**
   * Apply ARC / Program genesis `primitives.opcodes` as the Machine allow-list.
   * No-op when genesis has no opcodes (keeps unrestricted).
   * @param {object} [genesis]
   * @returns {Machine}
   */
  applyGenesisOpcodes (genesis) {
    const list = opcodesFromGenesis(genesis);
    if (list.length) this.setAllowedOpcodes(list);
    return this;
  }

  bit () {
    return this.key.generator.next.bits(1);
  }

  /**
   * Get `n` bits of deterministic random data.
   * @param  {Number} [n=128] Number of bits to retrieve.
   * @return {Number}        Random bits from {@link Generator}.
   */
  sip (n = 128) {
    const self = this;
    return new BN([...Array(n)].map(() => {
      return self.bit().toString();
    }).join(''), 2).toString(16);
  }

  /**
   * Get `n` bytes of deterministic random data.
   * @param  {Number} [n=32] Number of bytes to retrieve.
   * @return {Number}        Random bytes from {@link Generator}.
   */
  slurp (n = 32) {
    const self = this;
    return new BN([...Array(n * 8)].map(() => {
      return self.bit();
    }).join(''), 2).toString(16);
  }

  validateCycle (_i) {
    return false;
  }

  /**
   * Computes the next "step" for our current Vector.  Analagous to `sum`.
   * The top item on the stack is always the memory held at current position,
   * so counts should always begin with 0.
   * @param  {Object} input Value to pass as input.
   * @return {Machine} Instance of the resulting machine.
   */
  async compute (input, limits) {
    ++this.clock;

    this.emit('tick', this.clock);

    const allow = this._allowedOpcodes;
    const restricted = allow && allow.length > 0;
    const script = Array.isArray(this.script) ? this.script : [];
    const capped = limits && typeof limits === 'object'
      ? Object.assign({}, this.settings, {
        maxSteps: limits.maxSteps != null ? limits.maxSteps : this.settings.maxSteps,
        maxStack: limits.maxStack != null ? limits.maxStack : this.settings.maxStack
      })
      : this.settings;
    const maxSteps = stepCap(capped);
    const maxStack = stackCap(capped);
    if (script.length > maxSteps) {
      throw new Error(`program exceeds maxSteps (${maxSteps})`);
    }

    let executed = 0;
    for (let i = 0; i < script.length; i++) {
      if (executed >= maxSteps) {
        throw new Error(`program exceeds maxSteps (${maxSteps})`);
      }
      executed += 1;
      if (!Object.prototype.hasOwnProperty.call(script, i)) continue;
      const instruction = script[i];
      const name = String(instruction == null ? '' : instruction);
      if (restricted && !opcodeAllowed(allow, name)) {
        throw new Error(`opcode not in primitives.opcodes allow-list: ${name}`);
      }
      const method = Object.prototype.hasOwnProperty.call(this.known, name) ? this.known[name] : undefined;

      if (typeof method === 'function') {
        const data = method.call(this.state, input);
        this.stack.push(data);
      } else if (restricted) {
        throw new Error(`opcode not defined (fail closed under allow-list): ${name}`);
      } else {
        throw new Error(`opcode not defined: ${name}`);
      }
      if (this.stack.length > maxStack) {
        throw new Error('stack overflow');
      }
    }

    this._state.content = (this.stack.length)
      ? this.stack[this.stack.length - 1]
      : this._state.content;

    this._result = this.state;
    this.commit();

    return this;
  }

  asBuffer () {
    const data = this.serialize(this.state);
    return Buffer.from(data);
  }

  // register a local function
  define (name, op, definition = {}) {
    const opName = String(name == null ? '' : name);
    if (!opName) throw new Error('opcode name required');
    if (this._allowedOpcodes && this._allowedOpcodes.length
      && !opcodeAllowed(this._allowedOpcodes, opName)) {
      throw new Error(`define rejected: opcode not in primitives.opcodes allow-list: ${opName}`);
    }
    if (typeof op !== 'function') {
      throw new Error(`define requires a function for opcode: ${opName}`);
    }
    this.known[opName] = op.bind(this.state);
    defineOpcodeEntry(this.opcodes, opName, Object.assign({}, definition, {
      implementation: true
    }));
    return this.known[opName];
  }

  defineOpcode (name, op, definition = {}) {
    return this.define(name, op, definition);
  }

  defineBitcoinOpcode (name, op, definition = {}) {
    return this.define(name, op, Object.assign({}, definition, { family: 'bitcoin' }));
  }

  defineFabricOpcode (name, op, definition = {}) {
    return this.define(name, op, Object.assign({}, definition, { family: 'fabric' }));
  }

  compileOpcodeContract (body = '') {
    const resolved = resolveOpcodeContract(this.opcodes, body);
    if (resolved.unknown.length) {
      throw new Error(`Unknown opcodes in contract: ${resolved.unknown.join(', ')}`);
    }
    return resolved.lines;
  }

  /**
   * Parse program manifest v1 (former DistributedExecution.parseDistributedManifestV1).
   * @param {Object} raw
   * @param {Program|null} [program] When provided, programId/hash must match.
   * @returns {{ok: boolean, error: (string|undefined), manifest: (Object|undefined)}}
   */
  parseManifest (raw, program = null) {
    const { parseProgramManifestV1 } = require('../functions/fabricProgramManifest');
    const parsed = parseProgramManifestV1(raw);
    if (!parsed.ok) return parsed;
    if (program) {
      const hash = program.programHash || (typeof program.hash === 'function' ? program.hash() : null);
      if (hash && parsed.manifest.programHash !== hash) {
        return { ok: false, error: 'manifest programHash does not match Program' };
      }
    }
    return parsed;
  }

  /**
   * Load a {@link Program} onto this machine (sets script steps).
   * When an opcode allow-list is active (ctor `allowedOpcodes`,
   * {@link Machine#setAllowedOpcodes}, {@link Machine#applyGenesisOpcodes},
   * or Program/genesis `primitives.opcodes`), steps and javascript `source`
   * keys must be listed — fail closed. Unknown opcodes throw even with no
   * allow-list. A `javascript` program's functions register only when
   * `opts.trusted` is true (local operator). Mesh and Hub runs omit it.
   * @param {Program|object} program
   * @param {Object} [opts]
   * @param {Object} [opts.genesis] ARC genesis; may supply `primitives.opcodes` allow-list
   * @param {boolean} [opts.trusted] register `javascript` source functions on this host
   * @returns {Machine}
   */
  loadProgram (program, opts = {}) {
    const Program = require('./program');
    const prog = program instanceof Program ? program : Program.from(program || {});
    const compiled = prog.compile();
    if (!compiled.ok) {
      throw new Error(compiled.error || 'program compile failed');
    }

    if (prog.language === 'javascript' && prog.source && typeof prog.source === 'object' &&
        !Array.isArray(prog.source)) {
      const fns = Object.entries(prog.source).filter((entry) => typeof entry[1] === 'function');
      if (fns.length && opts.trusted !== true) {
        throw new Error('javascript program source requires trusted: true');
      }
    }

    // Program or caller genesis may install an allow-list when unrestricted.
    const fromExtra = normalizeOpcodeAllowList(
      opcodesFromGenesis(opts.genesis || {})
        .concat(opcodesFromGenesis(prog))
        .concat(opcodesFromGenesis(prog.settings || {}))
    );
    if (fromExtra.length && !(this._allowedOpcodes && this._allowedOpcodes.length)) {
      this.setAllowedOpcodes(fromExtra);
    }

    const steps = prog.steps.slice();
    const stepCheck = assertStepsAllowed(this._allowedOpcodes, steps);
    if (!stepCheck.ok) throw new Error(stepCheck.error);

    if (prog.language === 'javascript' && prog.source && typeof prog.source === 'object' &&
        !Array.isArray(prog.source)) {
      const fns = Object.entries(prog.source).filter((entry) => typeof entry[1] === 'function');
      if (fns.length && opts.trusted !== true) {
        throw new Error('javascript program source requires trusted: true');
      }
      if (opts.trusted === true) {
        for (const [name, fn] of fns) this.define(name, fn);
      }
    }
    this.settings.script = steps;
    this._program = prog;
    return this;
  }

  /**
   * Load and compute a Program; return stack tip + run commitment for L1 binding.
   * @param {Program|Object} program
   * @param {*} [input]
   * @param {Object} [opts]
   * @param {Object} [opts.genesis] ARC genesis for `primitives.opcodes` allow-list
   * @returns {Promise.<{ok: boolean, stack: Array, tip: *, trace: Array, runCommitmentHex: (string|null), error: (string|undefined)}>}
   */
  async runProgram (program, input, opts = {}) {
    try {
      const Program = require('./program');
      const prog = program instanceof Program ? program : Program.from(program || {});
      if (opts.isolate === true && prog.language === 'fabric-opcodes') {
        const compiled = prog.compile();
        if (!compiled.ok) {
          return {
            ok: false,
            stack: [],
            tip: null,
            trace: [],
            runCommitmentHex: null,
            programHash: prog.programHash,
            error: compiled.error || 'compile failed'
          };
        }
        return Machine.runIsolatedOpcodesAsync(prog.steps, {
          allowedOpcodes: this._allowedOpcodes,
          maxSteps: opts.maxSteps != null ? opts.maxSteps : this.settings.maxSteps,
          maxStack: opts.maxStack != null ? opts.maxStack : this.settings.maxStack,
          isolateTimeoutMs: opts.isolateTimeoutMs,
          isolateWorker: opts.isolateWorker,
          workerUrl: opts.workerUrl
        });
      }
      if (prog.language === 'fabric-execution') {
        const {
          runExecutionProgram
        } = require('../functions/executionProgramRunner');
        if (opts.genesis) this.applyGenesisOpcodes(opts.genesis);
        const src = prog.settings.source && typeof prog.settings.source === 'object'
          ? prog.settings.source
          : program;
        const pass = {};
        if (opts.genesis) pass.genesis = opts.genesis;
        if (opts.maxSteps != null) pass.maxSteps = opts.maxSteps;
        else if (this.settings.maxSteps != null) pass.maxSteps = this.settings.maxSteps;
        if (opts.maxStack != null) pass.maxStack = opts.maxStack;
        else if (this.settings.maxStack != null) pass.maxStack = this.settings.maxStack;
        if (opts.maxDepth != null) pass.maxDepth = opts.maxDepth;
        if (opts.maxTrace != null) pass.maxTrace = opts.maxTrace;
        if (opts.isolateTimeoutMs != null) pass.isolateTimeoutMs = opts.isolateTimeoutMs;
        if (opts.isolateWorker != null) pass.isolateWorker = opts.isolateWorker;
        if (opts.workerUrl != null) pass.workerUrl = opts.workerUrl;
        if (opts.inProcess === true) {
          pass.inProcess = true;
          pass.machine = this;
        }
        if (typeof opts.resolveFabricEntry === 'function') pass.resolveFabricEntry = opts.resolveFabricEntry;
        if (this._allowedOpcodes && this._allowedOpcodes.length) {
          pass.allowedOpcodes = this._allowedOpcodes;
        }
        const result = await Promise.resolve(runExecutionProgram(src, pass));
        return {
          ok: result.ok,
          stack: result.stack || [],
          tip: result.tip != null
            ? result.tip
            : (result.stack && result.stack.length ? result.stack[result.stack.length - 1] : null),
          trace: result.trace || [],
          runCommitmentHex: result.runCommitmentHex || null,
          programHash: result.programHash || null,
          stepsExecuted: result.stepsExecuted,
          error: result.error,
          program: result.program || prog
        };
      }
      this.loadProgram(program, opts);
      const beforeLen = this.stack.length;
      await this.compute(input, {
        maxSteps: opts.maxSteps,
        maxStack: opts.maxStack
      });
      const trace = this.stack.slice(beforeLen);
      const tip = this.stack.length ? this.stack[this.stack.length - 1] : null;
      const runCommitmentHex = this._program
        ? this._program.runCommitmentHex({ tip, stack: trace })
        : null;
      return {
        ok: true,
        stack: this.stack.slice(),
        tip,
        trace,
        runCommitmentHex,
        programHash: this._program ? this._program.programHash : null,
        program: this._program || null
      };
    } catch (err) {
      return {
        ok: false,
        stack: this.stack.slice(),
        tip: null,
        trace: [],
        runCommitmentHex: null,
        programHash: null,
        error: err && err.message ? err.message : String(err)
      };
    }
  }

  applyOperation (op) {
    monitor.applyOperation(this.state, op);
  }

  commit () {
    if (!this.history) this.history = [];
    if (!this.observer) return false;

    const changes = monitor.generate(this.observer);

    if (changes && changes.length) {
      let vector = new State({
        '@type': 'Change',
        '@data': changes,
        method: 'patch',
        parent: this.id,
        params: changes
      });

      this.history.push(vector);

      this.emit('transaction', vector);
      this.emit('changes', changes);
    }

    return changes;
  }

  async start () {
    this.status = 'STARTING';
    const f = this.settings.frequency;
    const fromFreq = (typeof f === 'number' && Number.isFinite(f)) ? f * 1000 : NaN;
    const intervalSec = (typeof this.settings.interval === 'number' && Number.isFinite(this.settings.interval))
      ? this.settings.interval
      : 60;
    const ms = Number.isFinite(fromFreq) && fromFreq > 0 ? fromFreq : Math.max(1, intervalSec * 1000);
    this._governor = setInterval(() => {
      Promise.resolve(this.compute()).catch((err) => {
        this.stop();
        if (this.listenerCount('error') > 0) this.emit('error', err);
      });
    }, ms);
    this.status = 'STARTED';
    return this;
  }

  async stop () {
    this.status = 'STOPPING';
    if (this._governor) clearInterval(this._governor);
    this.status = 'STOPPED';
    return this;
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
   * True when this process can block on a Node worker. Browsers cannot.
   * @returns {boolean}
   */
  static nodeIsolate () {
    return typeof process !== 'undefined'
      && process.versions != null
      && typeof process.versions.node === 'string'
      && process.versions.node.length > 0;
  }

  /**
   * Milliseconds to wait for one isolate, clamped to 1..60000.
   * @param {Object} [options]
   * @param {number} [options.isolateTimeoutMs]
   * @returns {number}
   * @private
   */
  static _isolateTimeout (options) {
    return Math.min(
      Math.max(1, Number(options && options.isolateTimeoutMs) || Machine.ISOLATE_TIMEOUT_MS),
      60000
    );
  }

  /**
   * Worker script for {@link Machine.runPayload}. Test fixtures may pass a file path.
   * @returns {string}
   */
  static isolateThreadSource () {
    return [
      "'use strict';",
      'var ISOLATE_MAX_STEPS = 256;',
      'var ISOLATE_MAX_STACK = 64;',
      'var DEFAULT_MAX_DEPTH = 16;',
      'var DEFAULT_MAX_TRACE = 512;',
      'var OP_NAMES = { push: "Push", pop: "Pop", dup: "Dup", add: "ADD", fabricopcode: "FabricOpcode", delegationsignrequest: "DelegationSignRequest" };',
      isolateClampInt.toString(),
      isolateOpcodeAllowed.toString(),
      isolateNormalizeOpName.toString(),
      isolateAssertPlainJson.toString(),
      isolateFail.toString(),
      isolateRunExecutionSteps.toString(),
      isolateRunOpcodeSteps.toString(),
      isolateRunPayload.toString(),
      isolateReplyTo.toString(),
      isolateOnMessage.toString(),
      isolateAttachPort.toString(),
      'isolateAttachPort();',
      ''
    ].join('\n');
  }

  /**
   * Block until the Node worker posts a result, then terminate it.
   * @param {Object} payload
   * @param {Object} [options]
   * @param {number} [options.isolateTimeoutMs]
   * @param {string} [options.isolateWorker] test-only worker script
   * @returns {Object} `timedOut`, `parsed`, and `error`
   */
  static spawnIsolate (payload, options = {}) {
    if (!Machine.nodeIsolate()) {
      return {
        timedOut: false,
        parsed: null,
        error: 'program isolate is async in the browser'
      };
    }
    const timeout = Machine._isolateTimeout(options);
    let threads;
    try {
      threads = require('worker_threads');
    } catch (err) {
      return { timedOut: false, parsed: null, error: 'program isolate requires a Worker' };
    }
    if (!threads || typeof threads.Worker !== 'function' || typeof threads.receiveMessageOnPort !== 'function') {
      return { timedOut: false, parsed: null, error: 'program isolate requires a Worker' };
    }
    const channel = new threads.MessageChannel();
    const workerFile = (process.env.NODE_ENV === 'test' && options.isolateWorker)
      ? String(options.isolateWorker)
      : '';
    const workerOptions = {
      env: Machine.isolateChildEnv(),
      resourceLimits: { maxOldGenerationSizeMb: 64 }
    };
    let worker;
    try {
      worker = workerFile
        ? new threads.Worker(workerFile, workerOptions)
        : new threads.Worker(Machine.isolateThreadSource(), Object.assign({ eval: true }, workerOptions));
    } catch (err) {
      return {
        timedOut: false,
        parsed: null,
        error: err && err.message ? err.message : 'isolate failed to start'
      };
    }
    worker.on('error', function () {});
    try {
      worker.postMessage({ payload: payload, port: channel.port2 }, [channel.port2]);
    } catch (err) {
      worker.terminate();
      return {
        timedOut: false,
        parsed: null,
        error: err && err.message ? err.message : 'isolate failed to start'
      };
    }
    const deadline = Date.now() + timeout;
    const pause = new Int32Array(new SharedArrayBuffer(4));
    let parsed = null;
    while (Date.now() < deadline) {
      const got = threads.receiveMessageOnPort(channel.port1);
      if (got && got.message && typeof got.message === 'object') {
        parsed = got.message;
        break;
      }
      Atomics.wait(pause, 0, 0, 10);
    }
    channel.port1.close();
    worker.terminate();
    if (!parsed) return { timedOut: true, parsed: null, error: 'isolate timed out' };
    return { timedOut: false, parsed: parsed, error: undefined };
  }

  /**
   * Browser Worker for one payload. Node callers get the blocking result.
   * @param {Object} payload
   * @param {Object} [options]
   * @param {number} [options.isolateTimeoutMs]
   * @param {string} [options.workerUrl] same-origin Worker script, instead of a blob
   * @returns {Promise.<Object>} `timedOut`, `parsed`, and `error`
   */
  static spawnIsolateAsync (payload, options = {}) {
    if (Machine.nodeIsolate()) return Promise.resolve(Machine.spawnIsolate(payload, options));
    return new Promise(function (resolve) {
      if (typeof Worker !== 'function') {
        resolve({ timedOut: false, parsed: null, error: 'program isolate requires a Worker' });
        return;
      }
      let worker = null;
      let blobUrl = null;
      let settled = false;
      function finish (result) {
        if (settled) return;
        settled = true;
        if (worker && typeof worker.terminate === 'function') worker.terminate();
        if (blobUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
          URL.revokeObjectURL(blobUrl);
        }
        resolve(result);
      }
      try {
        if (options.workerUrl) {
          worker = new Worker(String(options.workerUrl));
        } else {
          const source = Machine.isolateThreadSource();
          blobUrl = URL.createObjectURL(new Blob([source], { type: 'application/javascript' }));
          worker = new Worker(blobUrl);
        }
      } catch (err) {
        finish({
          timedOut: false,
          parsed: null,
          error: err && err.message ? err.message : 'program isolate requires a Worker'
        });
        return;
      }
      const timer = setTimeout(function () {
        finish({ timedOut: true, parsed: null, error: 'isolate timed out' });
      }, Machine._isolateTimeout(options));
      worker.onmessage = function (event) {
        clearTimeout(timer);
        const parsed = event && event.data;
        if (!parsed || typeof parsed !== 'object') {
          finish({ timedOut: false, parsed: null, error: 'isolate produced no result' });
          return;
        }
        finish({ timedOut: false, parsed: parsed, error: undefined });
      };
      worker.onerror = function (event) {
        clearTimeout(timer);
        finish({
          timedOut: false,
          parsed: null,
          error: (event && event.message) || 'isolate failed to start'
        });
      };
      try {
        worker.postMessage(payload);
      } catch (err) {
        clearTimeout(timer);
        finish({
          timedOut: false,
          parsed: null,
          error: err && err.message ? err.message : 'isolate failed to start'
        });
      }
    });
  }

  /**
   * JSON payload for a fabric-execution thread. The parent resolves FabricOpcode.
   * @param {Object} program
   * @param {Object} [options]
   * @returns {Object} `failure`, `built`, and `payload`
   * @private
   */
  static _prepareExecutionIsolate (program, options = {}) {
    const { executionProgramFromHub, normalizeOpName } = require('../functions/executionProgramRunner');
    const steps = program && program.steps;
    if (!Array.isArray(steps)) {
      return { failure: Machine._isolateFailure('program.steps must be an array', null, null), built: null, payload: null };
    }
    const stepCapForIsolate = isolateClampInt(options.maxSteps, 256, 4096);
    if (steps.length > stepCapForIsolate) {
      return {
        failure: Machine._isolateFailure(`program exceeds maxSteps (${stepCapForIsolate})`, null, null),
        built: null,
        payload: null
      };
    }
    let built = null;
    try {
      built = executionProgramFromHub(program);
    } catch (err) {
      return {
        failure: Machine._isolateFailure(err && err.message ? err.message : String(err), null, null),
        built: null,
        payload: null
      };
    }
    let normalized = steps;
    const resolve = options.resolveFabricEntry;
    try {
      normalized = steps.map((step) => {
        if (!step || typeof step !== 'object') return step;
        const copy = {};
        for (const key of Object.keys(step)) {
          if (key === 'resolved') continue;
          copy[key] = step[key];
        }
        if (typeof resolve !== 'function' || normalizeOpName(step.op) !== 'FabricOpcode') return copy;
        const entry = resolve(copy);
        if (!entry || typeof entry !== 'object' || entry.name == null || String(entry.name) === '') {
          throw new Error('FabricOpcode unresolved');
        }
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
      return {
        failure: Machine._isolateFailure(err && err.message ? err.message : String(err), built.programHash, built.program),
        built,
        payload: null
      };
    }
    const childOptions = { useResolvedEntries: typeof resolve === 'function' };
    if (options.maxSteps != null) childOptions.maxSteps = options.maxSteps;
    if (options.maxStack != null) childOptions.maxStack = options.maxStack;
    if (options.maxDepth != null) childOptions.maxDepth = options.maxDepth;
    if (options.maxTrace != null) childOptions.maxTrace = options.maxTrace;
    const { opcodesFromGenesis, normalizeOpcodeAllowList } = require('../functions/opcodeAllowList');
    let allow = Array.isArray(options.allowedOpcodes) ? normalizeOpcodeAllowList(options.allowedOpcodes) : [];
    if (!allow.length && options.genesis) allow = opcodesFromGenesis(options.genesis);
    if (allow.length) childOptions.allowedOpcodes = allow;
    try {
      rejectNonFinite(program);
      rejectNonFinite(normalized);
      if (Object.prototype.hasOwnProperty.call(options, 'seedValue')) {
        rejectNonFinite(options.seedValue);
        childOptions.seedValue = jsonSafe(options.seedValue);
      }
    } catch (err) {
      return {
        failure: Machine._isolateFailure(err && err.message ? err.message : String(err), built.programHash, built.program),
        built,
        payload: null
      };
    }
    return {
      failure: null,
      built,
      payload: {
        kind: 'fabric-execution',
        program: jsonSafe(program),
        steps: jsonSafe(normalized),
        options: jsonSafe(childOptions)
      }
    };
  }

  /**
   * Attach the parent program hash and run commitment to a thread result.
   * @param {Object} prepared
   * @param {Object} spawned
   * @returns {Object}
   * @private
   */
  static _finishExecutionIsolate (prepared, spawned) {
    const built = prepared.built;
    if (!spawned || !spawned.parsed) {
      return Machine._isolateFailure(
        (spawned && spawned.error) || 'isolate produced no result',
        built.programHash,
        built.program
      );
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
   * Run a `fabric-execution` program on a Worker thread.
   * The parent resolves `FabricOpcode` steps. The thread does not receive that function.
   * On Node this blocks. In a browser it fails closed; await {@link Machine.runIsolatedAsync}.
   * @param {Object} program
   * @param {Object} [options]
   * @returns {Object}
   */
  static runIsolated (program, options = {}) {
    const prepared = Machine._prepareExecutionIsolate(program, options);
    if (prepared.failure) return prepared.failure;
    if (!Machine.nodeIsolate()) {
      return Machine._isolateFailure(
        'program isolate is async in the browser',
        prepared.built.programHash,
        prepared.built.program
      );
    }
    return Machine._finishExecutionIsolate(prepared, Machine.spawnIsolate(prepared.payload, options));
  }

  /**
   * Browser-awaitable form of {@link Machine.runIsolated}. Node still blocks inside the worker.
   * @param {Object} program
   * @param {Object} [options]
   * @returns {Promise.<Object>}
   */
  static runIsolatedAsync (program, options = {}) {
    const prepared = Machine._prepareExecutionIsolate(program, options);
    if (prepared.failure) return Promise.resolve(prepared.failure);
    if (Machine.nodeIsolate()) {
      return Promise.resolve(Machine._finishExecutionIsolate(prepared, Machine.spawnIsolate(prepared.payload, options)));
    }
    return Machine.spawnIsolateAsync(prepared.payload, options).then(function (spawned) {
      return Machine._finishExecutionIsolate(prepared, spawned);
    });
  }

  /**
   * @param {Array} steps
   * @param {Object} [options]
   * @returns {Object}
   * @private
   */
  static _opcodeIsolatePayload (steps, options = {}) {
    const payload = {
      kind: 'fabric-opcodes',
      steps: jsonSafe(steps || []),
      allowedOpcodes: Array.isArray(options.allowedOpcodes) ? options.allowedOpcodes.slice() : [],
      maxSteps: options.maxSteps,
      maxStack: options.maxStack
    };
    if (Object.prototype.hasOwnProperty.call(options, 'seedValue')) {
      payload.seedValue = jsonSafe(options.seedValue);
    }
    return payload;
  }

  /**
   * Recompute the opcode-run commitment in the parent. The thread has an empty
   * opcode table and does not receive host `define()` functions.
   * @param {Array} steps
   * @param {Object} spawned
   * @returns {Object}
   * @private
   */
  static _finishOpcodeIsolate (steps, spawned) {
    if (!spawned || !spawned.parsed) {
      return {
        ok: false,
        stack: [],
        tip: null,
        trace: [],
        runCommitmentHex: null,
        programHash: null,
        error: (spawned && spawned.error) || 'isolate produced no result'
      };
    }
    const child = spawned.parsed;
    const trace = Array.isArray(child.trace) ? child.trace : [];
    const tip = child.tip != null ? child.tip : null;
    let program = null;
    let programHash = null;
    let runCommitmentHex = null;
    if (child.ok === true) {
      program = require('./program').from({ language: 'fabric-opcodes', steps: Array.isArray(steps) ? steps : [] });
      const compiled = program.compile();
      if (compiled.ok) {
        programHash = program.programHash;
        runCommitmentHex = program.runCommitmentHex({ tip, stack: trace });
      }
    }
    return {
      ok: child.ok === true,
      stack: Array.isArray(child.stack) ? child.stack : [],
      tip,
      trace,
      runCommitmentHex,
      programHash,
      program,
      error: child.ok === true ? undefined : (child.error || 'isolate failed')
    };
  }

  /**
   * Run `fabric-opcodes` on a Worker thread with an empty opcode table.
   * Parent `define()` functions are not called. On Node this blocks. In a
   * browser it fails closed; await {@link Machine.runIsolatedOpcodesAsync}.
   * @param {Array} steps
   * @param {Object} [options]
   * @returns {Object}
   */
  static runIsolatedOpcodes (steps, options = {}) {
    const payload = Machine._opcodeIsolatePayload(steps, options);
    if (!Machine.nodeIsolate()) {
      return Machine._finishOpcodeIsolate(steps, {
        parsed: null,
        error: 'program isolate is async in the browser'
      });
    }
    return Machine._finishOpcodeIsolate(steps, Machine.spawnIsolate(payload, options));
  }

  /**
   * Browser-awaitable form of {@link Machine.runIsolatedOpcodes}.
   * @param {Array} steps
   * @param {Object} [options]
   * @returns {Promise.<Object>}
   */
  static runIsolatedOpcodesAsync (steps, options = {}) {
    const payload = Machine._opcodeIsolatePayload(steps, options);
    if (Machine.nodeIsolate()) {
      return Promise.resolve(Machine._finishOpcodeIsolate(steps, Machine.spawnIsolate(payload, options)));
    }
    return Machine.spawnIsolateAsync(payload, options).then(function (spawned) {
      return Machine._finishOpcodeIsolate(steps, spawned);
    });
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


}

Machine.ISOLATE_TIMEOUT_MS = 1000;

module.exports = Machine;

// Opcode interpreter for Machine.runPayload. The worker script is these
// functions' source. It is not a hardened virtual machine, and it does not
// evaluate caller JavaScript. attachPort runs only inside that script.
var ISOLATE_MAX_STEPS = 256;
var ISOLATE_MAX_STACK = 64;
var DEFAULT_MAX_DEPTH = 16;
var DEFAULT_MAX_TRACE = 512;
var OP_NAMES = {
  push: 'Push',
  pop: 'Pop',
  dup: 'Dup',
  add: 'ADD',
  fabricopcode: 'FabricOpcode',
  delegationsignrequest: 'DelegationSignRequest'
};

function rejectNonFinite (value) {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Error('non-finite number not allowed');
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) rejectNonFinite(value[i]);
    return;
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    for (let i = 0; i < keys.length; i++) rejectNonFinite(value[keys[i]]);
  }
}

function isolateClampInt (value, fallback, max) {
  var n = Number(value);
  if (!isFinite(n) || n <= 0) n = fallback;
  n = Math.floor(n);
  if (n < 1) n = 1;
  if (n > max) n = max;
  return n;
}

function isolateOpcodeAllowed (allowList, name) {
  if (!allowList || !allowList.length) return true;
  return allowList.indexOf(String(name || '')) !== -1;
}

function isolateNormalizeOpName (op) {
  var raw = String(op || '').replace(/^\s+|\s+$/g, '');
  if (!raw) return '';
  var mapped = OP_NAMES[raw.toLowerCase()];
  return mapped || raw;
}

function isolateAssertPlainJson (value, depth, maxDepth) {
  if (depth > maxDepth) throw new Error('value exceeds max nesting depth');
  if (value === null) return;
  var t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') {
    if (t === 'number' && !isFinite(value)) throw new Error('non-finite number not allowed');
    return;
  }
  if (t === 'bigint' || t === 'function' || t === 'symbol' || t === 'undefined') {
    throw new Error('unsupported value type in Push');
  }
  if (Array.isArray(value)) {
    for (var i = 0; i < value.length; i++) isolateAssertPlainJson(value[i], depth + 1, maxDepth);
    return;
  }
  if (t === 'object') {
    var proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) throw new Error('non-plain object in Push');
    var keys = Object.keys(value);
    for (var k = 0; k < keys.length; k++) isolateAssertPlainJson(value[keys[k]], depth + 1, maxDepth);
  }
}

function isolateFail (error, trace, stack) {
  return {
    ok: false,
    error: error,
    trace: trace || [],
    stack: stack ? stack.slice() : [],
    tip: null
  };
}

function isolateRunExecutionSteps (steps, options, host) {
  var opts = options && typeof options === 'object' ? options : {};
  var maxSteps = isolateClampInt(opts.maxSteps, ISOLATE_MAX_STEPS, 4096);
  var maxStack = isolateClampInt(opts.maxStack, ISOLATE_MAX_STACK, 256);
  var maxDepth = isolateClampInt(opts.maxDepth, DEFAULT_MAX_DEPTH, 64);
  var maxTrace = isolateClampInt(opts.maxTrace, DEFAULT_MAX_TRACE, 8192);
  var allowList = Array.isArray(opts.allowedOpcodes) ? opts.allowedOpcodes : [];
  if (!Array.isArray(steps)) {
    return isolateFail('program.steps must be an array', [], []);
  }
  if (steps.length > maxSteps) {
    return isolateFail('program exceeds maxSteps (' + maxSteps + ')', [], []);
  }

  var stack = [];
  var trace = [];
  if (Object.prototype.hasOwnProperty.call(opts, 'seedValue')) stack.push(opts.seedValue);

  function pushTrace (entry) {
    if (trace.length >= maxTrace) {
      if (trace.length === maxTrace) trace.push({ truncated: true });
      return;
    }
    trace.push(entry);
  }

  function defaultEntry (step) {
    var hasName = step.fabricType != null && String(step.fabricType).replace(/^\s+|\s+$/g, '') !== '';
    var name = hasName ? String(step.fabricType).replace(/^\s+|\s+$/g, '') : 'Unknown';
    var opcodeDec = step.fabricOpcode != null ? Number(step.fabricOpcode) : null;
    return {
      name: name,
      opcodeDec: opcodeDec != null && isFinite(opcodeDec) ? opcodeDec : null,
      stability: null,
      encoding: null,
      notes: null
    };
  }

  function resolveEntry (step) {
    if (opts.useResolvedEntries === true && step.resolved && typeof step.resolved === 'object') {
      return step.resolved;
    }
    if (host && typeof host.resolveFabricEntry === 'function') return host.resolveFabricEntry(step);
    return defaultEntry(step);
  }

  try {
    for (var i = 0; i < steps.length; i++) {
      var step = steps[i];
      if (!step || typeof step !== 'object') {
        return isolateFail('invalid step at index ' + i, trace, stack);
      }
      var op = isolateNormalizeOpName(step.op);
      if (op === 'Push') {
        if (!Object.prototype.hasOwnProperty.call(step, 'value')) throw new Error('Push requires value');
        isolateAssertPlainJson(step.value, 0, maxDepth);
        stack.push(step.value);
        pushTrace({ pc: i, op: 'Push' });
      } else if (op === 'Pop') {
        if (stack.length < 1) throw new Error('stack underflow');
        stack.pop();
        pushTrace({ pc: i, op: 'Pop' });
      } else if (op === 'Dup') {
        if (stack.length < 1) throw new Error('stack underflow');
        stack.push(stack[stack.length - 1]);
        pushTrace({ pc: i, op: 'Dup' });
      } else if (op === 'ADD') {
        if (stack.length < 2) throw new Error('stack underflow');
        var b = stack.pop();
        var a = stack.pop();
        if (typeof a !== 'number' || typeof b !== 'number' || !isFinite(a) || !isFinite(b)) {
          throw new Error('ADD requires two finite numbers');
        }
        stack.push(a + b);
        pushTrace({ pc: i, op: 'ADD' });
      } else if (op === 'FabricOpcode') {
        var entry = resolveEntry(step);
        if (!entry || typeof entry !== 'object') throw new Error('FabricOpcode unresolved');
        if (entry.name === 'Ping' || entry.name === 'Pong') {
          throw new Error(entry.name + ' is a transport keepalive, not an Execution program opcode');
        }
        if (!isolateOpcodeAllowed(allowList, entry.name)) {
          throw new Error('FabricOpcode "' + entry.name + '" not in primitives.opcodes allow-list');
        }
        stack.push({
          kind: 'fabric',
          name: entry.name,
          opcodeDec: entry.opcodeDec,
          stability: entry.stability,
          encoding: entry.encoding,
          notes: entry.notes
        });
        pushTrace({ pc: i, op: 'FabricOpcode', name: entry.name, opcodeDec: entry.opcodeDec });
      } else if (op === 'DelegationSignRequest') {
        if (!step.envelope || typeof step.envelope !== 'object') {
          throw new Error('DelegationSignRequest requires envelope object');
        }
        isolateAssertPlainJson(step.envelope, 0, maxDepth);
        stack.push({ kind: 'DelegationSignRequest', envelope: step.envelope });
        pushTrace({ pc: i, op: 'DelegationSignRequest' });
      } else {
        return isolateFail('unknown op "' + step.op + '" at index ' + i, trace, stack);
      }
      if (stack.length > maxStack) return isolateFail('stack overflow', trace, stack);
    }
    return {
      ok: true,
      stepsExecuted: steps.length,
      stack: stack.slice(),
      tip: stack.length ? stack[stack.length - 1] : null,
      trace: trace
    };
  } catch (err) {
    return isolateFail(err && err.message ? err.message : String(err), trace, stack);
  }
}

function isolateRunOpcodeSteps (payload) {
  var opts = payload && typeof payload === 'object' ? payload : {};
  var steps = Array.isArray(opts.steps) ? opts.steps : [];
  var maxSteps = isolateClampInt(opts.maxSteps, ISOLATE_MAX_STEPS, 4096);
  var maxStack = isolateClampInt(opts.maxStack, ISOLATE_MAX_STACK, 256);
  var allowList = Array.isArray(opts.allowedOpcodes) ? opts.allowedOpcodes : [];
  var stack = [];
  if (Object.prototype.hasOwnProperty.call(opts, 'seedValue')) stack.push(opts.seedValue);
  if (steps.length > maxSteps) {
    return isolateFail('program exceeds maxSteps (' + maxSteps + ')', [], stack);
  }
  try {
    for (var i = 0; i < steps.length; i++) {
      var name = String(steps[i] == null ? '' : steps[i]);
      if (allowList.length && !isolateOpcodeAllowed(allowList, name)) {
        throw new Error('opcode not in primitives.opcodes allow-list: ' + name);
      }
      if (allowList.length) {
        throw new Error('opcode not defined (fail closed under allow-list): ' + name);
      }
      throw new Error('opcode not defined: ' + name);
    }
    return {
      ok: true,
      stepsExecuted: steps.length,
      stack: stack.slice(),
      tip: stack.length ? stack[stack.length - 1] : null,
      trace: []
    };
  } catch (err) {
    return isolateFail(err && err.message ? err.message : String(err), [], stack);
  }
}

function isolateRunPayload (payload, host) {
  var body = payload && typeof payload === 'object' ? payload : {};
  if (body.kind === 'fabric-opcodes') return isolateRunOpcodeSteps(body);
  var steps = Array.isArray(body.steps)
    ? body.steps
    : (body.program && Array.isArray(body.program.steps) ? body.program.steps : null);
  return isolateRunExecutionSteps(steps, body.options || {}, host || null);
}

function isolateReplyTo (message, result) {
  if (message && message.port && typeof message.port.postMessage === 'function') {
    message.port.postMessage(result);
    return;
  }
  if (message && typeof message.reply === 'function') message.reply(result);
}

function isolateOnMessage (message, post) {
  var payload = message && typeof message === 'object' &&
    Object.prototype.hasOwnProperty.call(message, 'payload')
    ? message.payload
    : message;
  var result;
  try {
    result = isolateRunPayload(payload);
  } catch (err) {
    result = isolateFail(err && err.message ? err.message : String(err), [], []);
  }
  if (typeof post === 'function') post(result);
  else isolateReplyTo(message, result);
}

function isolateAttachPort () {
  var parentPort = null;
  try {
    if (typeof require === 'function') parentPort = require('worker_threads').parentPort;
  } catch (err) {
    parentPort = null;
  }
  if (parentPort) {
    parentPort.on('message', function (message) {
      isolateOnMessage(message, function (result) {
        isolateReplyTo(message, result);
        if (!(message && message.port)) parentPort.postMessage(result);
      });
    });
    return;
  }
  var scope = typeof self !== 'undefined' ? self : null;
  if (scope && typeof scope.postMessage === 'function' && typeof window === 'undefined') {
    scope.onmessage = function (event) {
      var data = event && event.data;
      isolateOnMessage(data, function (result) {
        scope.postMessage(result);
      });
    };
  }
}

Machine.runPayload = isolateRunPayload;
