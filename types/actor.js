'use strict';

// Dependencies
const crypto = require('crypto');
const { EventEmitter } = require('events');

const monitor = require('fast-json-patch');
const pointer = require('json-pointer');

// Fabric Types
const Hash256 = require('./hash256');

// Fabric Functions
const _sortKeys = require('../functions/_sortKeys');

/**
 * Generic Fabric Actor.
 * @access protected
 * @emits message Fabric {@link Message} objects.
 * @property {String} id Unique identifier for this Actor (id === SHA256(preimage)).
 * @property {String} preimage Input hash for the `id` property (preimage === SHA256(ActorState)).
 */
class Actor extends EventEmitter {
  /**
   * Creates an {@link Actor}, which emits messages for other
   * Actors to subscribe to.  You can supply certain parameters
   * for the actor, including key material [!!!] — be mindful of
   * what you share with others!
   * @param {Object} [actor] Object to use as the actor.
   * @param {String} [actor.seed] BIP24 Mnemonic to use as a seed phrase.
   * @param {Buffer} [actor.public] Public key.
   * @param {Buffer} [actor.private] Private key.
   * @returns {Actor} Instance of the Actor.  Call {@link Actor#sign} to emit a {@link Signature}.
   */
  constructor (actor = {}) {
    super(actor);

    this.settings = {
      type: 'Actor',
      status: 'PAUSED'
    };

    // Internal State
    // TODO: encourage use of `state` over `_state`
    // TODO: use `const state` here
    this._state = {
      type: this.settings.type,
      status: this.settings.status,
      content: this._readObject(actor)
    };

    // TODO: evaluate disabling by default
    this.history = [];

    // TODO: evaluate disabling by default
    // and/or resolving performance issues at scale
    try {
      this.observer = monitor.observe(this._state.content, this._handleMonitorChanges.bind(this));
    } catch (exception) {
      console.error('UNABLE TO WATCH:', exception);
    }

    // TODO: use elegant method to strip these properties
    Object.defineProperty(this, '_events', { enumerable: false });
    Object.defineProperty(this, '_eventsCount', { enumerable: false });
    Object.defineProperty(this, '_maxListeners', { enumerable: false });
    Object.defineProperty(this, '_state', { enumerable: false });
    Object.defineProperty(this, 'observer', { enumerable: false });

    // Chainable
    return this;
  }

  /**
   * Create an {@link Actor} from a variety of formats.
   * @param {Object} input Target {@link Object} to create.
   * @returns {Actor} Instance of the {@link Actor}.
   */
  static fromAny (input = {}) {
    let state = null;

    if (typeof input === 'string') {
      state = { content: input };
    } else if (input instanceof Buffer) {
      state = { content: input.toString('hex') };
    } else {
      state = Object.assign({}, input);
    }

    return new Actor(state);
  }

  static fromJSON (input) {
    let result = null;

    if (typeof input === 'string' && input.length) {
      console.log('trying to parse as JSON:', input);
      try {
        result = JSON.parse(input);
      } catch (E) {
        console.error('Failure in fromJSON:', E);
      }
    } else {
      console.trace('Invalid input:', typeof input);
    }

    return result;
  }

  /**
   * Get a number of random bytes from the runtime environment.
   * @param {Number} [count=32] Number of random bytes to retrieve.
   * @returns {Buffer} The random bytes.
   */
  static randomBytes (count = 32) {
    return crypto.randomBytes(count);
  }

  get id () {
    const buffer = Buffer.from(this.preimage, 'hex');
    return Hash256.digest(buffer);
  }

  get generic () {
    return this.toGenericMessage();
  }

  get preimage () {
    const string = JSON.stringify(this.generic, null, '  ');
    const secret = Buffer.from(string, 'utf8');
    const preimage = Hash256.digest(secret);
    return preimage;
  }

  get state () {
    return JSON.parse(JSON.stringify(this._state.content || {}));
  }

  get status () {
    return this._state.status;
  }

  get type () {
    return this._state['@type'];
  }

  set state (value) {
    this._state.content = value;
  }

  set status (value) {
    this._state.status = value;
  }

  /**
   * Explicitly adopt a set of {@link JSONPatch}-encoded changes.
   * @param {Array} changes List of {@link JSONPatch} operations to apply.
   * @returns {Actor} Instance of the Actor.
   */
  adopt (changes) {
    try {
      monitor.applyPatch(this._state.content, changes);
      this.commit();
    } catch (exception) {
      this.emit('error', exception);
    }

    return this;
  }

  /**
   * Resolve the current state to a commitment.
   * @returns {String} 32-byte ID
   */
  commit () {
    const state = new Actor(this.state);
    const changes = monitor.generate(this.observer);
    const parent = (this.history.length) ? this.history[this.history.length - 1].state : null;
    const commit = new Actor({
      changes: changes,
      parent: parent,
      state: state.id // TODO: include whole state?
    });

    this.history.push(commit);
    this.emit('commit', commit);
    return commit.id;
  }

  debug (...params) {
    this.emit('debug', params);
  }

  /**
   * Export the Actor's state to a standard {@link Object}.
   * @returns {Object} Standard object.
   */
  export () {
    return {
      id: this.id,
      type: 'FabricActor',
      object: this.state,
      version: 1
    };
  }

  /**
   * Retrieve a value from the Actor's state by {@link JSONPointer} path.
   * @param {String} path Path to retrieve using {@link JSONPointer}.
   * @returns {Object} Value of the path in the Actor's state.
   */
  get (path) {
    return pointer.get(this._state.content, path);
  }

  log (...params) {
    this.emit('log', ...params);
  }

  mutate (seed) {
    if (seed === 0 || !seed) seed = this.randomBytes(32).toString('hex');

    const patches = [
      { op: 'replace', path: '/seed', value: seed }
    ];

    monitor.applyPatch(this._state.content, patches);
    console.log('new state:', this._state.content);
    this.commit();

    return this;
  }

  /**
   * Set a value in the Actor's state by {@link JSONPointer} path.
   * @param {String} path Path to set using {@link JSONPointer}.
   * @param {Object} value Value to set.
   * @returns {Object} Value of the path in the Actor's state.
   */
  set (path, value) {
    pointer.set(this._state.content, path, value);
    this.commit();
    return this;
  }

  setStatus (value) {
    if (!value) throw new Error('Cannot remove status.');
    this.status = value;
  }

  /**
   * Casts the Actor to a normalized Buffer.
   * @returns {Buffer}
   */
  toBuffer () {
    return Buffer.from(this.serialize(), 'utf8');
  }

  /**
   * Casts the Actor to a generic message.
   * @returns {Object} Generic message object.
   */
  toGenericMessage () {
    return {
      type: 'FabricActorState',
      object: this.toObject()
    };
  }

  /**
   * Returns the Actor's current state as an {@link Object}.
   * @returns {Object}
   */
  toObject () {
    return _sortKeys(this.state);
  }

  toString (format = 'json') {
    switch (format) {
      case 'hex':
        return Buffer.from(this.serialize(), 'utf8').toString('hex');
      case 'json':
      default:
        return this.serialize();
    }
  }

  /**
   * Toggles `status` property to paused.
   * @returns {Actor} Instance of the Actor.
   */
  pause () {
    this.status = 'PAUSING';
    this.commit();
    this.status = 'PAUSED';
    return this;
  }

  randomBytes (count = 32) {
    return crypto.randomBytes(count);
  }

  /**
   * Serialize the Actor's current state into a JSON-formatted string.
   * @returns {String}
   */
  serialize () {
    let json = null;

    try {
      json = JSON.stringify(this.toObject(), null, '  ');
    } catch (exception) {
      json = JSON.stringify({
        type: 'Error',
        content: `Exception serializing: ${exception}`
      }, null, '  ');
    }

    return json;
  }

  sha256 (value) {
    return Hash256.digest(value);
  }

  /**
   * Signs the Actor.
   * @returns {Actor}
   */
  sign () {
    throw new Error('Unimplemented on this branch.  Use @fabric/core/types/signer instead.');
    /* this.signature = this.key._sign(this.toBuffer());
    this.emit('signature', this.signature);
    return this; */
  }

  /**
   * Toggles `status` property to unpaused.
   * @returns {Actor} Instance of the Actor.
   */
  unpause () {
    this.status = 'UNPAUSING';
    this.commit();
    this.status = 'UNPAUSED';
    return this;
  }

  /**
   * Get the inner value of the Actor with an optional cast type.
   * @param {String} [format] Cast the value to one of: `buffer, hex, json, string`
   * @returns {Object} Inner value of the Actor as an {@link Object}, or cast to the requested `format`.
   */
  value (format = 'object') {
    switch (format) {
      default:
        return this.state;
      case 'buffer':
        return Buffer.from(this.value('string'), 'utf8');
      case 'hex':
        return this.value('buffer').toString('hex');
      case 'json':
      case 'string':
        return JSON.stringify(this.state);
    }
  }

  _getField (name) {
    return this._state.content[name];
  }

  /**
   * Incurs 1 SYSCALL
   * @access private
   * @returns {Object}
   */
  _getState () {
    return this.state;
  }

  _handleMonitorChanges (changes) {
    // TODO: emit global state event here
    // after verify, commit
  }

  /**
   * Parse an Object into a corresponding Fabric state.
   * @param {Object} input Object to read as input.
   * @returns {Object} Fabric state.
   */
  _readObject (input = {}) {
    let state = {};

    if (typeof input === 'string') {
      state = Object.assign(state, {
        type: 'String',
        size: input.length,
        content: input,
        encoding: 'utf8'
      });
    } else if (input instanceof Buffer) {
      state = Object.assign(state, {
        type: 'Buffer',
        size: input.length,
        content: input.toString('hex'),
        encoding: 'hex'
      });
    } else {
      state = Object.assign(state, input);
    }

    return state;
  }
}

module.exports = Actor;
