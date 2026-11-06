'use strict';

const crypto = require('crypto');
const m = require('macaroon');

const Entity = require('./entity');
const Key = require('./key');
const Witness = require('./witness');

class Capability extends Entity {
  constructor (settings = {}) {
    super(settings);

    // Initial State
    this._state = {
      content: {
        type: 'Witness'
      },
      name: null,
      program: [],
      witness: null
    };

    this.settings = Object.assign({}, this._state, settings);
    this.key = settings.key || new Key(this.settings);
    this.witness = new Witness(this.settings);

    return this;
  }

  get type () {
    return this._state.content.type;
  }

  /**
   * Scaffold macaroon only. Requires `settings.allowScaffoldCapability === true`.
   * `rootKey` is the literal `'secret'`. Do not treat this as production auth —
   * use {@link Token#toSignedString} / {@link Token.verifySigned} for Hub admin
   * tokens instead.
   * @returns {Promise<{ json: string, macaroon: object, signature: string, scaffold: true }>}
   */
  async _generateToken () {
    if (this.settings.allowScaffoldCapability !== true) {
      throw new Error(
        'Capability._generateToken is a non-production scaffold; set allowScaffoldCapability: true to opt in, or use Token.toSignedString'
      );
    }
    const now = Date.now();
    const token = {
      created: new Date(now).toISOString(),
      expiry: now + (60 * 1000),
      type: this.type,
      version: 2,
      rootKey: 'secret',
      identifier: 'scaffold-capability',
      location: 'local-scaffold',
      scaffold: true
    };

    const macaroon = m.newMacaroon(token);

    const json = JSON.stringify(token);
    const hash = crypto.createHash('sha256').update(Buffer.from(json, 'utf8')).digest('hex');
    const signature = this.key.sign(Buffer.from(hash, 'hex'));

    return {
      json: json,
      macaroon: macaroon.exportJSON(),
      signature: signature.toString('hex'),
      scaffold: true
    };
  }
}

module.exports = Capability;
