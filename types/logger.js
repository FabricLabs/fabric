'use strict';

// Dependencies
const fs = require('fs');
const mkdirp = require('mkdirp');

// Fabric Types
const Actor = require('./actor');

class Logger extends Actor {
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      name: this.id,
      path: './logs'
    }, settings);

    this._state = {
      status: 'STOPPED'
    };

    return this;
  }

  get path () {
    return `${this.settings.path}/${this.settings.name}.log`;
  }

  async log (msg) {
    if (typeof msg !== 'string') {
      try {
        msg = JSON.stringify(msg);
      } catch (exception) {
        console.warn('Unable to parse message to string:', `<${msg.constructor.name}>`, msg);
        return false;
      }
    }

    this.stream.write(msg + '\n');
  }

  async start () {
    this._state.status = 'STARTING';
    await mkdirp(this.settings.path);
    this.stream = fs.createWriteStream(this.path, {
      flags: 'a'
    });
    this._state.status = 'STARTED';
    return this;
  }

  async stop () {
    this._state.status = 'STOPPING';
    if (this.stream) this.stream.close();
    this._state.status = 'STOPPED';
    return this;
  }
}

module.exports = Logger;
