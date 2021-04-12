'use strict';

const Actor = require('./actor');
const Hash256 = require('./hash256');
const merge = require('lodash.merge');
const { MerkleTree } = require('merkletreejs');

class Tree extends Actor {
  constructor (settings = {}) {
    super(settings);

    if (settings instanceof Array) settings = { leaves: settings };

    this.settings = merge({
      leaves: []
    }, this.settings, settings);

    this._tree = new MerkleTree(this.settings.leaves, Hash256.digest, {
      isBitcoinTree: true
    });

    return this;
  }

  get root () {
    return this._tree.getRoot();
  }
}

module.exports = Tree;
