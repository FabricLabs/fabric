'use strict';

const fs = require('fs');
const mkdirp = require('mkdirp');
const Actor = require('./actor');

class Logger extends Actor {
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      path: './logs'
    }, settings);

    return this;
  }

  get path () {
    return `${this.settings.path}/${this.id}.log`;
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
    await mkdirp(this.settings.path);
    this.stream = fs.createWriteStream(this.path, {
      flags: 'a'
    });
    return this;
  }

  async stop () {
    if (this.stream) this.stream.close();
    return this;
  }
}

module.exports = Logger;
