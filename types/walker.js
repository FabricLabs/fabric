'use strict';

const util = require('util');
const path = require('path');
const fs = require('fs');

/**
 * The Walker explores a directory tree and maps it to memory.
 * @param       {Vector} init - Initial state tree.
 * @constructor
 */
function Walker (init) {
  this['@data'] = init || {};
  this.clock = 0;
  this.stack = [];
  this.known = {};

  // this.store = new Store();

  this.init();
}

util.inherits(Walker, require('./vector'));

/**
 * Explores a directory tree on the local system's disk.
 * @param  {String} path      [description]
 * @param  {Object} [map={}] [description]
 * @return {Object}          [description]
 */
Walker.prototype._explore = function crawl (path, map = {}) {
  const self = this;

  fs.readdirSync(path).forEach(file => {
    const filePath = path.join(path, file);
    const isDir = fs.statSync(filePath).isDirectory();
    const content = (isDir) ? self._explore(filePath) : fs.readFileSync(filePath);

    map[file] = content;
  });

  return map;
};

/**
 * Explores a directory tree on the local system's disk.
 * @param  {String} dir      Path to crawl on local disk.
 * @param  {Object} [map={}] Pointer to previous step in stack.
 * @return {Object}          A hashmap of directory contents.
 */
Walker.prototype._define = async function crawl (dir, map = {}) {
  const self = this;
  var list = [];

  if (dir instanceof Array) {
    list = dir.map(function (x) {
      return path.join('./assets', x);
    });
  } else {
    list = fs.readdirSync(dir).map(function (x) {
      return path.join(dir, x);
    });
  }

  for (var i = 0; i < list.length; i++) {
    let file = list[i];
    let isDir = fs.statSync(file).isDirectory();
    let content = (isDir) ? await self._define(file, map) : fs.readFileSync(file);
    let result = content.toString('utf8');

    map[file] = result;
  }

  return map;
};

module.exports = Walker;
