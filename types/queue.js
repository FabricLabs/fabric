'use strict';

const merge = require('lodash.merge');
const Actor = require('./actor');

class Queue extends Actor {
  constructor (settings = {}) {
    super(settings);

    this.settings = merge({
      workers: 1
    }, settings);

    this._state = {
      jobs: {},
      status: 'STOPPED'
    };

    this._methods = {};

    return this;
  }

  async start () {
    await this._registerMethod('verify', async function (...params) {

    });
  }

  async _registerMethod (name, contract) {
    if (this._methods[name]) return this._methods[name];
    // TODO: bind state?
    this._methods[name] = contract.bind({});
    return this._methods[name];
  }

  async _addJob (job) {
    if (!job.id) job = new Actor(job);
    // TODO: reduce lookups
    if (this._state.jobs[job.id]) return this._state.jobs[job.id];
    this._state.jobs[job.id] = job;
    this.emit('job', this._state.jobs[job.id]);
    return this._state.jobs[job.id];
  }

  async _takeJob (job) {

  }

  async _completeJob (job) {

  }

  async _failJob (job) {

  }
}

module.exports = Queue;
