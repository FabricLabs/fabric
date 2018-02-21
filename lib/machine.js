'use strict';

const util = require('util');
const StateMachine = require('javascript-state-machine');

function Machine (init) {
  this['@data'] = init || {};
  this.clock = 0;
  this.known = {};
  this.script = [];
  this.stack = [];
  this.init();
}

util.inherits(Machine, require('./vector'));

Machine.prototype.define = function instruction (name, op) {
  this.use(name, op);
};

module.exports = Machine;
