'use strict'; // commit (.) and continue (,) ⇒ ;

const monitor = require('fast-json-patch');

const Scribe = require('./scribe');
const State = require('./state');
const Vector = require('./vector');

/**
 * General-purpose state machine with {@link Vector}-based instructions.
 */
class Machine extends Scribe {
  /**
   * Create a Machine.
   * @param       {Object} config Run-time configuration.
   */
  constructor (config) {
    super(config);

    this.config = Object.assign({
      path: './data/machine',
      debug: true
    }, config);

    this.clock = 0;

    this.known = {}; // definitions
    this.script = []; // input
    this.stack = []; // output

    this.state = new State(); // JS map
    this.history = []; // State tree

    this.observer = monitor.observe(this.state['@data']);
    this.vector = new Vector(this.state['@data']);

    return this;
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

    for (let i in this.script) {
      let instruction = this.script[i];

      if (this.known[instruction]) {
        let op = new State({
          '@type': 'Cycle',
          parent: this.id,
          state: this.state,
          known: this.known,
          input: input
        });
        let data = this.known[instruction].call(op, input);
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

    let commit = await this.commit();
    let state = await this.state.commit();

    return state;
  }

  asBuffer () {
    let data = this.serialize(this.state['@data']);
    return Buffer.from(data);
  }

  // register a local function
  define (name, op) {
    this.known[name] = op.bind(this);
  }

  commit () {
    let self = this;
    let changes = monitor.generate(self.observer);

    if (changes.length) {
      let vector = new State({
        '@type': 'Change',
        '@data': changes,
        method: 'patch',
        parent: self.id,
        params: changes
      });

      self.history.push(vector);

      self.emit('transaction', vector);
    }

    return changes;
  }
}

Machine.prototype.applyOperation = function (op) {
  monitor.applyOperation(this.state, op);
};

Object.defineProperty(Machine.prototype, 'tip', function (val) {
  this.log(`tip requested: ${val}`);
  this.log(`tip requested, history: ${JSON.stringify(this.history)}`);
  return this.history[this.history.length - 1] || null;
});

module.exports = Machine;
