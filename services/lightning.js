'use strict';

// External Dependencies
const jayson = require('jayson');

// Fabric Types
const Service = require('../types/service');
const Machine = require('../types/machine');

/**
 * Lightning connectivity.
 * @module @fabric/core/services/lightning
 * @augments Service
 */
class Lightning extends Service {
  constructor (settings = {}) {
    super(settings);
    this.settings = Object.assign({}, this.settings, settings);
    this.machine = new Machine(this.settings);
    this.status = 'disconnected';
  }

  async start () {
    this.status = 'starting';
    await super.start();
    await this.machine.start();
    this.status = 'started';
  }
}

module.exports = Lightning;
