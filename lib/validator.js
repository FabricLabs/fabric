'use strict';

const Fabric = require('./fabric');

class Validator extends Fabric {
  constructor (config) {
    super(config);

    async function main (input) {
      return input.pipe(this.stream);
    }

    this.process = main();

    return this;
  }

  validate (input) {
    return true;
  }
}

module.exports = Validator;
