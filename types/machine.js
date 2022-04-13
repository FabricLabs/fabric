'use strict'; // commit (.) and continue (,) ⇒ ;

// Constants
const {
  MACHINE_MAX_MEMORY
} = require('../constants');

// Dependencies
const arbitrary = require('arbitrary');
const monitor = require('fast-json-patch');
const BN = require('bn.js');

// Fabric Types
const Hash256 = require('./hash256');
const Actor = require('./actor');
const State = require('./state');

/**
 * General-purpose state machine with {@link Vector}-based instructions.
 */
class Machine extends Actor {
  /**
   * Create a Machine.
   * @param       {Object} settings Run-time configuration.
   */
  constructor (settings) {
    super(settings);

    this.settings = Object.assign({
      path: './stores/machine',
      clock: 0,
      debug: false,
      deterministic: true,
      frequency: 1, // Hz
      seed: 1, // TODO: select seed for production
      states: {}
    }, settings);

    // internal clock
    this.clock = this.settings.clock;

    // define integer field
    this.seed = Hash256.digest(this.settings.seed + '');
    this.q = parseInt(this.seed.substring(0, 4), 16);

    // deterministic entropy and RNG
    this.generator = new arbitrary.default.Generator(this.q);
    this.entropy = this.sip();

    this.known = {}; // definitions
    this.script = []; // input
    this.stack = []; // output
    this.history = []; // State tree

    // Tip
    Object.defineProperty(this, 'tip', function (val) {
      this.log(`tip requested: ${val}`);
      this.log(`tip requested, history: ${JSON.stringify(this.history)}`);
      return this.history[this.history.length - 1] || null;
    });

    return this;
  }

  bit () {
    return this.generator.next.bits(1);
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

  /**
   * Computes the next "step" for our current Vector.  Analagous to `sum`.
   * The top item on the stack is always the memory held at current position,
   * so counts should always begin with 0.
   * @param  {Vector} input - Input state, undefined if desired.
   * @return {Promise}
   */
  async compute (input) {
    ++this.clock;

    this.emit('tick', this.clock);

    for (const i in this.script) {
      const instruction = this.script[i];

      if (this.known[instruction]) {
        const op = new State({
          '@type': 'Cycle',
          parent: this.id,
          state: this.state,
          known: this.known,
          input: input
        });
        const data = this.known[instruction].call(op, input);
        this.stack.push(data);
      } else {
        this.stack.push(instruction | 0);
      }
    }

    if (this.stack.length > 1) {
      this.warn('Stack is dirty:', this.stack);
    }

    this.state['@data'] = this.stack;
    this.state['@id'] = this.id;

    this.commit();

    return this.state;
  }

  asBuffer () {
    const data = this.serialize(this.state['@data']);
    return Buffer.from(data);
  }

  // register a local function
  define (name, op) {
    this.known[name] = op.bind(this);
  }

  applyOperation (op) {
    monitor.applyOperation(this.state, op);
  }

  commit () {
    const self = this;
    if (!self.observer) return false;

    const changes = monitor.generate(self.observer);

    if (changes && changes.length) {
      const vector = new State({
        '@type': 'Change',
        '@data': changes,
        method: 'patch',
        parent: self.id,
        params: changes
      });

      if (!self.history) self.history = [];
      self.history.push(vector);

      self.emit('transaction', vector);
    }

    return changes;
  }

  async start () {
    this.status = 'STARTING';
    this._governor = setInterval(
      this.compute.bind(this),
      this.settings.frequency * 1000
    );
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
