'use strict';

const Service = require('../types/service');

class Lightning extends Service {
  constructor (settings = {}) {
    super(settings);
    this.settings = Object.assign({}, this.settings, settings);
    this.status = 'disconnected';
  }

  async start () {
    this.status = 'starting';
    await super.start();
    this.status = 'started';
  }
}

module.exports = Lightning;