'use strict';

const Service = require('../lib/service');

class TXT extends Service {
  constructor (config) {
    super(config);
    this.config = Object.assign({}, config);
  }
}

module.exports = TXT;
