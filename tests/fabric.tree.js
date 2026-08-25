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

  describe('Tree proof edge cases', function () {
    const B = (byte) => Buffer.from(byte.repeat(32), 'hex');
    const sorted = () => new Tree({ leaves: [B('11'), B('33'), B('55'), B('77')], sortLeaves: true });

    it('exposes leaf count alongside the merkled leaves', function () {
      const tree = sorted();
      assert.strictEqual(tree.leafCount, 4);
      assert.strictEqual(tree.getLeaves().length, 4);
    });

    it('refuses non-inclusion proofs when leaves are not sorted', function () {
      // Adjacency is only meaningful over a lexicographic ordering.
      const unsorted = new Tree({ leaves: [B('11'), B('33')] });
      assert.throws(() => unsorted.proveNonInclusion(B('22')), /sortLeaves/);
    });

    it('proves and verifies non-inclusion against an empty tree', function () {
      const empty = new Tree({ leaves: [], sortLeaves: true });
      const doc = empty.proveNonInclusion(B('44'));
      assert.strictEqual(doc.side, 'empty');
      assert.strictEqual(doc.empty, true);
      assert.strictEqual(doc.leafCount, 0);
      assert.strictEqual(doc.left, null);
      assert.strictEqual(doc.right, null);
      assert.strictEqual(empty.verifyNonInclusion(doc), true);
      // An empty claim must not verify against a populated commitment.
      assert.strictEqual(sorted().verifyNonInclusion(doc, { root: sorted().rootHex, leafCount: 4 }), false);
    });

    it('reports side "included" for a present leaf and refuses it as non-inclusion', function () {
      const tree = sorted();
      const doc = tree.proveNonInclusion(B('55'));
      assert.strictEqual(doc.side, 'included');
      assert.strictEqual(doc.included, true);
      assert.strictEqual(tree.verifyNonInclusion(doc), false);
    });

    it('rejects an unrecognised side', function () {
      const tree = sorted();
      assert.strictEqual(tree.verifyNonInclusion({
        side: 'sideways',
        target: '22'.repeat(32),
        root: tree.rootHex,
        leafCount: 4
      }), false);
    });

    it('handles plain string leaves and duplicates', function () {
      const tree = new Tree({ leaves: ['b', 'a', 'a', 'c'], sortLeaves: true });
      assert.strictEqual(tree.leafCount, 4);
      assert.strictEqual(tree.rootHex.length, 64);
      const doc = tree.proveNonInclusion('bb');
      assert.strictEqual(doc.side, 'between');
      assert.strictEqual(tree.verifyNonInclusion(doc), true);
    });

    it('returns an unincluded proof for a leaf outside the tree', function () {
      const doc = sorted().proveInclusion(B('99'));
      assert.strictEqual(doc.included, false);
      assert.deepStrictEqual(doc.proof, []);
    });

    it('verify honours an explicit root and rejects an empty one', function () {
      const tree = sorted();
      const leaf = B('55');
      const proof = tree.getProof(leaf);
      assert.strictEqual(tree.verify(proof, leaf, tree.rootHex), true);
      assert.strictEqual(tree.verify(proof, leaf, ''), false);
      assert.strictEqual(new Tree().verify([], leaf), false);
    });

    it('falls back to the instance verifier when the static is unusable', function () {
      // Compatibility path for merkletreejs builds without MerkleTree.verify.
      const { MerkleTree } = require('merkletreejs');
      const tree = sorted();
      const leaf = B('55');
      const proof = tree.getProof(leaf);
      const original = MerkleTree.verify;
      try {
        MerkleTree.verify = () => { throw new Error('static unavailable'); };
        assert.strictEqual(tree.verify(proof, leaf), true);
        MerkleTree.verify = undefined;
        assert.strictEqual(tree.verify(proof, leaf), true);
      } finally {
        MerkleTree.verify = original;
      }
    });

    it('fails closed when both verifiers throw', function () {
      const { MerkleTree } = require('merkletreejs');
      const tree = sorted();
      const leaf = B('55');
      const proof = tree.getProof(leaf);
      const original = MerkleTree.verify;
      try {
        MerkleTree.verify = () => { throw new Error('static unavailable'); };
        tree._tree.verify = () => { throw new Error('instance unavailable'); };
        // A throwing verifier is an unproven leaf, not a raised exception.
        assert.strictEqual(tree.verify(proof, leaf), false);
      } finally {
        MerkleTree.verify = original;
      }
    });

    it('fails closed when proof construction throws', function () {
      const tree = sorted();
      tree._tree.getProof = () => { throw new Error('no proof'); };
      const doc = tree.proveInclusion(B('55'));
      assert.strictEqual(doc.included, false);
      assert.deepStrictEqual(doc.proof, []);
    });
  });

  describe('Tree non-inclusion verification is adversarial', function () {
    const B = (byte) => Buffer.from(byte.repeat(32), 'hex');
    const clone = (doc) => JSON.parse(JSON.stringify(doc));
    let tree;
    let gap;

    beforeEach(function () {
      tree = new Tree({ leaves: [B('11'), B('33'), B('55'), B('77')], sortLeaves: true });
      gap = tree.proveNonInclusion(B('44'));
      assert.strictEqual(tree.verifyNonInclusion(gap), true);
    });

    it('rejects a tampered root or leaf count', function () {
      assert.strictEqual(tree.verifyNonInclusion(Object.assign(clone(gap), { root: 'ab'.repeat(32) })), false);
      assert.strictEqual(tree.verifyNonInclusion(Object.assign(clone(gap), { leafCount: 3 })), false);
      // A committed count that disagrees with the document is also fatal: the
      // merkle root alone does not commit the leaf count.
      assert.strictEqual(tree.verifyNonInclusion(gap, { leafCount: 99 }), false);
    });

    it('rejects a leaf set whose size disagrees with the commitment', function () {
      assert.strictEqual(tree.verifyNonInclusion(gap, { leaves: [B('11'), B('33')] }), false);
    });

    it('rejects neighbours that skip an in-range leaf', function () {
      // Claiming the gap spans 0x11..0x77 would hide 0x33 and 0x55.
      const widened = clone(gap);
      widened.left = clone(tree.proveInclusion(B('11')));
      widened.right = clone(tree.proveInclusion(B('77')));
      assert.strictEqual(tree.verifyNonInclusion(widened), false);
    });

    it('rejects a target outside the claimed gap', function () {
      assert.strictEqual(tree.verifyNonInclusion(Object.assign(clone(gap), {
        target: '99'.repeat(32)
      })), false);
    });

    it('rejects stray or missing neighbours for the declared side', function () {
      assert.strictEqual(tree.verifyNonInclusion(Object.assign(clone(gap), { left: null })), false);
      assert.strictEqual(tree.verifyNonInclusion(Object.assign(clone(gap), { right: null })), false);

      const after = clone(tree.proveNonInclusion(B('ff')));
      assert.strictEqual(after.side, 'after');
      assert.strictEqual(tree.verifyNonInclusion(Object.assign(clone(after), { right: clone(gap.right) })), false);

      const before = clone(tree.proveNonInclusion(B('00')));
      assert.strictEqual(before.side, 'before');
      assert.strictEqual(tree.verifyNonInclusion(Object.assign(clone(before), { left: clone(gap.left) })), false);
    });

    it('rejects a document that claims inclusion, and non-objects', function () {
      assert.strictEqual(tree.verifyNonInclusion(Object.assign(clone(gap), { included: true })), false);
      assert.strictEqual(tree.verifyNonInclusion(null), false);
      assert.strictEqual(tree.verifyNonInclusion('nope'), false);
    });

    it('rejects an inclusion document that names a foreign root', function () {
      // A prover that picks its own commitment can always satisfy its own proof,
      // so a self-consistent document is not membership in *this* tree.
      const attacker = new Tree({ leaves: [B('aa'), B('bb')], sortLeaves: true });
      const forged = clone(attacker.proveInclusion(B('aa')));
      assert.strictEqual(attacker.verifyInclusion(forged), true);
      assert.notStrictEqual(forged.root, tree.rootHex);
      assert.strictEqual(tree.verifyInclusion(forged), false);
      // An explicitly supplied root stays an intentional override.
      assert.strictEqual(tree.verifyInclusion(forged, attacker.rootHex), true);
      // A document that disagrees with the root it is checked against is fatal.
      assert.strictEqual(tree.verifyInclusion(Object.assign(clone(gap.left), {
        root: 'ab'.repeat(32)
      })), false);
    });

    it('accepts a between document whose left neighbour is duplicated', function () {
      // Duplicate leaves are allowed, so adjacency must use the boundary
      // occurrence rather than the first one.
      const dupes = new Tree({ leaves: [B('11'), B('33'), B('33'), B('77')], sortLeaves: true });
      const doc = dupes.proveNonInclusion(B('44'));
      assert.strictEqual(doc.side, 'between');
      assert.strictEqual(dupes.verifyNonInclusion(doc), true);
    });
  });
});
