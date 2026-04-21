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

      assert.ok(Buffer.isBuffer(tx._state.content.raw));
      assert.deepStrictEqual(tx._state.content.raw, Buffer.from('deadbeef', 'hex'));
      assert.strictEqual(tx.hash, '281dd50f6f56bc6e867fe73dd614a73c55a647a479704f64804b574cafb0f5c5');
      assert.strictEqual(tx.txid, 'c5f5b0af4c574b80644f7079a447a6553ca714d63de77f866ebc566f0fd51d28');
      assert.strictEqual(tx.id, tx.txid);
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
