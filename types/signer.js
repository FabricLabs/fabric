'use strict';

// Dependencies
const schnorr = require('bip-schnorr');

// Fabric Types
const Actor = require('./actor');
const Key = require('./key');

/**
 * Generic Fabric Signer.
 * @access protected
 * @emits message Fabric {@link Message} objects.
 * @property {String} id Unique identifier for this Signer (id === SHA256(preimage)).
 * @property {String} preimage Input hash for the `id` property (preimage === SHA256(SignerState)).
 */
class Signer extends Actor {
  /**
   * Creates an {@link Signer}, which emits messages for other
   * Signers to subscribe to.  You can supply certain parameters
   * for the actor, including key material [!!!] — be mindful of
   * what you share with others!
   * @param {Object} [actor] Object to use as the actor.
   * @param {String} [actor.seed] BIP24 Mnemonic to use as a seed phrase.
   * @param {Buffer} [actor.public] Public key.
   * @param {Buffer} [actor.private] Private key.
   * @returns {Signer} Instance of the Signer.  Call {@link Signer#sign} to emit a {@link Signature}.
   */
  constructor (actor = {}) {
    super(actor);

    this.log = [];
    this.signature = null;

    // TODO: fix bcoin in React / WebPack
    this.key = new Key({
      seed: actor.seed,
      public: actor.public || actor.pubkey,
      private: actor.private
    });

    // Indicate Risk
    this.private = !!(this.key.seed || this.key.private);
    this.value = this._readObject(actor); // TODO: use Buffer?

    // Internal State
    this._state = {
      '@type': 'Signer',
      '@data': this.value,
      status: 'PAUSED',
      content: this.value || {}
    };

    // Chainable
    return this;
  }

  /**
   * Signs some data.
   * @returns {Signer}
   */
  sign (data = this.toBuffer()) {
    this._lastSignature = new Actor({ message: data, signature: this.signature });
    this.signature = schnorr.sign(this.key.private, data);
    this.emit('signature', );
    return this.signature.toString('hex');
  }
}

module.exports = Signer;
