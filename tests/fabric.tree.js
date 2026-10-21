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
      assert.deepStrictEqual(tree.getLayers(), [[]]);
      assert.ok(tree.root);
      // No leaves → empty Buffer (hex '').
      assert.strictEqual(tree.root.toString('hex'), '');
    });

    it('gives a block header merkle_root from its txids', function () {
      const { blocks } = require('./fixtures/bitcoin-merkle.json');
      for (const block of blocks) {
        const tree = new Tree(block.txids);
        assert.strictEqual(tree.rootHex, block.merkleRoot, `block ${block.height}`);
        const index = block.txids.length - 1;
        const hit = tree.proveInclusion(block.txids[index]);
        assert.strictEqual(hit.included, true);
        assert.ok(tree.verifyInclusion(hit, block.merkleRoot));
      }
    });

    it('can construct a known tree', async function () {
      let tree = new Tree(['foo', 'bar']);
      assert.ok(tree);
      assert.strictEqual(tree.getLayers().length, 2);
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

    it('fails closed when the verifier throws', function () {
      const tree = sorted();
      const leaf = B('55');
      const proof = tree.getProof(leaf);
      const original = Tree.verifyProof;
      try {
        Tree.verifyProof = () => { throw new Error('verifier unavailable'); };
        // A throwing verifier is an unproven leaf, not a raised exception.
        assert.strictEqual(tree.verify(proof, leaf), false);
      } finally {
        Tree.verifyProof = original;
      }
    });

    it('fails closed on malformed proof steps', function () {
      const tree = sorted();
      const leaf = B('55');
      assert.strictEqual(tree.verify([42], leaf), false);
      assert.strictEqual(tree.verify([null], leaf), false);
      assert.strictEqual(tree.verify([{ position: 'left' }], leaf), false);
    });

    it('fails closed when proof construction throws', function () {
      const tree = sorted();
      tree.getProof = () => { throw new Error('no proof'); };
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

    it('accepts Uint8Array leaves and restores them through inclusion proofs', function () {
      const a = Uint8Array.from(Buffer.from('11'.repeat(32), 'hex'));
      const b = Uint8Array.from(Buffer.from('22'.repeat(32), 'hex'));
      const tree = new Tree({ leaves: [a, b], sortLeaves: true });
      assert.strictEqual(tree.leafCount, 2);
      const hit = tree.proveInclusion(a);
      assert.strictEqual(hit.included, true);
      assert.ok(tree.verifyInclusion(hit));
      assert.ok(Array.isArray(tree.getProof(a)));
    });

    it('deserializes non-hex proof step data as utf8 and defaults missing position', function () {
      const leaf = B('55');
      const hit = tree.proveInclusion(leaf);
      assert.ok(tree.verifyInclusion(hit));
      const cloned = clone(hit);
      assert.ok(tree.verifyInclusion(cloned));
      // Force utf8 deserialize path (non-hex) and missing position → 'right'.
      cloned.proof = [{ data: 'not-hex-bytes', position: undefined }];
      assert.strictEqual(
        Tree.deserializeProof(cloned.proof)[0].data.toString('utf8'),
        'not-hex-bytes'
      );
      assert.strictEqual(Tree.deserializeProof(cloned.proof)[0].position, 'right');
    });

    it('empty tree getProof is empty and foreign leaves are not included', function () {
      const empty = new Tree({ leaves: [], sortLeaves: true });
      assert.deepStrictEqual(empty.getProof(B('11')), []);
      const miss = tree.proveInclusion(B('99'));
      assert.strictEqual(miss.included, false);
    });
  });

  describe('Bitcoin Merkle tree', function () {
    const { sha256 } = require('@noble/hashes/sha2.js');
    const { merkleRootFromTxids, buildBranch } = require('../functions/bitcoinTxInclusion');
    const vectors = require('./fixtures/bitcoin-merkle.json');
    const steps = (proof) => proof.map((step) => [step.position, step.data.toString('hex')]);
    const reverse = (bytes) => Buffer.from(bytes).reverse();
    const parent = (left, right) => reverse(sha256(sha256(Buffer.concat([reverse(left), reverse(right)]))));
    const decode = (spec) => {
      if (typeof spec === 'string') return spec;
      if ('buffer' in spec) return Buffer.from(spec.buffer, 'hex');
      if ('number' in spec) return spec.number;
      throw new Error(`unknown leaf spec ${JSON.stringify(spec)}`);
    };

    for (const block of vectors.blocks) {
      it(`block ${block.height} (${block.txids.length} txs) proofs match the SPV branch for every tx`, function () {
        const tree = new Tree(block.txids);
        assert.strictEqual(tree.rootHex, block.merkleRoot);
        assert.strictEqual(merkleRootFromTxids(block.txids), block.merkleRoot);
        block.txids.forEach((txid, index) => {
          const proof = tree.getProof(txid, index);
          assert.deepStrictEqual(proof.map((step) => step.data.toString('hex')), buildBranch(block.txids, txid).branch);
          assert.strictEqual(Tree.verifyProof(proof, txid, block.merkleRoot), true);
        });
      });
    }

    for (const vector of vectors.cases) {
      it(`matches merkletreejs 0.6.0: ${vector.name}`, function () {
        const leaves = vector.leaves.map(decode);
        const tree = new Tree(leaves);
        assert.strictEqual(tree.root.toString('hex'), vector.root);
        const lookups = vector.lookups || vector.proofs;
        leaves.forEach((leaf, index) => {
          assert.deepStrictEqual(steps(tree.getProof(leaf, index)), vector.proofs[index], `proof ${index}`);
          assert.deepStrictEqual(steps(tree.getProof(leaf)), lookups[index], `lookup ${index}`);
          assert.strictEqual(Tree.verifyProof(tree.getProof(leaf, index), leaf, tree.root), vector.verified[index], `verify ${index}`);
        });
      });
    }

    it('has an empty root without leaves and the leaf itself for one', function () {
      assert.strictEqual(new Tree().getRoot().length, 0);
      const leaf = Buffer.alloc(32, 7);
      assert.ok(new Tree([leaf]).getRoot().equals(leaf));
    });

    it('pairs an odd last node with itself', function () {
      const [a, b, c] = [1, 2, 3].map((n) => Buffer.alloc(32, n));
      const tree = new Tree([a, b, c]);
      const layers = tree.getLayers();
      assert.strictEqual(layers.length, 3);
      assert.ok(layers[1][1].equals(parent(c, c)));
      assert.ok(tree.root.equals(parent(parent(a, b), parent(c, c))));
      assert.deepStrictEqual(tree.getProof(c)[0], { position: 'right', data: c });
    });

    it('proves the last duplicate and returns [] for unknown leaves', function () {
      const tree = new Tree(['aa', 'bb', 'aa']);
      assert.deepStrictEqual(steps(tree.getProof('aa')), steps(tree.getProof('aa', 2)));
      assert.deepStrictEqual(tree.getProof('cc'), []);
    });

    it('verifyProof accepts object, array, hex string, and Buffer steps', function () {
      const leaves = [1, 2, 3, 4].map((n) => Buffer.alloc(32, n));
      const tree = new Tree(leaves);
      const proof = tree.getProof(leaves[1]);
      const arrays = proof.map((step) => [step.position === 'left' ? 0 : 1, step.data.toString('hex')]);
      assert.strictEqual(Tree.verifyProof(arrays, leaves[1].toString('hex'), tree.rootHex), true);
      // Bare strings and Buffers are left siblings, as on the rightmost path.
      const rightmost = tree.getProof(leaves[3]);
      assert.ok(rightmost.every((step) => step.position === 'left'));
      assert.strictEqual(Tree.verifyProof(rightmost.map((step) => step.data), leaves[3], tree.root), true);
      assert.strictEqual(Tree.verifyProof(rightmost.map((step) => step.data.toString('hex')), leaves[3], tree.root), true);
    });

    it('verifyProof rejects a wrong root, leaf, or proof', function () {
      const leaves = [1, 2, 3, 4].map((n) => Buffer.alloc(32, n));
      const tree = new Tree(leaves);
      const proof = tree.getProof(leaves[1]);
      assert.strictEqual(Tree.verifyProof(proof, leaves[2], tree.root), false);
      assert.strictEqual(Tree.verifyProof(proof, leaves[1], Buffer.alloc(32)), false);
      assert.strictEqual(Tree.verifyProof('nope', leaves[1], tree.root), false);
      assert.strictEqual(Tree.verifyProof(proof, '', tree.root), false);
      assert.strictEqual(Tree.verifyProof(proof, leaves[1]), false);
      assert.throws(() => Tree.verifyProof([42], leaves[1], tree.root), TypeError);
    });

    it('decodes hex-looking strings as hex, others as UTF-8, numbers as decimal digits', function () {
      assert.strictEqual(new Tree(['0xabc']).rootHex, '0abc');
      assert.strictEqual(new Tree(['a']).rootHex, '0a');
      assert.strictEqual(new Tree(['foo']).root.toString('utf8'), 'foo');
      assert.strictEqual(new Tree([12]).rootHex, '12');
      assert.strictEqual(new Tree([Uint8Array.from([1, 2, 3])]).rootHex, '010203');
    });

    it('refuses leaves that are not bytes, strings, or numbers', function () {
      for (const leaf of [null, {}, true]) {
        assert.throws(() => new Tree([leaf]), TypeError);
      }
    });

    it('backs Stack#asMerkleTree', function () {
      const Stack = require('../types/stack');
      const tree = new Stack(['a', 'b', 'c']).asMerkleTree();
      assert.ok(tree instanceof Tree);
      assert.ok(Buffer.isBuffer(tree.getRoot()));
      assert.strictEqual(tree.getRoot().length, 32);
    });
  });
});
