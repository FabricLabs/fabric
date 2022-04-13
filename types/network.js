'use strict';

const Circuit = require('./circuit');

class Network {
  constructor (settings = {}) {
    this.settings = Object.assign({}, settings);
  }
}

module.exports = Network;
