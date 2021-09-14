'use strict';

const Actor = require('./actor');
const Hash256 = require('./hash256');
const merge = require('lodash.merge');
const { MerkleTree } = require('merkletreejs');

/**
 * Class implementing a Merkle Tree.
 */
class Tree extends Actor {
  /**
   * Create an instance of a Tree.
   * @param {Object} [settings] Configuration.
   * @returns {Tree}
   */
  constructor (settings = {}) {
    super(settings);

    if (settings instanceof Array) settings = { leaves: settings };

    this.settings = merge({
      leaves: []
    }, this.settings, settings);

    this._tree = new MerkleTree(this.settings.leaves, Hash256.digest, {
      isBitcoinTree: true
    });

    this._state = {
      root: this.root
    };

    return this;
  }

  get root () {
    return this._tree.getRoot();
  }

  /**
   * Add a leaf to the tree.
   * @param {String} leaf Leaf to add to the tree.
   * @returns {Tree}
   */
  addLeaf (leaf = '') {
    this._tree = new MerkleTree(this.settings.leaves.concat([
      leaf
    ]), Hash256.digest, {
      isBitcoinTree: true
    });

    this.emit('leaf', leaf);

    return this;
  }

  /**
   * Get a list of the {@link Tree}'s leaves.
   * @returns {Array} A list of the {@link Tree}'s leaves.
   */
  getLeaves () {
    return this._tree.getLeaves();
  }
}

module.exports = Tree;
