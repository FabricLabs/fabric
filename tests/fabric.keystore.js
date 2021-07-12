'use strict';

const KeyStore = require('../types/keystore');
const Hash256 = require('../types/hash256');
const assert = require('assert');

describe('@fabric/core/types/keystore', function () {
  describe('KeyStore', function () {
    this.timeout(10000);

    it('is available from @fabric/core', function () {
      assert.strictEqual(KeyStore instanceof Function, true);
    });

    it('can instantiate smoothly', async function () {
      const store = new KeyStore();
      assert.ok(store);
    });

    it('can open and close smoothly', async function () {
      const store = new KeyStore();
      await store.open();
      await store.close();
      assert.ok(store);
    });

    it('can call _setState', async function () {
      const store = new KeyStore();
      await store.open();
      await store._setState({
        content: 'Hello, world!'
      });
      await store.close();
      assert.ok(store);
    });

    it('can restore after _setState', async function () {
      const store = new KeyStore();
      await store.open();
      await store._setState({
        content: 'Hello, world!',
        other: Buffer.alloc(32)
      });

      await store.close();
      await store.open();
      const result = await store._get();
      const beforeHash = Hash256.digest(JSON.stringify(result));
      await store.close();

      assert.ok(store);
      assert.strictEqual(beforeHash, '1dfe1b2c35883bd1fc24af16c160c2a101550633d0b7788f5ae9ed77c0a76db2');

    });

    it('can wipe after _setState', async function () {
      const store = new KeyStore();
      await store.open();
      await store._setState({
        content: 'Hello, world!',
        other: Buffer.alloc(32)
      });

      await store.close();
      await store.open();
      const result = await store._get();
      const beforeHash = Hash256.digest(JSON.stringify(result));
      await store.wipe();

      assert.strictEqual(store.status, 'deleted');
      const after = await store._get();
      const afterHash = Hash256.digest(JSON.stringify(after));
      await store.close();

      assert.ok(store);
      assert.strictEqual(beforeHash, '1dfe1b2c35883bd1fc24af16c160c2a101550633d0b7788f5ae9ed77c0a76db2');
      assert.strictEqual(afterHash, '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a');
    });
  });
});
