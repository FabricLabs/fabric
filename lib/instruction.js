'use strict';

var util = require('util')

function Instruction (init) {
  this['@data'] = init || {};
  this.clock = 0;
  this.stack = [];
  this.known = {};
  this.init();
}

util.inherits(Instruction, require('./vector'));

module.exports = Instruction;
