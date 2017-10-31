'use strict';

var util = require('util');
var Store = require('./store');

function Oracle (init) {
  this['@data'] = init || {};
  this.clock = 0;
  this.stack = [];
  this.known = {};

  this.store = new Store();

  this.init();
}

util.inherits(Oracle, require('./vector'));

Oracle.prototype._GET = async function (key, params) {
  return await this.store.get(key);
}

Oracle.prototype._PUT = async function (key, obj) {
  await this.store.set(key, obj);
  return await this.store.get(key);
}

Oracle.prototype._POST = async function (key, obj) {
  var collection = await this.store.get(key);
  if (!collection || !(collection instanceof Array)) collection = [];

  collection.push(obj);

  var result = await this.store.set(key, collection);

  return await this.store.get(key);
}

Oracle.prototype._PATCH = async function (key, obj) {
  await this.store.set(key, obj);
  return await this.store.get(key);
}

Oracle.prototype._DELETE = async function (key, obj) {
  await this.store.set(key, obj);
  return await this.store.get(key);
}

module.exports = Oracle;
