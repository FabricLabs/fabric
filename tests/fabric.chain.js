'use strict';

const {
  MAX_TX_PER_BLOCK
} = require('../constants');

const Chain = require('../types/chain');
const Block = require('../types/block');
const assert = require('assert');

describe('@fabric/core/types/chain', function () {
  describe('Chain', function () {
    it('is available from @fabric/core', function () {
      assert.equal(Chain instanceof Function, true);
    });

    it('can cleanly start and stop a chain', async function () {
      const chain = new Chain();

      await chain.start();
      await chain.stop();

      assert.ok(chain);
    });

    it('can append an arbitrary message', async function () {
      const chain = new Chain();

      await chain.start();
      await chain.append({ debug: true, input: 'Hello, world.' });
      await chain.stop();

      assert.ok(chain);
    });

    it('can append a known block', async function () {
      const chain = new Chain();
      const block = new Block({ debug: true, input: 'Hello, world.' });

      assert.strictEqual(block.id, '915b0d50a7bda25ccee15aa2bd6c51a1e7bba3d3ffa599897127c01a72e58104');

      await chain.start();
      await chain.append(block);
      await chain.stop();

      assert.ok(chain);
    });

    it('exposes tip as the consensus id of the latest appended block', async function () {
      const chain = new Chain();
      const block = new Block({ debug: true, input: 'Hello, world.' });

      await chain.start();
      await chain.append(block);
      assert.strictEqual(chain.tip, block.id);
      assert.strictEqual(chain.consensus, block.id);
      assert.strictEqual(chain.blocks[chain.blocks.length - 1], block.id);
      await chain.stop();
    });

    it('advances tip and ledger entries as blocks are mined', async function () {
      const chain = new Chain();
      const first = new Block({ debug: true, input: 'Hello, world.' });
      await chain.start();
      await chain.append(first);
      assert.strictEqual(chain.tip, first.id);
      const second = await chain.generateBlock();
      assert.strictEqual(chain.tip, second.id);
      assert.strictEqual(chain.blocks.length, 2);
      assert.ok(chain.blocks.includes(first.id));
      assert.ok(chain.blocks.includes(second.id));
      await chain.stop();
    });

    it('can mine a second block', async function () {
      const chain = new Chain();
      const block = new Block({ debug: true, input: 'Hello, world.' });

      assert.strictEqual(block.id, '915b0d50a7bda25ccee15aa2bd6c51a1e7bba3d3ffa599897127c01a72e58104');

      await chain.start();
      await chain.append(block);
      const second = await chain.generateBlock();
      assert.strictEqual(second.id, '0f9e784f61b4f71ac6ae8f0a50073951e5ae93e4228eef121c5c674b2bf5a2a8');
      await chain.stop();

      assert.ok(chain);
    });

    it('can mine a second block with transactions', async function () {
      const chain = new Chain();
      const block = new Block({
        debug: true,
        transactions: {
          'dcfe2ae42b3dd7538f1bada55374beff198e446537b8d001bb0a0bc68cf0d2b9': {
            type: 'Transaction',
            input: 'Hello, world.'
          }
        }
      });

      assert.strictEqual(block.id, 'fe83ca7e172b82201f255a3ff34bf73b6721a95078685fe1d184bf4a6c7a20fb');

      await chain.start();
      await chain.append(block);

      const tx = await chain.proposeTransaction({
        type: 'Transaction',
        input: 'Hello, world.'
      });

      const second = await chain.generateBlock();
      assert.strictEqual(second.id, '0df315e21035f10935116619aa5b1233195aa0f627dcbd7e81f895936d8e0141');
      await chain.stop();

      assert.ok(chain);
    });

    it('fails gracefully if too many transactions', async function () {
      const chain = new Chain();
      const block = new Block({ debug: true, input: 'Hello, world.' });

      assert.strictEqual(block.id, '915b0d50a7bda25ccee15aa2bd6c51a1e7bba3d3ffa599897127c01a72e58104');

      await chain.start();
      await chain.append(block);

      // generate n transactions, where n = 1 + MAX_TX_PER_BLOCK
      for (let i = 0; i < MAX_TX_PER_BLOCK + 1; i++) {
        chain.proposeTransaction({
          index: i,
          input: 'Hello, world.',
        });
      }

      assert.equal(chain.mempool.length, MAX_TX_PER_BLOCK + 1);

      const second = await chain.generateBlock();

      assert.equal(chain.mempool.length, 1);
      // assert.strictEqual(second.id, '0fd4ecf2186fea71fedf7d839f2e6df511661ada426a86f654ab45636e0eabed');
      await chain.stop();

      assert.strictEqual(chain.length, 2);
      assert.strictEqual(chain.mempool.length, 1);

      assert.ok(chain);
    });

    it('generates a merkle tree with proofs for appended blocks', async function () {
      const chain = new Chain();

      await chain.start();
      await chain.append({ debug: true, input: 'Hello, world.' });
      await chain.append({ debug: true, input: 'Why trust?  Verify.' });
      await chain.stop();

      const sample = chain.blocks.map((id) => Buffer.from(id, 'hex'));
      const tree = chain._tree;
      const root = tree.getRoot();

      const proofs = {
        genesis: tree.getProof(sample[0], 0),
        'blocks/1': tree.getProof(sample[1], 1)
      };

      assert.ok(chain);
      assert.equal(sample.length, 2);
      assert.ok(Buffer.isBuffer(root));
      assert.ok(root.length > 0);
      assert.ok(Array.isArray(proofs.genesis));
      assert.ok(Array.isArray(proofs['blocks/1']));
      assert.ok(proofs.genesis.length > 0);
      assert.ok(proofs['blocks/1'].length > 0);
    });
  });
});
