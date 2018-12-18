'use strict';

const fs = require('fs');
const level = require('level');
const mkdirp = require('mkdirp');
const rimraf = require('rimraf');
const Store = require('./store');

/**
 * Persistent data storage.
 * @param       {Object} config Configuration for internal datastore.
 * @constructor
 */
class Storage extends Store {
  constructor (config) {
    super(config);

    this.config = Object.assign({
      path: './data/storage',
      persistent: true
    }, config);

    return this;
  }

  async open () {
    if (!fs.existsSync(this.config.path)) {
      mkdirp.sync(this.config.path);
    }

    try {
      this.db = level(this.config.path);
      this.status = 'opened';
    } catch (E) {
      this.error('[STORE]', E);
    }

    return this;
  }

  flush () {
    if (fs.existsSync(this.config.path)) {
      rimraf.sync(this.config.path);
    }
  }

  rotate () {
    if (fs.existsSync(this.config.path)) {
      fs.renameSync(this.config.path, this.config.path + '.' + Date.now());
    }
  }
}

module.exports = Storage;
