'use strict';

var util = require('util');
var Vector = require('./vector');

function Worker (name) {
  //self.worker = new Worker('validator.js');
}

util.inherits(Worker, Vector);

Worker.prototype.compute = function (input) {
  var vector = new Vector(input);
  var output = vector.compute();
  
  if (vector.debug) console.log('[WORKER]', 'compute', typeof input, input, output);

  switch (input) {
    case 'PING':
      this.emit('pong');
      break;
  }

  return output;
};

Worker.prototype.route = async function (path) {
  switch (path) {
    default:
      await this.compute(path);
      break;
  }
};

module.exports = Worker;
