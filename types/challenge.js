'use strict';

const State = require('./state');

class Challenge extends State {
  constructor (configuration) {
    super(configuration);
  }

  validate (state) {
    let output = state._sign();
    if (output['@id'] === this['@id']) {
      return true;
    } else {
      return false;
    }
  }
}

module.exports = Challenge;
