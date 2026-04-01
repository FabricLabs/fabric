'use strict';

const State = require('./state');

class Instruction extends State {
  constructor (config) {
    super(config);
    this.config = Object.assign({}, config);
    return this;
  }
}

module.exports = Instruction;
