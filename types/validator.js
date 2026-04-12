'use strict';

const Fabric = require('./fabric');

class Validator extends Fabric {
  constructor (config) {
    super(config);

    async function main (_input) {
      return _input.pipe(this.stream);
    }

    this.process = main();

    return this;
  }

  validate (_input) {
    return true;
  }
}

module.exports = Validator;
