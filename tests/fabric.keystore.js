'use strict';

const assert = require('assert');
const playnet = require('../settings/playnet');

const Store = require('../types/store');

describe('@fabric/core/types/store (encrypted)', function () {
  describe('Store.openEncrypted', function () {
    it('is available from @fabric/core', function () {
      assert.strictEqual(typeof Store.openEncrypted, 'function');
    });

    it('can instantiate smoothly', async function () {
      const store = Store.openEncrypted();
      assert.ok(store);
    });

    it('can open and close smoothly', async function () {
      const store = Store.openEncrypted();
      await store.open();
      await store.close();
      assert.ok(store);
    });

    it('provides the appropriate codec', async function () {
      const store = Store.openEncrypted(playnet);
      await store.open();
      await store.close();
      assert.ok(store);
      assert.ok(store.codec);
      assert.strictEqual(store.codec.key.pubkey, '0223cffd5e94da3c8915c6b868f06d15183c1aeffad8ddf58fcb35a428e3158e71');
    });

    it('can call _setEncrypted', async function () {
      const store = Store.openEncrypted(playnet);
      await store.open();

      await store._setEncrypted('/sample', {
        content: 'Hello, world!'
      });

      await store.close();
      assert.ok(store);
    });

    it('can reopen after _setEncrypted write', async function () {
      const beforeStore = Store.openEncrypted(playnet);
      const afterStore = Store.openEncrypted(playnet);

      await beforeStore.open();
      await beforeStore._setEncrypted('/sample', {
        content: 'Hello, world!',
        other: Buffer.alloc(32)
      });
      await beforeStore.close();

      await afterStore.open();
      await afterStore.close();

      assert.ok(afterStore);
      assert.ok(afterStore.codec);
    });

    it('can clear encrypted values by writing null', async function () {
      const store = Store.openEncrypted(playnet);
      await store.open();
      await store._setEncrypted('/sample', {
        content: 'Hello, world!',
        other: Buffer.alloc(32)
      });
      await store._setEncrypted('/sample', null);
      await store.close();
      assert.ok(store);
    });
  });
});
