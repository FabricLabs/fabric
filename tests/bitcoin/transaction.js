 'use strict';

 const assert = require('assert');
 const BitcoinTransaction = require('../../types/bitcoin/transaction');

describe('@fabric/core/types/bitcoin', function () {
  describe('BitcoinTransaction', function () {
    it('constructs with defaults and key holder', function () {
      const tx = new BitcoinTransaction();

      assert.ok(tx.holder, 'transaction should have a key holder');
      assert.strictEqual(tx.settings.raw, null);
      assert.deepStrictEqual(tx.inputs, []);
      assert.deepStrictEqual(tx.outputs, []);
      assert.strictEqual(tx.script, null);
      assert.strictEqual(tx.signature, null);

      // Internal state shape
      assert.deepStrictEqual(tx._state.content, { raw: null });
      assert.strictEqual(tx._state.status, 'PAUSED');
    });

    it('exposes identifier properties', function () {
      const tx = new BitcoinTransaction({ raw: 'deadbeef' });

      assert.strictEqual(tx.hash, '<hash>');
      assert.strictEqual(tx.id, '<fabricID>');
      assert.strictEqual(tx.txid, '<txID>');
    });

    it('can sign as holder', function () {
      const tx = new BitcoinTransaction();

      const signed = tx.signAsHolder();
      assert.strictEqual(signed, tx, 'signAsHolder should be chainable');
      assert.ok(tx.signature, 'signature should be set after signing');
    });
  });
});

describe('@fabric/core/types/bitcoin/transaction', function () {
  it('is available from @fabric/core', function () {
    assert.equal(BitcoinTransaction instanceof Function, true);
  });

  it('creates an empty instance', function () {
    const tx = new BitcoinTransaction();
    assert.ok(tx);
  });

  it('provides a hash', function () {
    const tx = new BitcoinTransaction();
    assert.ok(tx);
    assert.ok(tx.hash);
  });

  it('provides a txid', function () {
    const tx = new BitcoinTransaction();
    assert.ok(tx);
    assert.ok(tx.txid);
  });

  it('provides an id', function () {
    const tx = new BitcoinTransaction();
    assert.ok(tx);
    assert.ok(tx.id);
  });
});
