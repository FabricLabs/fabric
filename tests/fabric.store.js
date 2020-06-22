'use strict';

const {
  LARGE_COLLECTION_SIZE
} = require('../constants');

// Testing
const assert = require('assert');
const Fabric = require('../');

const config = require('../settings/test');
const samples = require('../assets/samples');
const handler = require('../functions/handleException');

const sample = { name: 'widget-alpha' };
const settings = {
  path: './stores/tests',
  persistent: false
};

const level = require('level');

// Types
const Store = require('../types/store');

describe('@fabric/core/types/store', function () {
  describe('Store', function () {
    it('is available from @fabric/core', function () {
      assert.equal(Fabric.Store instanceof Function, true);
    });

    xit('can set a key to a string value', async function () {
      let store = new Store(settings);

      await store.start().catch(store.error.bind(store));
      let set = await store.set('example', samples.input.hello).catch(store.error.bind(store));
      await store.stop().catch(store.error.bind(store));

      assert.ok(store);
      // console.log('set:', set);

      assert.equal(typeof set, 'string');
      assert.equal(typeof set, typeof samples.input.hello);
      assert.equal(set, samples.input.hello);
    });

    xit('can recover string data after a restart', async function () {
      let store = new Store();
      await store.start();
      let set = await store.set('example', samples.input.hello);
      await store.stop();

      await store.start();
      let get = await store.get('example');
      await store.stop();

      const db = level(settings.path)

      assert.ok(store);
      assert.equal(typeof set, 'string');
      assert.equal(typeof set, typeof samples.input.hello);
      assert.equal(set, samples.input.hello);
      assert.equal(typeof get, 'string');
      assert.equal(typeof get, typeof samples.input.hello);
      assert.equal(get, samples.input.hello);
    });

    it('has appropriate disk state', async function () {
      let store = new Store();
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

    xit('can manage collections', async function () {
      let alt = Object.assign({}, sample, { extra: sample });
      let store = new Store({
        path: './stores/collections',
        persistent: false
      });

      await store.start();

      let before = await store._GET(`/widgets`);
      let posted = await store._POST(`/widgets`, sample);
      let entity = await store._GET(posted, sample);
      let after = await store._GET(`/widgets`);
      let second = await store._POST(`/widgets`, alt);
      let target = await store._GET(second);
      let result = await store._GET(`/widgets`);

      await store.stop();

      //assert.equal(result.length, 2);
      assert.equal(JSON.stringify(after), JSON.stringify([sample]));
      assert.equal(JSON.stringify(result), JSON.stringify([sample, alt]));
      //assert.equal(JSON.stringify(entity), JSON.stringify(sample));
    });

    xit('can manage large collections', async function () {
      let alt = Object.assign({}, sample, { extra: sample });
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

    xit('can POST an entity', async function () {
      let store = new Store(settings);
      await store.start();
      let prior = await store._GET('/');
      let result = await store._POST(sample);
      let after = await store._GET('/');
      await store.flush();
      await store.stop();
      console.log('prior:', prior);
      console.log('result:', result);
      console.log('after:', after);
    });
  });
});
