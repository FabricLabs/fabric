'use strict';

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
}

module.exports = Capability;
