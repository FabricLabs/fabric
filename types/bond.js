'use strict';

const Contract = require('./contract');

/**
 * On-chain or logical bond / stake terms layered on {@link Contract}.
 * @class Bond
 * @extends Contract
 */
class Bond extends Contract {
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      amount: null,
      expiry: null,
      issuer: null
    }, this.settings);

    return this;
  }

  _getExpiry (type, time) {
    return {
      type, time,
      content: Buffer.alloc(4) // TODO: Bitcoin encoded values?
    };
  }
}

module.exports = Bond;
