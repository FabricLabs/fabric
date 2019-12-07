'use strict';

const Service = require('../types/service');

class TXT extends Service {
  constructor (config) {
    super(config);
    this.config = Object.assign({}, config);
  }
}

module.exports = TXT;
