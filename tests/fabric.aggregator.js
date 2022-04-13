'use strict';

const assert = require('assert');
const Aggregator = require('../types/aggregator');

describe('@fabric/core/types/aggregator', function () {
  describe('Aggregator', function () {
    it('is available from @fabric/core', function () {
      assert.strictEqual(Aggregator instanceof Function, true);
    });

    it('can create an instance', async function provenance () {
      const aggregator = new Aggregator();
      assert.ok(aggregator);
    });

    it('can compute a single input', async function provenance () {
      const aggregator = new Aggregator();
      aggregator._importBalances([{ total: 1, confirmed: 1, unconfirmed: 0 }]);
      assert.ok(aggregator);
      assert.strictEqual(aggregator.balances.total, 1);
    });

    it('can compute multiple inputs', async function provenance () {
      const aggregator = new Aggregator();
      aggregator._importBalances([{ total: 1, confirmed: 1, unconfirmed: 0 }]);
      aggregator._importBalances([{ total: 1, confirmed: 0, unconfirmed: 1 }]);
      assert.ok(aggregator);
      assert.strictEqual(aggregator.balances.total, 2);
    });

    it('can compute many inputs', async function provenance () {
      const aggregator = new Aggregator();
      for (let i = 0; i < 100; i++) aggregator._importBalances([{ total: 1, confirmed: 1, unconfirmed: 0 }]);
      assert.ok(aggregator);
      assert.strictEqual(aggregator.balances.total, 100);
    });

    it('emits an appropriately-formatted event', function provenance (done) {
      async function test () {
        try {
          const aggregator = new Aggregator();
          aggregator.on('commit', (commit) => {
            assert.ok(commit);
            assert.strictEqual(commit.root instanceof Uint8Array, true);
            assert.strictEqual(commit.root.toString('hex'), '00f7a33177c358ec85e2779a7a93a46b838b349a5322bc3c52633c3bd22c9316');
            assert.strictEqual(commit.id, '00f7a33177c358ec85e2779a7a93a46b838b349a5322bc3c52633c3bd22c9316');
            assert.strictEqual(commit.actor, 'f4b881ef53637d192ecb35359ae44f25284b93acb4126ecb84a7ff793c608f7e');
            assert.strictEqual(aggregator.balances.total, 1);
            done();
          });
          aggregator._importBalances([{ total: 1, confirmed: 1, unconfirmed: 0 }]);
        } catch (exception) {
          return done(exception);
        }
      }
      test();
    });

    it('has correct merkle tree', function provenance (done) {
      async function test () {
        try {
          const aggregator = new Aggregator();
          let count = 0;
          aggregator.on('commit', (commit) => {
            if (++count >= 2) {
              assert.ok(commit);
              assert.strictEqual(commit.root instanceof Uint8Array, true);
              assert.strictEqual(commit.root.toString('hex'), '3fa149ded407f186a554d8fbe99c17a971acf4a618e85d4e0088efbd447bd2e7');
              assert.strictEqual(commit.id, '3fa149ded407f186a554d8fbe99c17a971acf4a618e85d4e0088efbd447bd2e7');
              assert.strictEqual(commit.actor, 'cb896879545d912ea9fcde43ff8bcfd3c532dd075ef8c8525eb465f623b653fb');
              assert.strictEqual(aggregator.balances.total, 2);
              done();
            }
          });
          aggregator._importBalances([{ total: 1, confirmed: 1, unconfirmed: 0 }]);
          aggregator._importBalances([{ total: 1, confirmed: 0, unconfirmed: 1 }]);
        } catch (exception) {
          done(exception);
        }
      }
      test();
    });
  });
});
