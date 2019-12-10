'use strict';

const HTTP = require('./http');

class Authority extends HTTP {
  constructor (configuration = {}) {
    super(configuration);
    this.config = configuration;
  }
}

module.exports = Authority;
