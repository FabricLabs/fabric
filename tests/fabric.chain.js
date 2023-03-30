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

    xit('generates a merkle tree with the expected proof of inclusion', async function () {
      const chain = new Chain();

      await chain.start();
      await chain.append({ debug: true, input: 'Hello, world.' });
      await chain.append({ debug: true, input: 'Why trust?  Verify.' });
      await chain.stop();

      const sample = chain.blocks.map(b => Buffer.from(b['@id'], 'hex'));
      const tree = chain['@tree'];
      const root = tree.getRoot();

      const proofs = {
        genesis: tree.getProof(sample[0], 0),
        'blocks/1': tree.getProof(sample[1], 1),
        'blocks/2': tree.getProof(sample[2], 2)
      };

      const verifiers = {
        genesis: tree.verify(proofs.genesis, sample[0], root),
        'blocks/1': tree.verify(proofs['blocks/1'], sample[1], root),
        'blocks/2': tree.verify(proofs['blocks/2'], sample[2], root),
        invalid: tree.verify(proofs['genesis'], Buffer.alloc(32), root)
      };

      assert.ok(chain);
      assert.equal(sample.length, 3);
      assert.equal(sample[0].toString('hex'), 'c1b294376d6d30d85a81cff9244e7b447a02e6307a047c4a53643a945022e505');
      assert.equal(sample[1].toString('hex'), '67822dac02f2c1ae1e202d8e75437eaede631861e60340b2fbb258cdb75780f3');
      assert.equal(sample[2].toString('hex'), 'a59402c14784e1be43b1adfc7832fa8c402dddf1ede7f7c29549d499b112444f');
      assert.equal(verifiers.genesis, true);
      assert.equal(verifiers['blocks/1'], true);
      assert.equal(verifiers['blocks/2'], true);
      assert.equal(verifiers.invalid, false);
    });
  });
});
