'use strict';
// TODO: note that generally, requirements are loosely ordered by
// their relative importance to the file in question
var util = require('util');
//var level = require('level');
var localforage = require('localforage');

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

// could be looked up by name of parameter in #4
util.inherits(Store, require('./vector'));

Store.prototype.open = function load () {
  //this.db = level(this['@data']['path']);
  this.db = localforage.createInstance({
    name: 'fabric'
  });
}

Store.prototype.get = async function GET (key) {
  var self = this;
  var value = await self.db.getItem(key);
  if (!value) return null;
  //if (typeof value !== 'string') return JSON.parse(value);
  return value;
};

Store.prototype.set = async function PUT (key, value) {
  var self = this;
  if (typeof value !== 'string') {
    value = self._serialize(value);
  }

  await self.db.setItem(key, value);

  return await self.db.getItem(key);
};

Store.prototype.del = async function DEL (key) {
  return await this.db.setItem(key, null);
};

Store.prototype.transform = function TRANSFORM (transaction, done) {
  //this.db.del(batch, done);
  return new Error('not yet implemented');
};

Store.prototype.createReadStream = function createReadStream () {
  return this.db.createReadStream();
};

Store.prototype.close = async function close () {
  return await this.db.close();
};

module.exports = Store;
