'use strict';

const State = require('./state');

class Circuit extends State {
  constructor (config) {
    super(config);
    this.config = Object.assign({}, config);
    this['@data'] = this.config;
    return this;
  }

  async compute (input) {
    let output = input;

    // empty resolves to Identity function f(x) = x

    return output;
  }

  async render () {
    return `<Circuit data-blob="${JSON.stringify(this['@data'])}" />`;
  }
}

module.exports = Circuit;
