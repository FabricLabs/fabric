'use strict';

const util = require('util');
const Vector = require('./vector');

/**
 * Workers are arbitrary containers for processing data.  They can be thought of
 * almost like "threads", as they run asynchronously over the duration of a
 * contract's lifetime as "fulfillment conditions" for its closure.
 * @param       {Object} initial - Configuration object
 * @constructor
 */
function Worker (init) {
  //self.worker = new Worker('validator.js');
}

util.inherits(Worker, Vector);

/**
 * Handle a task.
 * @param  {Vector} input Input vector.
 * @return {String}       Outcome of the requested job.
 */
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
