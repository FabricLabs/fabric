'use strict';

// Dependencies
const crypto = require('crypto');
const { EventEmitter } = require('events');
const monitor = require('fast-json-patch');

// Fabric Types
const Hash256 = require('./hash256');

/**
 * Used to hold internal state for each object
 *
 * Since JavaScript does not have the notion of true private fields, we use a
 * WeakMap to hold the internal state of instances, using `this` as the key. The
 * use of WeakMap instead of Map ensure that instances can be garbage-collected
 * even when they are used as keys in the WeakMap.
 *
 * @type {WeakMap}
 */
const STATE = new WeakMap();

/**
 * Normalizes a state object by re-arranging its keys in alphabetical order
 *
 * @param {Object} state The state to be normalized
 * @returns {Object} The normalized state object
 */
function normalizeState (state) {
  return Object.keys(state)
    .sort()
    .reduce((obj, key) => {
      obj[key] = state[key];
      return obj;
    }, {});
}

/**
 * Parses a state object from the provided input and normalizes it
 *
 * @param {String|Buffer|Object} input The input to parse
 * @returns {Object} The normalized state object
 */
function parseState (input) {
  let state;

  if (typeof input === 'string') {
    state = {
      type: 'String',
      size: input.length,
      content: input,
      encoding: 'utf8'
    };
  } else if (input instanceof Buffer) {
    state = {
      type: 'Buffer',
      size: input.length,
      content: input.toString('hex'),
      encoding: 'hex'
    };
  } else {
    state = Object.assign({}, input);
  }

  return normalizeState(state);
}

/**
 * Generic Fabric Actor.
 * @access protected
 * @emits message Fabric {@link Message} objects.
 * @property {String} id Unique identifier for this Actor (id === SHA256(preimage)).
 * @property {String} preimage Input hash for the `id` property (preimage === SHA256(ActorState)).
 */
class Actor extends EventEmitter {
  /**
   * Creates an {@link Actor}, which emits messages that can be subscribed to by
   * other Actors
   *
   * @param {Object} [actor] Object to use as the actor
   * @param {String} [actor.seed] BIP24 Mnemonic to use as a seed phrase
   * @param {Buffer} [actor.public] Public key
   * @param {Buffer} [actor.private] Private key
   * @returns {Actor} Instance of the Actor. Call {@link Actor#sign} to emit a
   * {@link Signature}.
   */
  constructor (actor = {}) {
    super(actor);

    const value = parseState(actor);
    const state = {
      history: [],
      // signature: Buffer.alloc(64),
      state: {
        type: 'Actor',
        data: value,
        status: 'PAUSED',
        content: value || {}
      }
    };

    STATE.set(this, state);

    this.observer = monitor.observe(state.content, (...args) => this._handleMonitorChanges(...args));

    // Chainable
    return this;
  }

  /**
   * Parses a JSON object from a string
   * @param {String} str A string representation of a JSON object
   * @returns {Object}
   */
  static fromString (str) {
    if (typeof str !== 'string') {
      throw new Error(`Expected a string; got ${typeof str}!`);
    } else if (str.length <= 0) {
      throw new Error(`Got a string with length ${str.length}!`);
    }

    let obj;

    try {
      obj = JSON.parse(str);
    } catch (err) {
      obj = null;
    }

    return obj;
  }

  /**
   * Converts a JSON object to a string
   * @param {Object} obj The JSON object to be converted into a string
   * @returns {Object} An object parsed from the string or describing an error
   */
  static toJSON (obj) {
    let json = null;

    try {
      json = JSON.stringify(obj, null, '  ');
    } catch (err) {
      json = JSON.stringify({ content: err, type: 'Error' }, null, '  ');
    }

    return json;
  }

  static randomBytes (count = 32) {
    return crypto.randomBytes(count);
  }

  /**
   * Returns the unique identifier of the actor
   *
   * @returns {String} A hexadecimal string
   */
  get id () {
    const buffer = Buffer.from(this.preimage, 'hex');
    return Hash256.digest(buffer);
  }

  get preimage () {
    const input = {
      type: 'FabricActorState',
      object: this.toObject()
    };

    const string = JSON.stringify(input, null, '  ');
    const buffer = Buffer.from(string, 'utf8');

    return Hash256.digest(buffer);
  }

  get state () {
    return Object.assign({}, this._state.content);
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
   * Returns the Actor's current state as an {@link Object}.
   * @returns {Object}
   */
  toObject () {
    return _sortKeys(this.state);
  }

  /**
   * Returns the Actor's current state as a JSON string
   * @returns {String}
   */
  toJSON () {
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

  /**
   * Casts the Actor to a normalized Buffer.
   * @returns {Buffer}
   */
  toBuffer () {
    return Buffer.from(this.serialize(), 'utf8');
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
   * Resolve the current state to a commitment.
   * @emits Actor Current malleable state.
   * @returns {String} 32-byte ID
   */
  commit () {
    const state = new Actor(this._state.content);
    const commit = new Actor({
      state: state.id
    });

    this.history.push(commit);
    this.emit('commit', commit);
    return commit.id;
  }

  debug (...params) {
    this.emit('debug', params);
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
    this.commit();

    return this;
  }

  pause () {
    this.status = 'PAUSING';
    this.commit();
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
   * @
   * @returns {Actor}
   */
  unpause () {
    this.status = 'UNPAUSING';
    this.commit();
    this.status = 'UNPAUSED';
    return this;
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
    console.log('got monitor changes from actor:', changes);
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

/**
 * Export the Actor class
 * @type {Actor}
 */
module.exports = Actor;
