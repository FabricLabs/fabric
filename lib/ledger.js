'use strict';

var util = require('util');
var jsonpatch = require('fast-json-patch');

function Ledger (state) {
  this['@data'] = state || [];
  this.clock = 0;
  this.stack = [];
  this.known = {};
  this.init();
}

util.inherits(Ledger, require('./vector'));

Ledger.prototype.append = function add (tx) {
  var self = this;

  console.log('appending tx', tx);
  
  self.compute();
  
  return self;
}

module.exports = Ledger;
