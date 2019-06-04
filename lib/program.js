'use strict';

const Circuit = require('./circuit');

class Program extends Circuit {
  constructor (settings = {}) {
    super(settings);
    return this;
  }
}

module.exports = Program;
