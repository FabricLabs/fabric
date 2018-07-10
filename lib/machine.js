'use strict';

const util = require('util');
const monitor = require('fast-json-patch');

/**
 * General-purpose state machine with {@link Vector}-based instructions.
 * @param       {Object} config Run-time configuration.
 * @constructor
 */
function Machine (config) {
  this.config = Object.assign({}, config || {});

  this.clock = 0;

  this.known = {};
  this.script = [];
  this.stack = [];

  this.state = {};

  this.observer = monitor.observe(this.state);

  // this.init();
}

util.inherits(Machine, require('./vector'));

Machine.prototype.define = function instruction (name, op) {
  this.use(name, op);
};

Machine.prototype.applyOperation = function (op) {
  monitor.applyOperation(this.state, op);
};

Machine.prototype.applyChanges = function (ops) {
  monitor.applyPatch(this.state, ops);
};

Machine.prototype.commit = function commit () {
  let changes = monitor.generate(this.observer);
  if (changes.length) this.emit('changes', changes);
  return this.state;
};

module.exports = Machine;
