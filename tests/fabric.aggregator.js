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
            assert.strictEqual(commit.root.toString('hex'), '632ad963e04ee92c0e575d5d7c674cc99ccb17b78fb269663f0bdefb4c9e792d');
            assert.strictEqual(commit.id, '632ad963e04ee92c0e575d5d7c674cc99ccb17b78fb269663f0bdefb4c9e792d');
            assert.strictEqual(commit.actor, '788a0e9bd64e02cba5c1f290fedb287871ca993e6a5cdf2689074c1d52dd6dfa');
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
              assert.strictEqual(commit.root.toString('hex'), '068f7d173519f1498e114baffa9fd75f93d3de4e40cd1d64f8127d22ddab2973');
              assert.strictEqual(commit.id, '068f7d173519f1498e114baffa9fd75f93d3de4e40cd1d64f8127d22ddab2973');
              assert.strictEqual(commit.actor, '7182f9b168c702bd6d27e0e4249df6b589eb406723c07f3351943a8597e60917');
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
