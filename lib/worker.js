'use strict';

const Machine = require('./machine');
const Service = require('./service');

/**
 * Workers are arbitrary containers for processing data.  They can be thought of
 * almost like "threads", as they run asynchronously over the duration of a
 * contract's lifetime as "fulfillment conditions" for its closure.
 * @param       {Function} method Pure function.
 * @constructor
 */
class Worker extends Service {
  constructor (method) {
    super(method);
    // self.worker = new Worker('validator.js');
    this.method = method;
    this.machine = new Machine();
    this.behaviors = {};
  }

  /**
   * Handle a task.
   * @param  {Vector} input Input vector.
   * @return {String}       Outcome of the requested job.
   */
  async compute (input) {
    let output = await this.machine.compute();

    console.log('machine computed:', output);

    switch (input) {
      case 'PING':
        this.emit('pong');
        break;
    }

    return output;
  }

  async route (path) {
    switch (path) {
      default:
        await this.compute(path);
        break;
    }
  }
}

module.exports = Worker;
