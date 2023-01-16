'use strict';

const Contract = require('../types/contract');

class Distribution extends Contract {
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      state: {
        amounts: [],
        recipients: []
      }
    }, settings);

    this._state = {
      content: this.settings.state
    };

    return this;
  }
}

module.exports = Distribution;
