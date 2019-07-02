'use strict';

var util = require('util');
var crypto = require('crypto');

var patch = require('fast-json-patch');

function Transaction (data) {
  if (!data) data = {};

  this['@data'] = {
    type: 'Transaction',
    name: data.name
  };

  this.clock = 0;
  this.stack = [];
  this.known = {};

  if (data.name) {
    this.stack.push(data.name);
  }

  this.init();
}

util.inherits(Transaction, require('./vector'));

module.exports = Transaction;
