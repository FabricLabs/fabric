'use strict';
// TODO: note that generally, requirements are loosely ordered by
// their relative importance to the file in question
var util = require('util');
var level = require('level');

var _ = require('lodash');

function Store (vector) {
  var template = {
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
  this.db = level(this['@data']['path']);
}

Store.prototype.get = async function GET (key) {
  var self = this;
  try {
    var value = await self.db.get(key);
  } catch (e) {
    var value = null;
  }

  if (!value) return null;
  //if (typeof value !== 'string') return JSON.parse(value);
  return value;
};

Store.prototype.set = async function PUT (key, value) {
  var self = this;
  if (typeof value !== 'string') {
    value = self._serialize(value);
  }

  await self.db.put(key, value);

  return await self.db.get(key);
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
