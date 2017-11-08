'use strict';

var Vector = require('./vector');

function Worker (name) {
  //self.worker = new Worker('validator.js');
}

Worker.prototype.compute = function (input) {
  var vector = new Vector(input);
  var output = vector.compute();
  console.log('[WORKER]', 'compute', typeof input, input, output);
  return output;
};

Worker.prototype.route = function (path) {
  switch (path) {
    default:
      this.compute(path);
      break;
  }
};

module.exports = Worker;
