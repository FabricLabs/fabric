'use strict';

const Entity = require('../types/entity');
const Service = require('../types/service');

/**
 * Service for interacting with Matrix.
 */
class Matrix extends Service {
  /**
   * Create an instance of a Matrix client, connect to the
   * network, and relay messages received from therein.
   * @param {Object} [settings] Configuration values.
   */
  constructor (settings = {}) {
    super(settings);
    
    // Assign defaults
    this.settings = Object.assign({
      name: '@fabric/matrix'
    }, settings);

    return this;
  }

  /**
   * Start the service, including the initiation of an outbound connection
   * to any peers designated in the service's configuration.
   */
  async start () {
    super.start();
    this.status('starting');
    this.log('[SERVICES:MATRIX]', 'Starting...');
    this.status('started');
    this.log('[SERVICES:MATRIX]', 'Started!');
  }

  /**
   * Stop the service.
   */
  async stop () {
    super.stop();
    this.status('stopping');
    this.log('[SERVICES:MATRIX]', 'Stopping...');
    this.status('stopped');
    this.log('[SERVICES:MATRIX]', 'Stopped!');
  }
}

module.exports = Matrix;
