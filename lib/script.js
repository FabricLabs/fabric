'use strict';

const Stack = require('./stack');

class Script extends Stack {
  constructor (config) {
    super(config);
    this.stack = new Stack();
    this['@data'] = this.stack['@data'];
    return this;
  }

  render () {
    return this.stack.join(' ');
  }
}

module.exports = Script;
