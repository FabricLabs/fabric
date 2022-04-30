'use strict';

// Dependencies
const BN = require('bn.js');
const merge = require('lodash.merge');
// const monitor = require('fast-json-patch');

// Fabric types
const Entity = require('./entity');
const Circuit = require('./circuit');
const Message = require('./message');
const State = require('./state');
const Machine = require('./machine');
const Secret = require('./secret');
const Service = require('./service');

/**
 * Interfaces compile abstract contract code into {@link Chain}-executable transactions, or "chaincode". For example, the "Bitcoin" interface might compile a Swap contract into Script, preparing a valid Bitcoin transaction for broadcast which executes the swap contract.
 * @augments EventEmitter
 * @property {String} status Human-friendly value representing the Interface's current {@link State}.
 */
class Interface extends Service {
  /**
   * Define an {@link Interface} by creating an instance of this class.
   * @param {Object} settings Configuration values.
   * @return {Interface}      Instance of the {@link Interface}.
   */
  constructor (settings = {}) {
    super(settings);

    this.ticker = new BN();
    this.identity = new BN(1);
    this.tags = ['pre-release'];
    this.settings = merge({
      prefix: '/',
      script: '(1)',
      type: 'javascript'
    }, settings);

    // define singletons
    // TODO: remove these... ~E
    this.circuit = new Circuit(this.settings);
    this.machine = new Machine(this.settings);
    this.secret = new Secret(this.settings);

    // Shared State
    // TODO: use Layer
    this.memory = Buffer.alloc(4096);
    this.pointers = {}; // Map of addresses -> pointers

    // internal state
    this._state = new State(settings);
    this.status = 'initialized';

    // Bind {@link Message} handler
    this._state.on('changes', this._handleStateChange.bind(this));

    // ensure chain-ability
    return this;
  }

  get status () {
    return this._state.get('/status');
  }

  set status (value = this.status) {
    return this._state.set('/status', value);
  }

  shared (count = 1) {
    const data = new Entity(this.memory);
    const id = data.id;

    this.pointers[0] = id;
    this.memory.writeUInt8(id);

    return id;
  }

  writeTo (position, data) {
    const entity = new Entity(data);
    // console.log('writing', entity.id, ':', entity.data, 'to', position, '...');

    if (entity.id.length > this.memory.length) throw new Error('Insufficient memory.');

    for (let i = 0; i < entity.id.length; i++) {
      this.memory.writeUInt8(entity.id[i], position + i);
    }

    this.commit();

    return this.shared();
  }

  commit () {
    const entity = new Entity(this._state);
    const solution = merge({}, entity.data, {
      // TODO: document why @input is removed
      '@input': null,
      '@data': null,
      '@entity': null
    });

    delete solution['@input'];
    delete solution['@data'];
    delete solution['@entity'];
    delete solution['@preimage'];
    delete solution['observer'];

    const state = new Entity(solution.state);
    solution.state = state.id;

    const vector = JSON.stringify(solution, null, '  ');
    const commit = {
      '@type': 'Commit',
      '@data': vector.id,
      '@solution': vector
    };

    this.emit('commit', commit);

    return commit;
  }

  /**
   * Log some output to the console.
   * @param  {...any} inputs Components of the message to long.  Can be a single {@link} String, many {@link String} objects, or anything else.
   */
  log (...inputs) {
    const now = this.now();

    inputs.unshift(`[${this.constructor.name.toUpperCase()}]`);
    inputs.unshift(`[${now}]`);

    if (this.settings.verbosity >= 3) {
      console.log.apply(null, this.tags.concat(inputs));
    }

    return this.emit('info', this.tags.concat(inputs));
  }

  /**
   * Returns current timestamp.
   * @returns {Number}
   */
  now () {
    return new Date().getTime();
  }

  async patch (transaction) {
    // TODO: apply `transaction.operations` to Interface state
    await this.state._applyChanges(transaction.operations);
    return this;
  }

  /** Start the {@link Interface}.
   */
  async start () {
    this.cycle('start');
    this.status = 'starting';
    await this.machine.start();
    this.status = 'started';
    this.emit('ready', { name: this.settings.name });
    return this;
  }

  /** Stop the Interface. */
  async stop () {
    this.cycle('stop');
    this.status = 'stopping';
    await this.machine.stop();
    this.status = 'stopped';
    return this;
  }

  /**
   * Ticks the clock with a named {@link Cycle}.
   * @param {String} val Name of cycle to scribe.
   */
  async cycle (val) {
    if (typeof val !== 'string') throw new Error('Input must be a {@link String} object.');
    this.ticker.add(this.identity);
    this.emit('cycle', val);
    return this;
  }

  async _handleStateChange (change) {
    this.log('[FABRIC:INTERFACE]', 'Received State change:', change);
    let data = JSON.stringify({ changes: change });
    this.emit('transaction', Message.fromVector(['Transaction', data]));
    return 1;
  }
}

module.exports = Interface;
