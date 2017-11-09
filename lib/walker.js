'use strict';

const util = require('util');
const path = require('path');
const fs = require('fs');

function Walker (init) {
  this['@data'] = init || {};
  this.clock = 0;
  this.stack = [];
  this.known = {};
  
  //this.store = new Store();
  
  this.init();
}

util.inherits(Walker, require('./vector'));

Walker.prototype._explore = function crawl (dir, map = {}) {
  const self = this;

  fs.readdirSync(dir).forEach(file => {
    const filePath = path.join(dir, file);
    const isDir = fs.statSync(filePath).isDirectory();
    const content = (isDir) ? self._explore(filePath) : fs.readFileSync(filePath);

    map[file] = content;
  });

  return map;
};

Walker.prototype._define = async function crawl (dir, map = {}) {
  const self = this;
  const list = fs.readdirSync(dir);
  
  for (var i = 0; i < list.length; i++) {
    let file = list[i];
    let filePath = path.join(dir, file);
    let isDir = fs.statSync(filePath).isDirectory();
    let content = (isDir) ? self._define(filePath, map) : fs.readFileSync(filePath);
    let result = content.toString('utf8');

    map[filePath] = result;
  }

  return map;
};

module.exports = Walker;
