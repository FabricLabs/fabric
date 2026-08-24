'use strict';

// Dependencies
const merge = require('lodash.merge');
const { MerkleTree } = require('merkletreejs');

// Fabric Types
const Actor = require('./actor');
const Hash256 = require('./hash256');

/**
 * @param {*} leaf
 * @returns {string}
 * @private
 */
function leafKey (leaf) {
  if (Buffer.isBuffer(leaf) || leaf instanceof Uint8Array) {
    return Buffer.from(leaf).toString('hex');
  }
  return String(leaf);
}

/**
 * @param {Array} leaves
 * @returns {Array}
 * @private
 */
function sortLeafList (leaves) {
  return (leaves || []).slice().sort((a, b) => {
    const ha = leafKey(a);
    const hb = leafKey(b);
    if (ha < hb) return -1;
    if (ha > hb) return 1;
    return 0;
  });
}

/**
 * @param {Array} proof
 * @returns {Array<{ position: string, data: string }>}
 * @private
 */
function serializeProof (proof) {
  return (proof || []).map((step) => {
    const data = step && step.data;
    const hex = Buffer.isBuffer(data)
      ? data.toString('hex')
      : (typeof data === 'string' ? data : Buffer.from(data || []).toString('hex'));
    return {
      position: step && step.position ? String(step.position) : 'right',
      data: hex
    };
  });
}

/**
 * @param {Array} proof
 * @returns {Array}
 * @private
 */
function deserializeProof (proof) {
  return (proof || []).map((step) => {
    const data = step && step.data;
    return {
      position: step && step.position ? String(step.position) : 'right',
      data: Buffer.isBuffer(data)
        ? data
        : Buffer.from(String(data || ''), /^[0-9a-f]*$/i.test(String(data || '')) ? 'hex' : 'utf8')
    };
  });
}

/**
 * Restore a leaf for merkletreejs verify. 64-hex → 32-byte Buffer; else original string.
 * @param {*} serialized
 * @returns {string|Buffer}
 * @private
 */
function restoreLeaf (serialized) {
  if (Buffer.isBuffer(serialized) || serialized instanceof Uint8Array) {
    return Buffer.from(serialized);
  }
  const s = String(serialized);
  if (/^[0-9a-f]{64}$/i.test(s)) return Buffer.from(s, 'hex');
  return s;
}

/**
 * Class implementing a Bitcoin-compatible Merkle Tree (`merkletreejs` +
 * {@link Hash256.digest}, odd-leaf duplication). Optional `sortLeaves` makes
 * the leaf order lexicographic so adjacent-leaf **non-inclusion** proofs are
 * well-defined (inclusion proofs work either way).
 */
class Tree extends Actor {
  /**
   * Create an instance of a Tree.
   * @param {Object|Array} [settings] Configuration, or an array of leaves.
   * @param {Array} [settings.leaves]
   * @param {boolean} [settings.sortLeaves] When true, leaves are sorted before
   * merkling (required for {@link Tree#proveNonInclusion}).
   * @returns {Tree} Instance of the tree.
   */
  constructor (settings = {}) {
    super(settings);

    if (settings instanceof Array) settings = { leaves: settings };

    this.settings = merge({
      leaves: [],
      sortLeaves: false
    }, this.settings, settings);

    this._rebuild();

    this._state = {
      root: this.root
    };

    return this;
  }

  /**
   * @private
   */
  _rebuild () {
    const source = this.settings.leaves || [];
    const leaves = this.settings.sortLeaves ? sortLeafList(source) : source;
    this._tree = new MerkleTree(leaves, Hash256.digest, {
      isBitcoinTree: true
    });
    if (this._state) this._state.root = this.root;
  }

  get root () {
    return this._tree.getRoot();
  }

  get leafCount () {
    return (this.settings.leaves || []).length;
  }

  /**
   * Add a leaf to the tree (accumulates into `settings.leaves`).
   * @param {String|Buffer} leaf Leaf to add to the tree.
   * @returns {Tree} Instance of the tree.
   */
  addLeaf (leaf = '') {
    this.settings.leaves = (this.settings.leaves || []).concat([leaf]);
    this._rebuild();
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

  /**
   * Bitcoin-style merkle inclusion branch for `leaf` (same object/bytes as constructed).
   * @param {String|Buffer} leaf
   * @returns {Array}
   */
  getProof (leaf) {
    if (!this._tree || !this.leafCount) return [];
    return this._tree.getProof(restoreLeaf(leaf));
  }

  /**
   * Verify an inclusion branch against this tree's root (or a supplied root).
   * @param {Array} proof
   * @param {String|Buffer} leaf
   * @param {Buffer|string} [root]
   * @returns {boolean}
   */
  verify (proof, leaf, root) {
    const r = root != null
      ? (Buffer.isBuffer(root) ? root : Buffer.from(String(root), 'hex'))
      : this.root;
    if (!r || !r.length) return false;
    const steps = Array.isArray(proof) ? proof : [];
    try {
      if (typeof MerkleTree.verify === 'function') {
        return !!MerkleTree.verify(steps, restoreLeaf(leaf), r, Hash256.digest, {
          isBitcoinTree: true
        });
      }
    } catch (_) { /* fall through */ }
    if (!this._tree) return false;
    try {
      return !!this._tree.verify(steps, restoreLeaf(leaf), r);
    } catch (_) {
      return false;
    }
  }

  /**
   * JSON inclusion proof (hex siblings). `included` is false when verify fails.
   * @param {String|Buffer} leaf
   * @returns {object}
   */
  proveInclusion (leaf) {
    let proof = [];
    try {
      proof = this.getProof(leaf);
    } catch (_) {
      proof = [];
    }
    const ok = this.verify(proof, leaf);
    return {
      included: ok,
      leaf: leafKey(restoreLeaf(leaf)),
      root: this.rootHex,
      leafCount: this.leafCount,
      proof: serializeProof(proof)
    };
  }

  /**
   * Verify a {@link Tree#proveInclusion} object against this tree or a given root.
   * @param {object} doc
   * @param {string} [rootHex]
   * @returns {boolean}
   */
  verifyInclusion (doc, rootHex) {
    if (!doc || typeof doc !== 'object') return false;
    const proof = deserializeProof(doc.proof);
    const root = rootHex || doc.root || this.rootHex;
    if (!root) return false;
    return this.verify(proof, doc.leaf, root);
  }

  /**
   * Sorted-leaf non-inclusion proof. Requires `sortLeaves: true` so adjacency
   * is lexicographic. Bind `(root, leafCount)` from a signed collection /
   * activity tree — the merkle root alone does not commit the count.
   * @param {String|Buffer} leaf
   * @returns {object}
   */
  proveNonInclusion (leaf) {
    if (!this.settings.sortLeaves) {
      throw new Error('Tree.proveNonInclusion requires sortLeaves: true');
    }
    const target = leafKey(restoreLeaf(leaf));
    const sorted = sortLeafList(this.settings.leaves || []);
    const hexes = sorted.map(leafKey);
    const root = this.rootHex;
    const leafCount = hexes.length;

    if (!leafCount) {
      return {
        included: false,
        empty: true,
        side: 'empty',
        target,
        root,
        leafCount: 0,
        left: null,
        right: null
      };
    }

    let lo = 0;
    let hi = hexes.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (hexes[mid] < target) lo = mid + 1;
      else hi = mid;
    }

    if (lo < hexes.length && hexes[lo] === target) {
      const found = sorted[lo];
      return Object.assign({ side: 'included', target }, this.proveInclusion(found));
    }

    if (lo === 0) {
      const rightLeaf = sorted[0];
      return {
        included: false,
        empty: false,
        side: 'before',
        target,
        root,
        leafCount,
        left: null,
        right: this.proveInclusion(rightLeaf)
      };
    }
    if (lo === hexes.length) {
      const leftLeaf = sorted[hexes.length - 1];
      return {
        included: false,
        empty: false,
        side: 'after',
        target,
        root,
        leafCount,
        left: this.proveInclusion(leftLeaf),
        right: null
      };
    }

    const leftLeaf = sorted[lo - 1];
    const rightLeaf = sorted[lo];
    return {
      included: false,
      empty: false,
      side: 'between',
      target,
      root,
      leafCount,
      leftIndex: lo - 1,
      rightIndex: lo,
      left: this.proveInclusion(leftLeaf),
      right: this.proveInclusion(rightLeaf)
    };
  }

  /**
   * Verify a {@link Tree#proveNonInclusion} document. Adjacency is checked
   * against this tree's sorted leaves (or <code>opts.leaves</code>) so a
   * prover cannot skip an in-range leaf. Compact root-only verification
   * without the leaf set is not supported.
   * @param {object} doc
   * @param {Object} [opts]
   * @param {string} [opts.root] committed merkle root hex
   * @param {number} [opts.leafCount] committed leaf count
   * @param {Array} [opts.leaves] ordered or unordered leaf set (sorted here)
   * @returns {boolean}
   */
  verifyNonInclusion (doc, opts = {}) {
    if (!doc || typeof doc !== 'object') return false;
    if (doc.included === true) return false;
    const root = opts.root != null ? String(opts.root) : String(doc.root || '');
    const leafCount = opts.leafCount != null ? Number(opts.leafCount) : Number(doc.leafCount);
    const target = leafKey(restoreLeaf(doc.target));
    if (!target) return false;

    if (doc.side === 'empty' || doc.empty === true) {
      return leafCount === 0 && (root === '' || !root);
    }
    if (!root || !Number.isFinite(leafCount) || leafCount < 1) return false;
    if (String(doc.root) !== root) return false;
    if (Number(doc.leafCount) !== leafCount) return false;

    const source = Array.isArray(opts.leaves) ? opts.leaves : this.settings.leaves;
    const hexes = sortLeafList(source || []).map(leafKey);
    if (hexes.length !== leafCount) return false;
    if (this.rootHex && this.rootHex !== root && !opts.leaves) return false;

    if (doc.side === 'before') {
      if (!doc.right || doc.left) return false;
      if (!this.verifyInclusion(doc.right, root)) return false;
      const rightKey = leafKey(restoreLeaf(doc.right.leaf));
      return hexes[0] === rightKey && target < rightKey;
    }
    if (doc.side === 'after') {
      if (!doc.left || doc.right) return false;
      if (!this.verifyInclusion(doc.left, root)) return false;
      const leftKey = leafKey(restoreLeaf(doc.left.leaf));
      return hexes[leafCount - 1] === leftKey && target > leftKey;
    }
    if (doc.side === 'between') {
      if (!doc.left || !doc.right) return false;
      if (!this.verifyInclusion(doc.left, root)) return false;
      if (!this.verifyInclusion(doc.right, root)) return false;
      const leftKey = leafKey(restoreLeaf(doc.left.leaf));
      const rightKey = leafKey(restoreLeaf(doc.right.leaf));
      if (!(leftKey < target && target < rightKey)) return false;
      const i = hexes.indexOf(leftKey);
      return i >= 0 && hexes[i + 1] === rightKey;
    }
    return false;
  }
}

Tree.serializeProof = serializeProof;
Tree.deserializeProof = deserializeProof;

module.exports = Tree;
