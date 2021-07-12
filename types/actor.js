'use strict';

// Fabric Types
const Key = require('./key');
const Entity = require('./entity');
const Hash256 = require('./hash256');

/**
 * Generic Fabric Actor.
 * @emits message Fabric {@link Message} objects.
 * @property {String} id Unique identifier for this Actor.
 */
class Actor extends Entity {
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

    // Chainable
    return this;
  }

  get id () {
    return Hash256.digest(Buffer.from(JSON.stringify({
      '@type': 'Actor',
      '@data': this.value
    }, null, '  '), 'utf8'));
  }

  /**
   * Casts the Actor to a normalized Buffer.
   * @returns {Buffer}
   */
  toBuffer () {
    return Buffer.from(JSON.stringify(this.value, null, '  '), 'utf8');
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