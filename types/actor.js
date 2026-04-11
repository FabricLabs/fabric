'use strict';

/**
 * @fileoverview Base <strong>Actor</strong> type for Fabric: JSON-shaped state, JSON Patch commits, and a
 * content-derived <strong>id</strong>.
 *
 * <p><strong>State</strong> — <code>_state.content</code> is observed with <code>fast-json-patch</code>.
 * {@link Actor#commit} turns observer diffs into {@link Actor#history} entries and emits <code>commit</code> plus
 * <code>message</code> with <code>type: 'ActorMessage'</code> / <code>data.type: 'Changes'</code>.</p>
 *
 * <p><strong>Identity</strong> — {@link Actor#id} is a SHA256 digest (hex) of the 32-byte preimage buffer;
 * {@link Actor#preimage} is SHA256(UTF-8) of the pretty-printed {@link Actor#toGenericMessage}
 * <code>{ type, object }</code> with sorted keys ({@link Actor#toObject}). Implementation uses {@link Hash256.compute}.
 * Treat <code>id</code> as a <strong>content address</strong> for that state shape, not an arbitrary application string hash.</p>
 *
 * <p><strong>Relationship to {@link Message}</strong> — <code>Message</code> extends <code>Actor</code> and implements
 * <strong>AMP</strong> (wire headers, opcodes, Schnorr <code>Fabric/Message</code>). Downstream apps that only need a stable
 * storage key should not label that key <code>Actor#id</code> unless it is produced by this type.</p>
 *
 * <p>Narrative docs: <strong>DEVELOPERS.md</strong> (section <em>Actor and Message</em>) and this file’s class JSDoc are
 * kept in sync; <code>npm run make:docs</code> embeds DEVELOPERS.md as the HTML home page, while Actor.html is generated
 * from here.</p>
 */

// Generics
const EventEmitter = require('events');
// const stream = require('node:stream/promises');

// Dependencies
const monitor = require('fast-json-patch');
const pointer = require('json-pointer');

// Fabric Types
const Hash256 = require('./hash256');

// Fabric Functions
const _sortKeys = require('../functions/_sortKeys');
const { tryParsePersistedJson } = require('../functions/wireJson');

/**
 * @classdesc Base <strong>Actor</strong>: JSON-shaped <code>_state.content</code> observed with
 * <code>fast-json-patch</code>; {@link Actor#commit} turns diffs into {@link Actor#history} and emits
 * <code>commit</code> plus <code>message</code> (<code>type: 'ActorMessage'</code>, <code>data.type: 'Changes'</code>).
 * <strong>Identity</strong> — {@link Actor#id} is SHA256(hex) of the 32-byte preimage buffer; {@link Actor#preimage} is
 * SHA256(UTF-8) of pretty-printed {@link Actor#toGenericMessage} <code>{ type, object }</code> with sorted keys
 * ({@link Actor#toObject}); uses {@link Hash256.compute}. Treat <code>id</code> as a <strong>content address</strong>, not an
 * arbitrary app string hash. <strong>Wire traffic</strong> — see {@link Message} (extends Actor, AMP). Same narrative as
 * <strong>DEVELOPERS.md</strong> (<em>Actor and Message</em>) and <code>@fileoverview</code> above (also on
 * <code>types_actor.js.html</code> source page).
 * @class Actor
 * @extends EventEmitter
 * @access protected
 * @fires Actor#commit
 * @emits message Emits structured objects; on {@link Actor#commit}, <code>type: 'ActorMessage'</code> with patch metadata (not necessarily a {@link Message} AMP instance).
 * @property {String} id 64-char hex: SHA256 of the 32-byte digest represented by {@link Actor#preimage}.
 * @property {String} preimage 64-char hex: SHA256 of UTF-8 pretty JSON of {@link Actor#toGenericMessage}.
 */
class Actor extends EventEmitter {
  /**
   * Creates an {@link Actor}, which emits messages for other
   * Actors to subscribe to.  You can supply certain parameters
   * for the actor, including key material [!!!] — be mindful of
   * what you share with others!
   * @param {Object} [actor] Object to use as the actor.
   * @param {String} [actor.seed] Optional mnemonic or seed string stored into state (see BIP39 / wallet docs — not validated here).
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

  static chunk (array, size = 32) {
    const chunkedArray = [];
    for (var i = 0; i < array.length; i += size) {
      chunkedArray.push(array.slice(i, i + size));
    }
    return chunkedArray;
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
      const pr = tryParsePersistedJson(input);
      result = pr.ok ? pr.value : null;
    }

    return result;
  }

  /**
   * Get a number of random bytes from the runtime environment.
   * @param {Number} [count=32] Number of random bytes to retrieve.
   * @returns {Buffer} The random bytes.
   */
  static randomBytes (count = 32) {
    if (typeof window !== 'undefined' && window.crypto && window.crypto.getRandomValues) {
      const array = new Uint8Array(count);
      window.crypto.getRandomValues(array);
      return Buffer.from(array);
    } else {
      return require('crypto').randomBytes(count);
    }
  }

  get id () {
    const buffer = Buffer.from(this.preimage, 'hex');
    return Hash256.compute(buffer);
  }

  get spendable () {
    if (!this.signer) return false;
    return false;
  }

  get generic () {
    return this.toGenericMessage();
  }

  get preimage () {
    if (!this.generic) throw new Error('Could not get generic');
    const string = JSON.stringify(this.generic, null, '  ');
    const secret = Buffer.from(string, 'utf8');
    const preimage = Hash256.compute(secret);
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
    const now = new Date();
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
    this.emit('message', {
      type: 'ActorMessage',
      data: {
        actor: { id: this.id },
        created: now.toISOString(),
        object: changes,
        type: 'Changes'
      }
    });

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
   * Returns a new output stream for the Actor.
   * @param {TransformStream} [pipe] Pipe to stream to.
   * @returns {TransformStream} New output stream for the Actor.
   */
  stream (pipe) {
    if (pipe) {
      //
      const stream = new stream.Transform({
        transform (chunk, encoding, done) {
          done(null, chunk);
        }
      });

      // TODO: test this
      // 1. Stream to the output pipe
      stream.pipe(pipe);

      // 2. Stream to the actor
      this.stream.pipe(stream);

      return stream;
    } else {
      return this.stream;
    }

    return this.stream;
  }

  /**
   * Casts the Actor to a normalized Buffer.
   * @returns {Buffer}
   */
  toBuffer () {
    return Buffer.from(this.serialize(), 'utf8');
  }

  /**
   * Casts the Actor to a generic message envelope for state announcements and history.
   * Shape is stable: `{ type, object }` where `object` is sorted-key state ({@link Actor#toObject}).
   * {@link Actor#id} derives from a digest of the pretty-printed generic message; extending this
   * envelope requires a format/version migration across the network.
   * @param {String} [type='FabricActorState'] Logical message type string.
   * @see {@link https://en.wikipedia.org/wiki/Merkle_tree}
   * @see {@link https://dev.fabric.pub/messages}
   * @returns {Object} `{ type, object }`
   */
  toGenericMessage (type = 'FabricActorState') {
    const messageType = type || 'FabricActorState';
    return {
      type: messageType,
      object: this.toObject()
    };
  }

  toJSON () {
    return {
      '@id': this.id,
      ...this.state
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
    return Actor.randomBytes(count);
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

  validate () {
    if (!this.state) return false;
    if (!this.id) return false;
    return true;
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

  _handleMonitorChanges (_changes) {
    // TODO: emit global state event here
    // after verify, commit
  }

  /**
   * Parse an Object into a corresponding Fabric state.
   * @param {Object} input Object to read as input.
   * @returns {Object} Fabric state.
   */
  _readObject (input = {}) {
    if (typeof input === 'string') {
      return Object.assign({}, {
        type: 'String',
        size: input.length,
        content: input,
        encoding: 'utf8'
      });
    } else if (input instanceof Buffer) {
      return Object.assign({}, {
        type: 'Buffer',
        size: input.length,
        content: input.toString('hex'),
        encoding: 'hex'
      });
    } else {
      return Object.assign({}, input);
    }
  }
}

module.exports = Actor;
