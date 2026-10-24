'use strict';

// Dependencies
const merge = require('lodash.merge');
const { sha256 } = require('@noble/hashes/sha2.js');

// Fabric Types
const Actor = require('./actor');

const HEX_PATTERN = /^(0x)?[0-9A-Fa-f]*$/;

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
 * Restore a leaf for proof lookup / verify. 64-hex → 32-byte Buffer; else original string.
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
 * @param {string} hex
 * @returns {string}
 * @private
 */
function evenHex (hex) {
  return hex.length % 2 ? `0${hex}` : hex;
}

/**
 * @param {Uint8Array} bytes
 * @returns {Buffer} reversed copy
 * @private
 */
function reversed (bytes) {
  return Buffer.from(bytes).reverse();
}

/**
 * Bytes of a leaf or proof node. Strings that look like hex (optional `0x`,
 * odd length left-padded) decode as hex, so `'a'` is `0x0a`; other strings
 * are UTF-8. Bigints are their hex value; numbers are their decimal digits
 * read as hex (`12` → `0x12`). Typed arrays share their memory.
 * @param {*} value
 * @returns {Buffer}
 * @private
 */
function toMerkleBuffer (value) {
  if (Buffer.isBuffer(value)) return value;
  if (typeof value === 'string') {
    if (HEX_PATTERN.test(value)) return Buffer.from(evenHex(value.replace('0x', '')), 'hex');
    return Buffer.from(value, 'utf8');
  }
  if (typeof value === 'bigint') return Buffer.from(evenHex(value.toString(16)), 'hex');
  if (typeof value === 'number') return Buffer.from(evenHex(value.toString()), 'hex');
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  throw new TypeError(`Merkle nodes are bytes, strings, or numbers, not ${value === null ? 'null' : typeof value}`);
}

/**
 * Parent of two display-order nodes: `reverse(SHA256d(reverse(left) || reverse(right)))`.
 * @param {Uint8Array} left
 * @param {Uint8Array} right
 * @returns {Buffer}
 * @private
 */
function merkleParent (left, right) {
  return reversed(sha256(sha256(Buffer.concat([reversed(left), reversed(right)]))));
}

/**
 * Every layer, leaves first and the root layer last. An odd last node is
 * paired with itself.
 *
 * `mutated` (CVE-2012-2459): some layer of even length ≥ 4 ends in two equal
 * nodes, i.e. it is the self-paired form of the odd layer one node shorter,
 * so a shorter leaf list (`[a, b, c]` for `[a, b, c, c]`) commits to the same
 * root. Only the padded list is flagged; the shortest form of a root, and
 * repeated leaves anywhere else (a file of identical chunks), are not. This
 * is narrower than Bitcoin Core's check, which also flags any equal pair
 * because a block may never repeat a transaction.
 * @param {Buffer[]} leaves
 * @returns {{ layers: Buffer[][], mutated: boolean }}
 * @private
 */
function merkleLayers (leaves) {
  const layers = [leaves];
  let nodes = leaves;
  let mutated = false;
  while (nodes.length > 1) {
    const n = nodes.length;
    if (n >= 4 && n % 2 === 0 && Buffer.compare(nodes[n - 2], nodes[n - 1]) === 0) mutated = true;
    const next = [];
    for (let i = 0; i < nodes.length; i += 2) {
      next.push(merkleParent(nodes[i], i + 1 < nodes.length ? nodes[i + 1] : nodes[i]));
    }
    layers.push(next);
    nodes = next;
  }
  return { layers, mutated };
}

/**
 * Class implementing a Bitcoin Merkle Tree in display (RPC) byte order:
 * SHA256d parents over byte-reversed children, and an odd last node paired
 * with itself. Txid leaves in block order give the block header's
 * `merkle_root`; one leaf is its own root and no leaves give an empty root.
 * Leaf encoding, proofs, and verification match `merkletreejs`
 * `isBitcoinTree` (which this replaced), so earlier roots are unchanged.
 * Optional `sortLeaves` makes the leaf order lexicographic so adjacent-leaf
 * **non-inclusion** proofs are well-defined (inclusion proofs work either way).
 *
 * Like Bitcoin's, the root does not commit the leaf count: `[a, b, c]` and
 * `[a, b, c, c]` share a root. {@link Tree#mutated} flags such leaf lists and
 * `rejectMutated: true` refuses them; callers that accept leaves from the
 * network must check one or the other and bind the count separately.
 */
class Tree extends Actor {
  /**
   * Create an instance of a Tree.
   * @param {Object|Array} [settings] Configuration, or an array of leaves.
   * @param {Array} [settings.leaves]
   * @param {boolean} [settings.sortLeaves] When true, leaves are sorted before
   * merkling (required for {@link Tree#proveNonInclusion}).
   * @param {boolean} [settings.rejectMutated] When true, building (or adding
   * a leaf to) a {@link Tree#mutated} tree throws.
   * @returns {Tree} Instance of the tree.
   */
  constructor (settings = {}) {
    super(settings);

    if (settings instanceof Array) settings = { leaves: settings };

    this.settings = merge({
      leaves: [],
      sortLeaves: false,
      rejectMutated: false
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
    const built = merkleLayers(Array.from(leaves, toMerkleBuffer));
    if (built.mutated && this.settings.rejectMutated) {
      throw new Error('Tree is mutated: another leaf list commits to the same root');
    }
    this._leaves = built.layers[0];
    this._layers = built.layers;
    this._mutated = built.mutated;
    if (this._state) this._state.root = this.root;
  }

  /**
   * True when a shorter leaf list has the same root: these leaves are the
   * self-paired padding of it (CVE-2012-2459).
   * @type {boolean}
   */
  get mutated () {
    return this._mutated;
  }

  /**
   * {@link Tree#mutated} for a leaf list without keeping the tree.
   * @param {Array} leaves
   * @returns {boolean}
   */
  static isMutated (leaves = []) {
    return merkleLayers(Array.from(leaves || [], toMerkleBuffer)).mutated;
  }

  /**
   * Display-order root (an empty Buffer when there are no leaves).
   * @returns {Buffer}
   */
  get root () {
    return this._layers[this._layers.length - 1][0] || Buffer.alloc(0);
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
    const prior = this.settings.leaves || [];
    this.settings.leaves = prior.concat([leaf]);
    try {
      this._rebuild();
    } catch (err) {
      this.settings.leaves = prior;
      throw err;
    }
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
    return this._leaves;
  }

  /**
   * Every layer of the tree, leaves first and the root layer last.
   * @returns {Buffer[][]}
   */
  getLayers () {
    return this._layers;
  }

  /**
   * Same as {@link Tree#root}.
   * @returns {Buffer}
   */
  getRoot () {
    return this.root;
  }

  /**
   * Bitcoin-style merkle inclusion branch for `leaf`, leaf to root. Without
   * an integer `index` the last leaf equal to `leaf` is proven; an unknown
   * leaf gives `[]`. An odd last node lists itself as its right sibling.
   * @param {String|Buffer} leaf
   * @param {number} [index] leaf position (skips the lookup)
   * @returns {Array<{ position: string, data: Buffer }>}
   */
  getProof (leaf, index) {
    if (!this.leafCount) return [];
    const target = toMerkleBuffer(restoreLeaf(leaf));
    if (!Number.isInteger(index)) {
      index = -1;
      for (let i = 0; i < this._leaves.length; i++) {
        if (Buffer.compare(target, this._leaves[i]) === 0) index = i;
      }
    }
    if (index <= -1) return [];

    const proof = [];
    for (let i = 0; i < this._layers.length; i++) {
      const layer = this._layers[i];
      const isRight = index % 2;
      const pairIndex = isRight
        ? index - 1
        : (index === layer.length - 1 && i < this._layers.length - 1 ? index : index + 1);
      if (pairIndex < layer.length) {
        proof.push({ position: isRight ? 'left' : 'right', data: layer[pairIndex] });
      }
      index = (index / 2) | 0;
    }
    return proof;
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
      return Tree.verifyProof(steps, restoreLeaf(leaf), r);
    } catch (_) {
      return false;
    }
  }

  /**
   * Check an inclusion branch against `root`. Each step is
   * `{ position: 'left'|'right', data }`, `[0|1, data]` (0 = left), or a bare
   * string / Buffer sibling on the left. A missing or empty-string leaf never
   * verifies; a malformed step throws `TypeError`.
   * @param {Array} proof sibling steps, leaf to root
   * @param {*} leaf
   * @param {(Buffer|string)} root
   * @returns {boolean}
   */
  static verifyProof (proof, leaf, root) {
    if (!Array.isArray(proof) || !leaf || root == null) return false;
    let hash = toMerkleBuffer(leaf);
    const expected = toMerkleBuffer(root);
    for (const step of proof) {
      let data;
      let left;
      if (typeof step === 'string') {
        data = toMerkleBuffer(step);
        left = true;
      } else if (Array.isArray(step)) {
        data = toMerkleBuffer(step[1]);
        left = step[0] === 0;
      } else if (Buffer.isBuffer(step)) {
        data = step;
        left = true;
      } else if (step instanceof Object) {
        data = toMerkleBuffer(step.data);
        left = step.position === 'left';
      } else {
        throw new TypeError('Expected node to be of type string or object');
      }
      hash = left ? merkleParent(data, hash) : merkleParent(hash, data);
    }
    return Buffer.compare(hash, expected) === 0;
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
    // The prover must not pick the commitment it is checked against: fall back to
    // this tree's root, and refuse a document that names a different one.
    const root = rootHex || this.rootHex || doc.root;
    if (!root) return false;
    if (doc.root && String(doc.root) !== String(root)) return false;
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
      // Duplicate leaves are accepted, so take the boundary occurrence next to
      // the gap rather than the first one.
      const i = hexes.lastIndexOf(leftKey);
      return i >= 0 && hexes[i + 1] === rightKey;
    }
    return false;
  }
}

Tree.serializeProof = serializeProof;
Tree.deserializeProof = deserializeProof;

module.exports = Tree;
