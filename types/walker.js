'use strict';

const util = require('util');
const path = require('path');
const fs = require('fs');

function Walker (init) {
  this['@data'] = init || {};
  this.clock = 0;
  this.stack = [];
  this.known = {};

  // this.store = new Store();

  this.init();
}

util.inherits(Walker, require('./vector'));

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
