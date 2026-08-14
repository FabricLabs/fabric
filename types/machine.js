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

// Strict JSON
const { parsePersistedJson } = require('../functions/wireJson');

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
      // Opcode allow-list. Null or empty = unrestricted (legacy soft compute).
      allowedOpcodes: null
    }, settings);

    // machine key
    this.key = new Key(this.settings.key);

    // internal clock
    this.clock = this.settings.clock;

    // deterministic entropy and RNG
    this.entropy = this.sip();
    this.memory = Buffer.alloc(MACHINE_MAX_MEMORY);

    this.known = {}; // definitions
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
   * Active opcode allow-list (empty = unrestricted).
   * @returns {string[]}
   */
  get allowedOpcodes () {
    return this._allowedOpcodes.slice();
  }

  /**
   * Restrict `define` / `loadProgram` / `compute` to this opcode set.
   * Empty / null clears the restriction (legacy soft unknown-op behavior).
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
  async compute (input) {
    ++this.clock;

    this.emit('tick', this.clock);

    const allow = this._allowedOpcodes;
    const restricted = allow && allow.length > 0;

    for (const i in this.script) {
      const instruction = this.script[i];
      const name = String(instruction == null ? '' : instruction);
      if (restricted && !opcodeAllowed(allow, name)) {
        throw new Error(`opcode not in primitives.opcodes allow-list: ${name}`);
      }
      const method = this.known[instruction];

      if (method) {
        const data = method.call(this.state, input);
        this.stack.push(data);
      } else if (restricted) {
        throw new Error(`opcode not defined (fail closed under allow-list): ${name}`);
      } else {
        this.stack.push(instruction | 0);
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
   * keys must be listed — fail closed.
   * @param {Program|object} program
   * @param {Object} [opts]
   * @param {Object} [opts.genesis] ARC genesis; may supply `primitives.opcodes` allow-list
   * @returns {Machine}
   */
  loadProgram (program, opts = {}) {
    const Program = require('./program');
    const prog = program instanceof Program ? program : Program.from(program || {});
    const compiled = prog.compile();
    if (!compiled.ok) {
      throw new Error(compiled.error || 'program compile failed');
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
      for (const [name, fn] of Object.entries(prog.source)) {
        if (typeof fn === 'function') this.define(name, fn);
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
      if (prog.language === 'fabric-execution') {
        const {
          runExecutionProgram
        } = require('../functions/executionProgramRunner');
        if (opts.genesis) this.applyGenesisOpcodes(opts.genesis);
        const src = prog.settings.source && typeof prog.settings.source === 'object'
          ? prog.settings.source
          : program;
        const result = runExecutionProgram(src, Object.assign({}, opts, {
          machine: this,
          allowedOpcodes: this._allowedOpcodes
        }));
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
      await this.compute(input);
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
    this._governor = setInterval(this.compute.bind(this), ms);
    this.status = 'STARTED';
    return this;
  }

  async stop () {
    this.status = 'STOPPING';
    if (this._governor) clearInterval(this._governor);
    this.status = 'STOPPED';
    return this;
  }
}

module.exports = Machine;
