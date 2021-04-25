'use strict';

const assert = require('assert');
const playnet = require('../settings/playnet');

const KeyStore = require('../types/keystore');
const Hash256 = require('../types/hash256');

describe('@fabric/core/types/keystore', function () {
  describe('KeyStore', function () {
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

    it('provides the appropriate codec', async function () {
      const store = new KeyStore(playnet);
      await store.open();
      await store.close();
      assert.ok(store);
      assert.ok(store.codec);
      assert.strictEqual(store.codec.key.pubkey, '0223cffd5e94da3c8915c6b868f06d15183c1aeffad8ddf58fcb35a428e3158e71');
    });

    it('can call _setState', async function () {
      const store = new KeyStore(playnet);
      await store.open();
      await store._setState({
        content: 'Hello, world!'
      });
      await store.close();

      assert.ok(store);
    });

    xit('can restore after _setState', async function () {
      const beforeStore = new KeyStore(playnet);
      const afterStore = new KeyStore(playnet);

      await beforeStore.open();
      await beforeStore._setState({
        content: 'Hello, world!',
        other: Buffer.alloc(32)
      });
      await beforeStore.close();

      await afterStore.open();
      const result = await afterStore._get();
      console.log('result:', result);

      const afterHash = Hash256.digest(JSON.stringify(result));
      await afterStore.close();

      console.log('result:', result);

      assert.ok(afterStore);
      assert.strictEqual(afterHash, '1dfe1b2c35883bd1fc24af16c160c2a101550633d0b7788f5ae9ed77c0a76db2');
    });

    xit('can wipe after _setState', async function () {
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
