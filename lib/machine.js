'use strict';

var util = require('util');
var StateMachine = require('javascript-state-machine');

function Machine (init) {
  this['@data'] = init || {};
  this.clock = 0;
  this.stack = [];
  this.known = {};
  this.init();
}

util.inherits(Machine, require('./vector'));

Machine.prototype.define = function instruction (name, op) {
  this.use(name, op);
};

Machine.prototype.step = function instruction () {
  console.log('stepping...');
  this.compute();
};

module.exports = Machine;
