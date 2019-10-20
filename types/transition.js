'use strict';

const Capability = require('./capability');
const EncryptedPromise = require('./promise');

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
    this.status = 'constructed';
  }

  async _loadOrigin (origin) {
    if (!origin) throw new Error('No origin specified.');
  }

  async start () {
    await this._loadOrigin(this.settings.origin);
  }
}

module.exports = Transition;