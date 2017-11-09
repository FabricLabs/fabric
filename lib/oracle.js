'use strict';

var util = require('util');
var path = require('path');
var fs = require('fs');

var Store = require('./store');
var Walker = require('./walker');
var Vector = require('./vector');

var _ = require('lodash');

function Oracle (init) {
  this['@data'] = init || {};
  this.clock = 0;
  this.stack = [];
  this.known = {};

  this.store = new Store();

  this.init();
}

util.inherits(Oracle, Vector);

Oracle.prototype._load = async function bootstrap (dir) {
  var self = this;
  console.log('[ORACLE]', 'bootstrapping:', dir);

  var walker = new Walker();
  var map = await walker._define(dir, {});

  var list = Object.keys(map);
  console.log('[ORACLE]', 'list:', list);
    
  for (var i = 0; i < list.length; i++) {
    var file = path.join('/', list[i]);
    var content = map[list[i]];
    
    console.log('[ORACLE]', 'saving:', content.length, 'bytes to', file);
    await self.store.set(file, content);
  }
  
  var result = await self.store.get('/assets/app.min.js');
  var vector = new Vector(result);
  
  vector._sign();
  
  console.log('[ORACLE]', 'loaded:', list.length, 'resources from', dir);
  console.log('[ORACLE]', 'size of app.min.js:', result.length);
  
  return vector;
};

Oracle.prototype._GET = async function (key, params) {
  return await this.store.get(key);
};

Oracle.prototype._PUT = async function (key, obj) {
  await this.store.set(key, obj);
  return await this.store.get(key);
};

Oracle.prototype._POST = async function (key, obj) {
  var collection = await this.store.get(key);
  if (!collection || !(collection instanceof Array)) collection = [];

  collection.push(obj);

  var result = await this.store.set(key, collection);

  return await this.store.get(key);
};

Oracle.prototype._PATCH = async function (key, changes) {
  var obj = this.store.get(key);
  var result = _.merge(obj, changes);
  await this.store.set(key, result);
  return await this.store.get(key);
};

Oracle.prototype._DELETE = async function (key) {
  await this.store.set(key, null);
  return null;
};

Oracle.prototype._OPTIONS = async function (key) {
  var object = await this.store.get(key);
  var vector = new Vector(object);
  
  vector._sign();
  
  
  return vector;
};

module.exports = Oracle;
