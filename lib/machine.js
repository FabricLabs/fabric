'use strict';

const util = require('util');
const monitor = require('fast-json-patch');

const Vector = require('./vector');

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

util.inherits(Machine, Vector);

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
  let self = this;
  let changes = monitor.generate(self.observer);

  if (changes.length) {
    let data = Object.assign({}, {
      parent: self.tip,
      changes: changes
    });
    let vector = new Vector(data)._sign();

    self.history.push(vector);

    process.nextTick(function () {
      self.emit('changes', changes);
      self.emit('transaction', vector);
    });
  }

  return changes;
};

Object.defineProperty(Machine.prototype, 'tip', function (val) {
  return this.history[this.history.length - 1] || null;
});

module.exports = Machine;
