'use strict';

// Dependencies
const { EventEmitter } = require('events');

// Fabric Types
const Key = require('./key');
const Hash256 = require('./hash256');

/**
 * Generic Fabric Actor.
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

    // Monad value
    this.signature = null;
    this.value = Object.assign({}, actor);
    this.key = new Key({
      seed: actor.seed,
      public: actor.public,
      private: actor.private
    });

    // Indicate Risk
    this.private = (this.key.seed || this.key.private);

    // Internal State
    this._state = {
      '@type': 'Actor',
      '@data': this.value
    };

    // Chainable
    return this;
  }

  get id () {
    const buffer = Buffer.from(this.preimage, 'hex');
    return Hash256.digest(buffer);
  }

  get preimage () {
    const input = {
      '@type': 'FabricActorState',
      '@data': this.toObject()
    };

    const string = JSON.stringify(input, null, '  ');
    const buffer = Buffer.from(string, 'utf8');

    return Hash256.digest(buffer);
  }

  get state () {
    return Object.assign({}, this._state['@data']);
  }

  /**
   * Casts the Actor to a normalized Buffer.
   * @returns {Buffer}
   */
  toBuffer () {
    return Buffer.from(this.serialize(), 'utf8');
  }

  /**
   * Returns the Actor's current state as an {@link Object}.
   * @returns {Object}
   */
  toObject () {
    return this._sortKeys(this.state);
  }

  /**
   * Serialize the Actor's current state into a JSON-formatted string.
   * @returns {String}
   */
  serialize () {
    return JSON.stringify(this.toObject(), null, '  ');
  }

  /**
   * Signs the Actor.
   * @returns {Actor}
   */
  sign () {
    this.signature = this.key._sign(this.toBuffer());
    this.emit('signature', this.signature);
    return this;
  }

  /**
   * Create a new {@link Object} with sorted properties.
   * @param {Object} state Object to sort.
   * @returns {Object} Re-sorted instance of `state` as provided.
   */
  _sortKeys (state) {
    // TODO: investigate whether relying on default sort()
    // or using a locally-defined function is the safest method
    return Object.keys(state).sort().reduce((obj, key) => {
      obj[key] = state[key];
      return obj;
    }, {});
  }
}

module.exports = Actor;
