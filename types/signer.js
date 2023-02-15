'use strict';

// Dependencies
const crypto = require('crypto');
const stream = require('stream');
const schnorr = require('bip-schnorr');

// Fabric Types
const Actor = require('./actor');
const Hash256 = require('./hash256');
const Key = require('./key');

/**
 * Generic Fabric Signer.
 * @access protected
 * @emits message Fabric {@link Message} objects.
 * @extends {Actor}
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

    // Settings
    this.settings = {
      state: {}
    };

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
    this.stream = new stream.Transform(this._transformer.bind(this));
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

  static chunksForBuffer (input = Buffer.alloc(32), size = 32) {
    const chunks = [];
    for (let i = 0; i < input.length; i += size) {
      const chunk = input.slice(i, i + size);
      chunks.push(chunk);
    }

    return chunks;
  }

  static signableForBuffer (input = Buffer.alloc(32)) {
    // TODO: use pubkey
    const challenge = crypto.randomBytes(32);
    const message_hash = Hash256.digest(input.toString('hex'));
    const message = [
      `--- BEGIN META ---`,
      `message_challenge: ${challenge.toString('hex')}`,
      `message_hash: ${message_hash}`,
      `message_scriptsig: 00${message_hash}`,
      `--- END META ---`,
      `--- BEGIN FABRIC MESSAGE ---`,
      Signer.chunksForBuffer(input.toString('hex'), 80).join('\n'),
      `--- END FABRIC MESSAGE ---`
    ].join('\n');

    return message;
  }

  get pubkey () {
    // TODO: encode pubkey correctly for verification
    const x = this.key.keypair.getPublic().getX();
    return schnorr.convert.intToBuffer(x);
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
    // this._preimage = Buffer.from(Hash256.digest(data), 'hex');
    this.signature = schnorr.sign(this.key.keypair.getPrivate('hex'), data);
    // this.signature = schnorr.sign(this.key.keypair.getPrivate('hex'), this._preimage);

    this.emit('signature', {
      content: data,
      preimage: this._preimage,
      pubkey: this._pubkey,
      signature: this.signature.toString('hex')
    });

    return this.signature;
  }

  start () {
    this._state.content.status = 'STARTING';
    // TODO: unpause input stream here
    this._state.status = 'STARTED';
    this.commit();
    return this;
  }

  stop () {
    this._state.status = 'STOPPING';
    this._state.status = 'STOPPED';
    this.commit();
    return this;
  }

  toSpend () {

  }

  toSign () {

  }

  verify (pubkey, message, signature) {
    if (!(pubkey instanceof Buffer)) pubkey = Buffer.from(pubkey, 'hex');
    if (!(message instanceof Buffer)) message = Buffer.from(message, 'hex');
    if (!(signature instanceof Buffer)) signature = Buffer.from(signature, 'hex');

    try {
      schnorr.verify(pubkey, message, signature);
      return true;
    } catch (exception) {
      return false;
    }
  }

  async _transformer (chunk, controller) {

  }
}

module.exports = Signer;
