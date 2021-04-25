'use strict';

// Dependencies
const { EventEmitter } = require('events');

// Fabric Types
const Key = require('./key');
const Hash256 = require('./hash256');

/**
 * Generic Fabric Actor.
 * @emits message Fabric {@link Message} objects.
 * @property {String} id Unique identifier for this Actor.
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
      '@data': this.state
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
    return Buffer.from(JSON.stringify(this.value, null, '  '), 'utf8');
  }

  toObject () {
    return this.state;
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
}

module.exports = Actor;
