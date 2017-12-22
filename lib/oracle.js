'use strict';

var util = require('util');
var path = require('path');

var Storage = require('./storage');
var Walker = require('./walker');
var Vector = require('./vector');

var _ = require('./functions');

/**
 * Trusted point-of-reference for external services.
 * @param       {Object} initial - Initialization vector.
 * @constructor
 */
function Oracle (init) {
  this['@data'] = init || {};
  this.clock = 0;
  this.stack = [];
  this.known = {};

  this.storage = new Storage(init);

  this.init();
}

util.inherits(Oracle, Vector);

/**
 * Synchronously reads a local path into memory.
 * @param  {String} path - dir (path to read)
 * @return {Vector} Computed vector.
 */
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

    var obj = self._identify({
      '@data': content
    });

    console.log('[ORACLE]', 'saving:', content.length, 'bytes to', file);
    let result = await self.storage.set(file, content);
  }

  var tree = list.map(function (x) {
    return x.replace(/^(.*)\/(.*)$/, '$2');
  });

  await self._PUT('/assets', tree);

  self.tree = map;

  try {
    var result = await self._GET('/assets');
    var vector = new Vector(JSON.parse(result));
    await vector.compute();
  } catch (e) {
    console.error('[ORACLE]', 'exception:', e);
  }

  console.log('[ORACLE]', 'loaded:', list.length, 'resources from', dir);

  return vector;
};

Oracle.prototype._GET = async function (key, params) {
  return await this.storage.get(key);
};

Oracle.prototype._PUT = async function (key, obj) {
  await this.storage.set(key, obj);
  return await this.storage.get(key);
};

Oracle.prototype._POST = async function (key, obj) {
  var collection = await this.storage.get(key);
  if (!collection || !(collection instanceof Array)) collection = [];

  collection.push(obj);

  var result = await this.storage.set(key, collection);

  return await this.storage.get(key);
};

Oracle.prototype._PATCH = async function (key, changes) {
  var obj = this.storage.get(key);
  // TODO: remove lodash
  var result = _.merge(obj, changes);
  await this.storage.set(key, result);
  return await this.storage.get(key);
};

Oracle.prototype._DELETE = async function (key) {
  await this.storage.set(key, null);
  return null;
};

Oracle.prototype._OPTIONS = async function (key) {
  var data = await this._GET(key);

  try {
    var object = JSON.parse(data);
  } catch (e) {
    var object = data;
  }

  var vector = new Vector(object);

  vector._sign();

  return vector;
};

module.exports = Oracle;
