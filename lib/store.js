'use strict';
// TODO: note that generally, requirements are loosely ordered by
// their relative importance to the file in question
const fs = require('fs');
const util = require('util');
const level = require('level');
const mkdirp = require('mkdirp');

const _ = require('./functions');

function Store (vector) {
  let template = {
    path: './data/store',
    get: this.get,
    set: this.set,
    del: this.del,
    transform: this.transform,
    createReadStream: this.createReadStream,
  };

  this['@data'] = _.merge({}, template, vector || {});

  this.clock = 0;
  this.stack = [];
  this.known = {};

  this.open();

  this.init();
}

util.inherits(Store, require('./vector'));

Store.prototype.open = function load () {
  if (!fs.existsSync(this['@data']['path'])) {
    mkdirp.sync(this['@data']['path']);
  }

  this.db = level(this['@data']['path']);
}

Store.prototype.get = async function GET (key) {
  let self = this;
  var test = null;

  try {
    test = await self.db.get(key);
  } catch (E) {
    console.error(E);
  }

  var inner = null;

  if (typeof test === 'string') {
    try {
      inner = JSON.parse(test);
    } catch (E) {
      console.error(E);
    }
  } else {
    inner = test;
  }

  return inner;
};

Store.prototype.set = async function PUT (key, value) {
  var self = this;

  if (value == null) {
    return await self.db.del(key);
  }

  if (typeof value !== 'string') {
    value = self._serialize(value);
  }

  var result = await self.db.put(key, value);
  var data = await self.get(key);

  return data;
};

Store.prototype.del = async function DEL (key) {
  return await this.db.del(key);
};

Store.prototype.transform = function TRANSFORM (transaction, done) {
  this.db.del(batch, done);
};

Store.prototype.createReadStream = function createReadStream () {
  return this.db.createReadStream();
};

Store.prototype.close = async function close () {
  return await this.db.close();
};

module.exports = Store;
