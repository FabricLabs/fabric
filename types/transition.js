'use strict';

const Capability = require('./capability');
const EncryptedPromise = require('./promise');
const Entity = require('./entity');
const Witness = require('./witness');

class Transition extends Entity {
  constructor (settings = {}) {
    super(settings);

    this.status = 'constructing';
    this._state = {
      origin: null,
      changes: [],
      program: [],
      witness: null
    };

    this.settings = Object.assign({}, this._state, settings);
    this.witness = new Witness(this.settings);
    this.status = 'constructed';
  }

  async _applyTo (state) {
    if (!state) throw new Error('State must be provided.');
    if (!(state instanceof Entity)) throw new Error('State not of known Entity type.');

    for (let i = 0; i < this._state.changes.length; i++) {
      let op = this._state.changes[i];
    }
  }

  async _loadOrigin (origin) {
    if (!origin) throw new Error('No origin specified.');
  }

  async start () {
    this.status = 'starting';
    await this._loadOrigin(this.settings.origin);
    this.status = 'started';
  }
}

module.exports = Transition;