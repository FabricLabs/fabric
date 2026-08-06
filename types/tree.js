'use strict';

// Dependencies
const merge = require('lodash.merge');
const { MerkleTree } = require('merkletreejs');

// Fabric Types
const Actor = require('./actor');
const Hash256 = require('./hash256');

/**
 * Class implementing a Merkle Tree.
 */
class Tree extends Actor {
  /**
   * Create an instance of a Tree.
   * @param {Object} [settings] Configuration.
   * @returns {Tree} Instance of the tree.
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
   * Add a leaf to the tree (accumulates into `settings.leaves`).
   * @param {String|Buffer} leaf Leaf to add to the tree.
   * @returns {Tree} Instance of the tree.
   */
  addLeaf (leaf = '') {
    this.settings.leaves = (this.settings.leaves || []).concat([leaf]);
    this._tree = new MerkleTree(this.settings.leaves, Hash256.digest, {
      isBitcoinTree: true
    });
    this._state = this._state || {};
    this._state.root = this.root;

    this.emit('leaf', leaf);

    return this;
  }

  /**
   * Hex encoding of {@link Tree#root} (empty string when the tree has no root bytes).
   * @returns {string}
   */
  get rootHex () {
    const root = this.root;
    if (!root || !root.length) return '';
    return Buffer.isBuffer(root) ? root.toString('hex') : String(root);
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
