'use strict';

const crypto = require('crypto');
const patch = require('fast-json-patch');

const Entity = require('./entity');

class Transaction extends Entity {
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      type: 'Transaction'
    }, settings);

    this.clock = 0;
    this.stack = [];
    this.known = {};

    this.state = {};
    this._state = {
      settings: this.settings
    };

    return this;
  }
}

module.exports = Transaction;
