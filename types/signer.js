'use strict';

// Dependencies
const schnorr = require('bip-schnorr');

// Fabric Types
const Actor = require('./actor');
const Hash256 = require('./hash256');
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
      private: actor.private,
      xprv: actor.xprv,
      xpub: actor.xpub
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

  get pubkey () {
    // TODO: encode pubkey correctly for verification
    const x = this.key.keypair.getPublic().getX();
    return schnorr.convert.intToBuffer(x).toString('hex');
  }

  /**
   * Signs some data.
   * @returns {Signer}
   */
  sign (data = this.toBuffer()) {
    if (!(data instanceof Buffer)) {
      switch (data.constructor.name) {
        default:
          this.emit('warning', `unhandled data to sign: ${data.constructor.name} ${JSON.stringify(data)}`);
          break;
      }
    }

    this._lastSignature = new Actor({ message: data, signature: this.signature });

    // Hash & sign
    // TODO: check with bip-schnorr on behavior of signing > 32 byte messages
    this._preimage = Buffer.from(Hash256.digest(data), 'hex');
    this.signature = schnorr.sign(this.key.keypair.getPrivate('hex'), this._preimage);

    this.emit('signature', {
      content: data,
      preimage: this._preimage,
      pubkey: this._pubkey,
      signature: this.signature.toString('hex')
    });

    return this.signature.toString('hex');
  }

  verify (pubkey, message, signature) {
    if (!(pubkey instanceof Buffer)) pubkey = Buffer.from(pubkey, 'hex');
    if (!(message instanceof Buffer)) message = Buffer.from(message, 'hex');
    if (!(signature instanceof Buffer)) signature = Buffer.from(signature, 'hex');

    try {
      schnorr.verify(pubkey, message, signature);
      return true;
    } catch (exception) {
      console.error(exception);
      return false;
    }
  }
}

module.exports = Signer;
