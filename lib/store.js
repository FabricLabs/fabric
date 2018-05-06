'use strict';
// TODO: note that generally, requirements are loosely ordered by
// their relative importance to the file in question
const fs = require('fs');
const util = require('util');
const level = require('level');
const mkdirp = require('mkdirp');

function Store (vector) {
  this.config = Object.assign({
    path: './data/store',
    get: this.get,
    set: this.set,
    del: this.del,
    transform: this.transform,
    createReadStream: this.createReadStream
  }, vector || {});

  this.clock = 0;
  this.stack = [];
  this.known = {};

  this.init();
}

util.inherits(Store, require('./vector'));

Store.prototype.get = async function GET (key) {
  let self = this;
  let test = null;

  try {
    let value = await self.db.get(key);
    test = value;
  } catch (E) {
    console.debug(E);
  }

  try {
    if (typeof test === 'string') {
      test = JSON.parse(test);
    }
  } catch (E) {
    console.debug('[PARSER]', E);
  }

  return test;
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

Store.prototype.createReadStream = function createReadStream () {
  return this.db.createReadStream();
};

Store.prototype.open = function load () {
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

module.exports = Store;
