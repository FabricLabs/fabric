'use strict';

const crypto = require('crypto');
const m = require('macaroon');

const Entity = require('./entity');
const Signer = require('./signer');
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
    this.signer = new Signer(this.settings);
    this.witness = new Witness(this.settings);

    return this;
  }

  get type () {
    return this._state.content.type;
  }

  async _generateToken () {
    const now = new Date();
    const token = {
      created: now.toISOString(),
      expiry: now + (60 * 1000),
      type: this.type,
      version: 2,
      rootKey: 'secret',
      identifier: 'some id',
      location: 'a location'
    };

    const macaroon = m.newMacaroon(token);

    const json = JSON.stringify(token);
    const hash = crypto.createHash('sha256').update(Buffer.from(json, 'utf8')).digest('hex');
    const signature = this.signer.sign(Buffer.from(hash, 'hex'));

    return {
      json: json,
      macaroon: macaroon.exportJSON(),
      signature: signature.toString('hex')
    };
  }
}

module.exports = Capability;
