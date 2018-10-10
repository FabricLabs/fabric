'use strict';

const Scribe = require('./scribe');

class Circuit extends Scribe {
  constructor (config) {
    super(config);
    this.config = Object.assign({}, config);
    return this;
  }
}

module.exports = Circuit;
