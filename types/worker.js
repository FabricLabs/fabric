'use strict';

const Collection = require('./collection');
const EncryptedPromise = require('./promise');
const Entity = require('./entity');
const Machine = require('./machine');
const Router = require('./router');
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
    this.router = new Router();
    this.behaviors = {};
  }

  use (definition) {
    return this.router.use(definition);
  }

  /**
   * Handle a task.
   * @param  {Vector} input Input vector.
   * @return {String}       Outcome of the requested job.
   */
  async compute (input) {
    const output = await this.machine.compute(input);

    console.log('[FABRIC:WORKER]', this.machine.clock, 'Computed output:', output);

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
