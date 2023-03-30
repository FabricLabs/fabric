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

/**
 * General-purpose state machine with {@link Vector}-based instructions.
 */
class Machine extends Actor {
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
      precision: 8,
      script: [],
      seed: 1, // TODO: select seed for production
      type: 'fabric'
    }, settings);

    // machine key
    this.key = new Key({
      seed: this.settings.seed + '', // casts to string
      xprv: this.settings.xprv,
      private: this.settings.private,
    });

    // internal clock
    this.clock = this.settings.clock;

    // deterministic entropy and RNG
    this.entropy = this.sip();
    this.memory = Buffer.alloc(MACHINE_MAX_MEMORY);

    this.known = {}; // definitions
    this.stack = []; // output
    this.history = []; // State tree

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
    this.log(`tip requested: ${val}`);
    this.log(`tip requested, history: ${JSON.stringify(this.history)}`);
    return this.history[this.history.length - 1] || null;
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

  validateCycle (i) {
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

    for (const i in this.script) {
      const instruction = this.script[i];
      const method = this.known[instruction];

      if (method) {
        const data = method.call(this.state, input);
        this.stack.push(data);
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
  define (name, op) {
    this.known[name] = op.bind(this.state);
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
    this._governor = setInterval(this.compute.bind(this), this.settings.frequency * 1000);
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
