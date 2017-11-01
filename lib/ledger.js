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
  if (tx['@data']) tx = tx['@data'];
  this['@data'].push(tx);
  return this;
}

Ledger.prototype.render = function list () {
  var self = this;
  return jsonpatch.generate(self.observer);
}

module.exports = Ledger;
