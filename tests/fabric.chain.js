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

      assert.strictEqual(block.id, '6d2deb1d439472428e7cdeed4ee8e7c708502cfdc037122139d1e9898f0b6b68');

      await chain.start();
      await chain.append(block);
      await chain.stop();

      assert.ok(chain);
    });

    it('can mine a second block', async function () {
      const chain = new Chain();
      const block = new Block({ debug: true, input: 'Hello, world.' });

      assert.strictEqual(block.id, '6d2deb1d439472428e7cdeed4ee8e7c708502cfdc037122139d1e9898f0b6b68');

      await chain.start();
      await chain.append(block);
      const second = await chain.generateBlock();
      assert.strictEqual(second.id, '6bd5c73d3d4064d2c0e9e34682c6c49a89f1c650430bc60b4df6ea761a5c51aa');
      await chain.stop();

      assert.ok(chain);
    });

    it('can mine a second block with transactions', async function () {
      const chain = new Chain();
      const block = new Block({ debug: true, input: 'Hello, world.' });

      assert.strictEqual(block.id, '6d2deb1d439472428e7cdeed4ee8e7c708502cfdc037122139d1e9898f0b6b68');

      await chain.start();
      await chain.append(block);

      const tx = await chain.proposeTransaction({ input: 'Hello again, world!' });
      const second = await chain.generateBlock();
      assert.strictEqual(second.id, '118f303884f05a2744630ad536395ba2d6a6d2f89d5c12f351a91827a0f2ced1');
      await chain.stop();

      assert.ok(chain);
    });

    it('fails gracefully if too many transactions', async function () {
      const chain = new Chain();
      const block = new Block({ debug: true, input: 'Hello, world.' });

      assert.strictEqual(block.id, '6d2deb1d439472428e7cdeed4ee8e7c708502cfdc037122139d1e9898f0b6b68');

      await chain.start();
      await chain.append(block);

      for (let i = 0; i < MAX_TX_PER_BLOCK + 1; i++) {
        await chain.proposeTransaction({ input: 'Hello again, world!' });
      }

      const second = await chain.generateBlock();
      assert.strictEqual(second.id, 'c9577a3392070bda1a8aabcc4337fb4190dd3efb546b1ce7efcb0a436c9283a8');
      await chain.stop();

      assert.strictEqual(chain._state.blocks[chain.tip].transactions.length, 100);
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
