'use strict';

// Convenience bindings for JavaScript
const EventEmitter = require('events').EventEmitter;

// Dependencies
const BN = require('bn.js');
// const monitor = require('fast-json-patch');

// Fabric types
const Entity = require('./entity');
const Circuit = require('./circuit');
const Message = require('./message');
const State = require('./state');
const Machine = require('./machine');
const Secret = require('./secret');

/**
 * Interfaces compile abstract contract code into {@link Chain}-executable transactions, or "chaincode". For example, the "Bitcoin" interface might compile a Swap contract into Script, preparing a valid Bitcoin transaction for broadcast which executes the swap contract.
 * @extends EventEmitter
 * @property {String} status Human-friendly value representing the Interface's current {@link State}.
 */
class Interface extends EventEmitter {
  /**
   * Define an {@link Interface} by creating an instance of this class.
   * @param {Object} settings Configuration values.
   * @return {Interface}      Instance of the {@link Interface}.
   */
  constructor (settings = {}) {
    super(settings);

    this.clock = new BN();
    this.identity = new BN(1);
    this.tags = ['pre-release'];
    this.settings = Object.assign({
      prefix: '/',
      script: '(1)',
      type: 'miniscript'
    }, settings);

    // define singletons
    // TODO: remove these... ~E
    this.circuit = new Circuit(this.settings);
    this.machine = new Machine(this.settings);
    this.secret = new Secret(this.settings);

    // internal state
    this._state = new State();
    this.status = 'initialized';

    // Bind {@link Message} handler
    this._state.on('changes', this._handleStateChange.bind(this));

    // ensure chain-ability
    return this;
  }

  get status () {
    return this._state.get(`/status`);
  }

  set status (value = this.status) {
    return this._state.set(`/status`, value);
  }

  /**
   * Getter for {@link State}.
   */
  get state () {
    // TODO: remove old use of `@data` while internal to Fabric
    return this._state['@data'];
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
    this.clock.add(this.identity);
    this.emit('message', Message.fromVector(['Cycle', Buffer.from(val)]));
    return this;
  }

  async _handleStateChange (change) {
    this.log('[FABRIC:INTERFACE]', 'Received State change:', change);
    let data = JSON.stringify({ changes: change });
    this.emit('message', Message.fromVector(['Transaction', data]));
    return 1;
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
}

module.exports = Interface;
