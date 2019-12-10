'use strict';

const Scribe = require('./scribe');

class Instruction extends Scribe {
  constructor (config) {
    super(config);
    this.config = Object.assign({}, config);
    return this;
  }
}

module.exports = Instruction;
