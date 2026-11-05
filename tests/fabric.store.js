'use strict';

const {
  LARGE_COLLECTION_SIZE
} = require('../constants');

// Testing
const assert = require('assert');
const Fabric = require('../');

const config = require('../settings/test');
const samples = require('../assets/samples');

// Types
const Store = require('../types/store');

describe('@fabric/core/types/store', function () {
  describe('Store', function () {
    it('is available from @fabric/core', function () {
      assert.equal(Fabric.Store instanceof Function, true);
    });

    it('getRouteInfo normalizes path and stable index', async function () {
      const store = new Store({ persistent: false });
      const a = await store.getRouteInfo('relative');
      const b = await store.getRouteInfo('/absolute');
      assert.strictEqual(a.path, '/relative');
      assert.strictEqual(b.path, '/absolute');
      assert.strictEqual(typeof a.index, 'string');
      assert.notStrictEqual(a.index, b.index);
    });

    it('encodeValue and getDataInfo support string payloads', async function () {
      const store = new Store({ persistent: false });
      const hex = await store.encodeValue('hello');
      assert.strictEqual(typeof hex, 'string');
      assert.ok(hex.length > 0);
      const info = await store.getDataInfo('hello');
      assert.strictEqual(info.type, 'JSONString');
      assert.strictEqual(info.size, 5);
      assert.ok(info.hash);
    });

    it('encryptedSettings attaches codec defaults', function () {
      const settings = Store.encryptedSettings({
        path: './stores/test-encrypted-settings',
        persistent: false
      });
      assert.ok(settings.codec);
      assert.strictEqual(settings.type, 'EncryptedFabricStore');
    });

    it('openEncrypted returns a Store with encrypted defaults', function () {
      const store = Store.openEncrypted({ persistent: false });
      assert.ok(store instanceof Store);
      assert.ok(store.codec);
    });

    it('flush is a no-op when Level is not open', async function () {
      const store = new Store({ persistent: false });
      const out = await store.flush();
      assert.strictEqual(out, store);
    });

    it('flush swallows LEVEL_DATABASE_NOT_OPEN from a stale open handle', async function () {
      const store = new Store({ persistent: false });
      store.db = {
        status: 'open',
        del: async () => {
          const err = new Error('Database is not open');
          err.code = 'LEVEL_DATABASE_NOT_OPEN';
          throw err;
        }
      };
      const out = await store.flush();
      assert.strictEqual(out, store);
    });

    it('strict: Level read and write failures reject; a missing key is still null', async function () {
      const broken = () => { throw new Error('disk gone'); };
      const strict = new Store({ strict: true });
      strict.db = { get: broken, put: broken };
      await assert.rejects(strict.get('/metrics/a'), /disk gone/);
      await assert.rejects(strict.set('/metrics/a', { n: 1 }), /disk gone/);
      strict.db = { get: async () => undefined, put: broken };
      assert.strictEqual(await strict.get('/metrics/a'), null, 'a failed write is not kept in memory');

      // Level 10 resolves a missing key as `undefined`; older Level threw LEVEL_NOT_FOUND.
      const missing = new Store({ strict: true });
      missing.db = { get: async () => undefined };
      assert.strictEqual(await missing.get('/metrics/none'), null);
      missing.db = {
        get: async () => {
          const err = new Error('not found');
          err.code = 'LEVEL_NOT_FOUND';
          throw err;
        }
      };
      assert.strictEqual(await missing.get('/metrics/none'), null);

      const text = new Store({ strict: true });
      text.db = { get: async () => 'null' };
      assert.strictEqual(await text.get('/metrics/word'), 'null', 'persisted null text is the string');

      const lenient = new Store();
      lenient.db = { get: broken };
      assert.strictEqual(await lenient.get('/metrics/a'), null);
    });

    it('writes to one key land in call order, in Level and in memory', async function () {
      const disk = new Map();
      const store = new Store({ strict: true });
      // The first put resolves last, as concurrent Level writes may.
      let delay = 30;
      store.db = {
        get: async (key) => disk.get(key),
        put: (key, value) => new Promise((resolve) => setTimeout(() => { disk.set(key, value); resolve(); }, (delay -= 15) + 15))
      };
      await Promise.all([store.set('/metrics/a', 'first'), store.set('/metrics/a', 'second')]);
      assert.strictEqual(disk.get('/metrics/a'), 'second');
      assert.strictEqual(store._state.content.metrics.a, 'second');
      // A failed write does not hold up the next one.
      const broken = new Store({ strict: true });
      let fail = true;
      broken.db = { get: async () => undefined, put: async () => { if (fail) { fail = false; throw new Error('disk gone'); } } };
      const results = await Promise.allSettled([broken.set('/metrics/a', 1), broken.set('/metrics/a', 2)]);
      assert.deepStrictEqual(results.map((r) => r.status), ['rejected', 'fulfilled']);
      assert.strictEqual(broken._state.content.metrics.a, 2);
    });

    it('refuses a write beneath a scalar before it reaches Level', async function () {
      const puts = [];
      const store = new Store({ strict: true });
      store.db = { get: async () => undefined, put: async (key) => { puts.push(key); } };
      await store.set('/metrics', 'flat');
      await assert.rejects(store.set('/metrics/a', 1), /not an object/);
      assert.deepStrictEqual(puts, ['/metrics']);
      assert.strictEqual(store._state.content.metrics, 'flat');
    });

    it('orders a parent and a child write, so the child never lands beneath a scalar', async function () {
      const disk = new Map();
      const store = new Store({ strict: true });
      store.db = {
        get: async (key) => disk.get(key),
        put: (key, value) => new Promise((resolve) => setTimeout(() => { disk.set(key, value); resolve(); }, 10))
      };
      const results = await Promise.allSettled([store.set('/metrics', 'flat'), store.set('/metrics/a', 1)]);
      assert.deepStrictEqual(results.map((r) => r.status), ['fulfilled', 'rejected']);
      assert.ok(!disk.has('/metrics/a'));
    });

    it('refuses a child beneath a scalar stored before a reopen', async function () {
      const puts = [];
      const store = new Store({ strict: true });
      // Memory is empty, as after a restart; Level still holds `/metrics` as text.
      store.db = { get: async (key) => (key === '/metrics' ? 'flat' : undefined), put: async (key) => { puts.push(key); } };
      await assert.rejects(store.set('/metrics/a', 1), /not an object/);
      assert.deepStrictEqual(puts, []);
      store.db.get = async (key) => (key === '/metrics' ? JSON.stringify({ b: 2 }) : undefined);
      await store.set('/metrics/a', 1);
      assert.deepStrictEqual(puts, ['/metrics/a']);
    });

    it('refuses a path through a reserved key', async function () {
      const store = new Store({ strict: true });
      store.db = { get: async () => undefined, put: async () => {} };
      for (const key of ['/__proto__/polluted', '/a/constructor/prototype/polluted']) {
        await assert.rejects(store.set(key, 1), /reserved key/);
      }
      assert.strictEqual({}.polluted, undefined);
    });

    it('stop waits for queued writes before Level closes', async function () {
      const order = [];
      const store = new Store({ strict: true, persistent: true });
      store.db = {
        get: async () => undefined,
        put: (key, value) => new Promise((resolve) => setTimeout(() => { order.push(`put ${value}`); resolve(); }, 10))
      };
      store.close = async () => { order.push('close'); };
      const writes = [store.set('/metrics/a', 1), store.set('/metrics/a', 2)];
      await store.stop();
      await Promise.all(writes);
      assert.deepStrictEqual(order, ['put 1', 'put 2', 'close']);
    });

    it('_setEncrypted/_getEncrypted round-trip plain values without codec', async function () {
      const store = new Store({ persistent: false });
      await store._setEncrypted('/wallet/secret', 'hello');
      const out = await store._getEncrypted('/wallet/secret');
      assert.strictEqual(out, 'hello');
    });

    it('_setEncrypted/_getEncrypted use codec when available', async function () {
      const store = new Store({
        persistent: false,
        codec: {
          encode: (value) => Buffer.from(`enc:${value}`, 'utf8'),
          decode: (buffer) => buffer.toString('utf8')
        }
      });

      await store._setEncrypted('/wallet/codec', 'hello');
      const out = await store._getEncrypted('/wallet/codec');
      assert.strictEqual(out, 'enc:hello');
    });

    it('can set a key to a string value', async function () {
      let store = new Store({
        persistent: false
      });

      await store.start().catch(assert.fail);
      let set = await store.set('example', samples.input.hello).catch(assert.fail);
      await store.stop().catch(assert.fail);

      assert.ok(store);

      assert.equal(typeof set, 'string');
      assert.equal(typeof set, typeof samples.input.hello);
      assert.equal(set, samples.input.hello);
    });

    it('can recover string data after a restart', async function () {
      let store = new Store({
        path: './stores/test-store-restart',
        persistent: true
      });
      await store.start();
      let set = await store.set('example', samples.input.hello);
      await store.stop();
      await store.start();
      let get = await store.get('example');
      await store.stop();

      assert.ok(store);
      assert.equal(typeof set, 'string');
      assert.equal(typeof set, typeof samples.input.hello);
      assert.equal(set, samples.input.hello);
      assert.equal(typeof get, 'string');
      assert.equal(typeof get, typeof samples.input.hello);
      assert.equal(get, samples.input.hello);
    });

    it('can manage collections', async function () {
      let data = { name: 'widget-alpha' };
      let alt = Object.assign({}, data, { extra: data });
      let store = new Store({
        path: './stores/collections',
        persistent: false
      });

      await store.start();

      let before = await store._GET(`/widgets`);
      let posted = await store._POST(`/widgets`, data);
      let entity = await store._GET(posted, data);
      let after = await store._GET(`/widgets`);
      let second = await store._POST(`/widgets`, alt);
      let target = await store._GET(second);
      let result = await store._GET(`/widgets`);

      await store.stop();

      //assert.equal(result.length, 2);
      assert.equal(JSON.stringify(after), JSON.stringify([data]));
      assert.equal(JSON.stringify(result), JSON.stringify([data, alt]));
      //assert.equal(JSON.stringify(entity), JSON.stringify(data));
    });

    it('can manage large collections', async function () {
      let data = { name: 'widget-alpha' };
      let alt = Object.assign({}, data, { extra: data });
      let store = new Store({
        path: './stores/collections',
        persistent: false
      });

      await store.start();

      let before = await store._GET(`/widgets`);

      for (let i = 0; i < LARGE_COLLECTION_SIZE; i++) {
        await store._POST(`/widgets`, alt);
      }

      let result = await store._GET(`/widgets`);

      await store.stop();

      assert.equal(result.length, LARGE_COLLECTION_SIZE);
    });
  });
});
