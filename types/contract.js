'use strict';

const parser = require('dotparser');
const Actor = require('./actor');

const template = {
  name: 'Template',
  balances: {}
};

class Contract extends Actor {
  constructor (settings = template) {
    super(settings);

    this['@data'] = settings;

    return this;
  }

  parse (input) {
    return parser(input);
  }
}

module.exports = Contract;
