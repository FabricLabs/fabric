'use strict';

// Dependencies
const fs = require('fs');
const { mkdirp } = require('mkdirp');

// Fabric Types
const Actor = require('./actor');

/**
 * A basic logger that writes logs to the local file system
 *
 * @extends Actor
 */
class Logger extends Actor {
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      name: this.id,
      path: './logs',
      silent: true
    }, settings);

    this._state = {
      status: 'STOPPED'
    };

    return this;
  }

  /**
   * Returns the path to the log file
   *
   * @returns {String}
   */
  get path () {
    return `${this.settings.path}/${this.settings.name}.log`;
  }

  /**
   * Writes the specified log to the log file
   *
   * @param {String|Object} msg The message to log
   * @returns {Boolean} true, if msg was successfully written; false otherwise
   */
  log (msg) {
    if (typeof msg !== 'string') {
      try {
        msg = JSON.stringify(msg);
      } catch (exception) {
        console.warn('Unable to parse message to string:', `<${msg.constructor.name}>`, msg);
        return false;
      }
    }

    this.stream.write(msg + '\n');

    return true;
  }

  /**
   * Starts the logger
   *
   * This method creates the required directories for writing the log file.
   *
   * @returns {Promise}
   */
  async start () {
    this._state.status = 'STARTING';

    await mkdirp(this.settings.path);

    this.stream = fs.createWriteStream(this.path, {
      flags: 'a+'
    }).on('error', (err) => {
      console.warn(err.message, err.stack);
    }).once('close', () => {
      this._state.status = 'STOPPED';
    });

    this._state.status = 'STARTED';

    return this;
  }

  /**
   * Stops the logger
   *
   * This method closes the log file and returns after it has been closed. Any
   * errors on close would cause the return promise to be rejected.
   *
   * @returns {Promise}
   */
  stop () {
    if (!this.stream) {
      this._state.status = 'STOPPED';
      return Promise.resolve(this);
    }

    return new Promise((resolve, reject) => {
      this._state.status = 'STOPPING';
      this.stream
        .once('error', err => reject(err))
        .once('close', () => resolve(this))
        .close();
    });
  }

  async _getLastLine () {
    if (!fs.existsSync(this.path)) await this.log({ status: 'EMPTY' });
    return fs.readFileSync(this.path).toString('utf8').split('\n');
  }
}

module.exports = Logger;
