'use strict';

const merge = require('lodash.merge');
const Actor = require('./actor');
const Label = require('./label');

class Token {
  constructor (settings = {}) {
    // Settings
    this.settings = merge({
      name: 'AUTH_GROUP_GENERIC'
    }, settings);

    // Internal Properties
    this.actor = new Actor(this.settings);
    this.label = new Label(this.settings.name);

    // Chainable
    return this;
  }

  get id () {
    return this.actor.id;
  }

  get label () {
    return this.label._id;
  }

  toString () {
    return this.label;
  }
}

module.exports = Token;
