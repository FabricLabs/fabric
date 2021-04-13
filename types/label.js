'use strict';

const Actor = require('./actor');
const Hash256 = require('./hash256');

class Label extends Actor {
  constructor (input = '') {
    super(input);
    if (typeof input != 'string') input = super.serialize(input);
    this._id = Hash256.digest(`@labels/${input}`);
    return this;
  }
}

module.exports = Label;
