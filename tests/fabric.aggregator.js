'use strict';

// Testing
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
      aggregator._sumBalances();
      aggregator.commit();
      assert.ok(aggregator);
      assert.strictEqual(aggregator.balances.total, 1);
    });

    it('can compute multiple inputs', async function provenance () {
      const aggregator = new Aggregator();
      aggregator._importBalances([{ total: 1, confirmed: 1, unconfirmed: 0 }]);
      aggregator._importBalances([{ total: 1, confirmed: 0, unconfirmed: 1 }]);
      aggregator._sumBalances();
      aggregator.commit();
      assert.ok(aggregator);
      assert.strictEqual(aggregator.balances.total, 2);
    });

    it('can compute many inputs', async function provenance () {
      const aggregator = new Aggregator();
      for (let i = 0; i < 10000; i++) aggregator._importBalances([{ total: 1, confirmed: 1, unconfirmed: 0 }]);
      aggregator._sumBalances();
      aggregator.commit();
      assert.ok(aggregator);
      assert.strictEqual(aggregator.balances.total, 10000);
    });

    it('emits an appropriately-formatted event', function provenance (done) {
      async function test () {
        try {
          const aggregator = new Aggregator();
          aggregator.on('commit', (commit) => {
            assert.ok(commit);
            assert.strictEqual(commit.)
            assert.strictEqual(commit.id, '0c9ad2dfdf6f699ef743cb5bd0b22defc5aca025520ef5acece2213ddd502615');
            assert.strictEqual(commit.actor, '788a0e9bd64e02cba5c1f290fedb287871ca993e6a5cdf2689074c1d52dd6dfa');
            assert.strictEqual(aggregator.balances.total, 1);

            done();
          });
          aggregator._importBalances([{ total: 1, confirmed: 1, unconfirmed: 0 }]);
          aggregator._sumBalances();
          aggregator.commit();
        } catch (exception) {
          done(exception);
        }
      }

      test();
    });
  });
});
