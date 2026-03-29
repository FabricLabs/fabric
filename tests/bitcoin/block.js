'use strict';

const assert = require('assert');

const BitcoinTransaction = require('../../types/bitcoin/transaction');
const BitcoinBlock = require('../../types/bitcoin/block');

describe('@fabric/core/types/bitcoin', function () {
  describe('BitcoinBlock', function () {
    it('constructs with sensible defaults', function () {
      const block = new BitcoinBlock();

      assert.strictEqual(block.settings.provider, 'bcoin');
      assert.strictEqual(block.settings.network, 'regtest');
      assert.strictEqual(block.data.network, 'regtest');
    });

    it('builds a consensus block from transactions', function () {
      class FakeConsensusBlock {
        constructor (opts = {}) {
          this.opts = opts;
          this.txs = opts.txs;
        }
      }

      const block = new BitcoinBlock();
      const hashes = ['tx-a', 'tx-b'];

      // Ensure transactions live under Actor state so `this.state.transactions` is defined
      block.state = { transactions: hashes };

      // Inject a minimal consensus implementation
      block.consensus = {
        Block: FakeConsensusBlock
      };

      const result = block.toBitcoinBlock();

      assert.ok(result instanceof FakeConsensusBlock, 'should return a consensus block instance');
      assert.ok(Array.isArray(result.txs), 'consensus block should expose tx list');
      assert.strictEqual(result.txs.length, hashes.length);

      result.txs.forEach((tx, index) => {
        assert.ok(tx instanceof BitcoinTransaction, 'each entry should be a BitcoinTransaction');
        assert.strictEqual(tx.settings.hash, hashes[index], 'transaction settings should include original hash');
      });
    });
  });
});

describe('@fabric/core/types/bitcoin/block', function () {
  it('is available from @fabric/core', function () {
    assert.equal(BitcoinBlock instanceof Function, true);
  });

  it('creates an empty instance', function () {
    const block = new BitcoinBlock();
    assert.ok(block);
  });
});
