'use strict';

const EncryptedPromise = require('./promise');
const Entity = require('./entity');
const Witness = require('./witness');

class Capability extends Entity {
  constructor (settings = {}) {
    super(settings);

    // Initial State
    this._state = {
      name: null,
      program: [],
      witness: null
    };

    this.settings = Object.assign({}, this._state, settings);
    this.witness = new Witness(this.settings);
  }
}

module.exports = Capability;
