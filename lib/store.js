'use strict';

// TODO: note that generally, requirements are loosely ordered by
// their relative importance to the file in question
const fs = require('fs');
const level = require('level');
const mkdirp = require('mkdirp');
const Scribe = require('./scribe');

class Store extends Scribe {
  constructor (config) {
    super(config);

    this.config = Object.assign({
      path: './data/store',
      get: this.get,
      set: this.set,
      del: this.del,
      transform: this.transform,
      createReadStream: this.createReadStream
    }, config);

    return this;
  }

  async _GET (key) {
    return this.get(key);
  }

  async open () {
    if (this.config.debug) {
      console.debug('[STORE]', 'opening store:', this.config.path);
    }

    if (!fs.existsSync(this.config.path)) {
      mkdirp.sync(this.config.path);
    }

    try {
      this.db = level(this.config.path);
    } catch (E) {
      console.error('[STORE]', E);
    }

    return this;
  }
}

Store.prototype.get = async function GET (key) {
  let self = this;
  let data = null;

  try {
    data = await self.db.get(key);
  } catch (E) {
    this.error(`Could not retrieve key ${key}:`, E);
  }

  try {
    if (typeof test === 'string') {
      data = JSON.parse(data);
    }
  } catch (E) {
    this.error('[PARSER]', E);
  }

  return data;
};

/**
 * Set a `key` to a specific `value`.
 * @param       {String} key   Address of the information.
 * @param       {Mixed} value Content to store at `key`.
 */
Store.prototype.set = async function PUT (key, value) {
  let self = this;
  let test = null;

  if (this.config.debug) {
    console.debug('[STORE]', 'setting:', key, value.length, 'bytes');
  }

  try {
    if (typeof value !== 'string') {
      value = JSON.stringify(value);
    }
  } catch (E) {
    console.debug(E);
  }

  try {
    await self.db.put(key, value);
    test = await self.db.get(key);
  } catch (E) {
    console.debug(E);
  }

  return test;
};

Store.prototype.del = async function DEL (key) {
  return this.db.del(key);
};

Store.prototype.batch = async function (ops, done) {
  return this.db.batch(ops).then(done);
};

Store.prototype.createReadStream = function createReadStream () {
  return this.db.createReadStream();
};

Store.prototype.close = async function close () {
  if (this.config.debug) {
    console.debug('[STORE]', 'closing store:', this.config.path);
  }

  if (this.db) {
    try {
      await this.db.close();
    } catch (E) {
      console.error('[STORE]', 'closing store:', this.config.path, E);
    }
  }
};

Store.prototype.flush = function () {
  if (fs.existsSync(this.config.path)) {
    fs.renameSync(this.config.path, this.config.path + '.' + Date.now());
  }
};

module.exports = Store;
