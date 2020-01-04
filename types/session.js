'use strict'

const Entity = require('./entity');
const Key = require('./key');

/**
 * The {@link Session} type describes a connection between {@link Peer}
 * objects, and includes its own lifecycle.
 */
class Session extends Entity {
  /**
   * Creates a new {@link Session}.
   * @param {Object} settings 
   */
  constructor (settings = {}) {
    this.settings = Object.assign({}, settings);
    this.key = new Key();

    // External State
    this.state = {};

    // Internal State
    this._state = {};

    // Status flag
    this.status = 'initialized';
  }

  /**
   * Opens the {@link Session} for interaction.
   */
  async start () {
    this.status = 'starting';
    this.status = 'started';
    return this;
  }

  /**
   * Closes the {@link Session}, preventing further interaction.
   */
  async stop () {
    this.status = 'stopping';
    this.status = 'stopped';
    return this;
  }
}

module.exports = Session;
