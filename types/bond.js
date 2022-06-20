'use strict';

const Actor = require('@fabric/core/types/actor');

class Bond extends Actor {
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      amount: null,
      expiry: null,
      issuer: null
    }, this.settings, settings);

    return this;
  }

  _getExpiry (type, time) {
    return {
      type, time,
      content: Buffer.alloc(4) // TODO: Bitcoin encoded values?
    };
  };
}

module.exports = Bond;
