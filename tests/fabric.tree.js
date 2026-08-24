'use strict';

const Tree = require('../types/tree');
const assert = require('assert');

describe('@fabric/core/types/tree', function () {
  describe('Tree', function () {
    it('is available from @fabric/core', function () {
      assert.strictEqual(Tree instanceof Function, true);
    });

    it('can construct an empty tree', async function () {
      let tree = new Tree();
      assert.ok(tree);
      assert.ok(tree._tree);
      assert.ok(tree.root);
      // merkletreejs + isBitcoinTree: no leaves → empty Buffer (hex '').
      assert.strictEqual(tree.root.toString('hex'), '');
    });

    it('can construct a known tree', async function () {
      let tree = new Tree(['foo', 'bar']);
      assert.ok(tree);
      assert.ok(tree._tree);
      // Bitcoin-style merkle of string leaves ['foo','bar'] via Hash256.digest.
      assert.strictEqual(tree.root.toString('hex'), '906b5aaf65ae98f8c98848de5e81ba865659f16fd53aefa4c78b34176f068079');
    });

    it('addLeaf accumulates leaves for growing merkle roots', function () {
      const tree = new Tree({ leaves: [] });
      tree.addLeaf('a');
      tree.addLeaf('b');
      tree.addLeaf('c');
      assert.strictEqual(tree.settings.leaves.length, 3);
      const rebuilt = new Tree(['a', 'b', 'c']);
      assert.strictEqual(tree.rootHex, rebuilt.rootHex);
      assert.ok(tree.rootHex.length === 64);
    });

    it('proves inclusion and sorted non-inclusion over 32-byte leaves', function () {
      const leaves = [
        Buffer.from('11'.repeat(32), 'hex'),
        Buffer.from('33'.repeat(32), 'hex'),
        Buffer.from('55'.repeat(32), 'hex'),
        Buffer.from('77'.repeat(32), 'hex')
      ];
      const tree = new Tree({ leaves, sortLeaves: true });
      const hit = tree.proveInclusion(leaves[2]);
      assert.strictEqual(hit.included, true);
      assert.ok(tree.verifyInclusion(hit));

      const missing = Buffer.from('44'.repeat(32), 'hex');
      const gap = tree.proveNonInclusion(missing);
      assert.strictEqual(gap.included, false);
      assert.strictEqual(gap.side, 'between');
      assert.ok(tree.verifyNonInclusion(gap));

      const before = tree.proveNonInclusion(Buffer.from('00'.repeat(32), 'hex'));
      assert.strictEqual(before.side, 'before');
      assert.ok(tree.verifyNonInclusion(before));

      const after = tree.proveNonInclusion(Buffer.from('ff'.repeat(32), 'hex'));
      assert.strictEqual(after.side, 'after');
      assert.ok(tree.verifyNonInclusion(after));

      const spoof = Object.assign({}, gap, { side: 'before', left: null, right: gap.right });
      assert.strictEqual(tree.verifyNonInclusion(spoof), false);
    });
  });
});
