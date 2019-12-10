'use strict';

const DepTree = require('dependency-tree');

class TypeTree {
  constructor (settings = {}) {
    this.settings = Object.assign({}, settings);
    this.tree = null;
    return this;
  }

  _loadFile (name) {
    this.tree = DepTree({
      filename: name
    });
  }
}

module.exports = TypeTree;
