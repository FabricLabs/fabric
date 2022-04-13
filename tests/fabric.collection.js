'use strict';

const Fabric = require('../');
const assert = require('assert');

const samples = require('./fixtures/collection');

describe('@fabric/core/types/collection', function () {
  describe('Collection', function () {
    it('is available from @fabric/core', function () {
      assert.equal(Fabric.Collection instanceof Function, true);
    });

    xit('starts as empty', async function () {
      const set = new Fabric.Collection();
      assert.equal(set.render(), '[]');
    });

    it('can hold a single entity', async function () {
      const set = new Fabric.Collection();
      set.push('test');
      // console.log('the set:', set);
      const populated = await set.populate();
      // console.log('populated:', populated);
      assert.equal(JSON.stringify(populated), '["test"]');
    });

    it('can restore from an Array object', async function () {
      const set = new Fabric.Collection(['test']);
      const populated = await set.populate();
      assert.equal(JSON.stringify(populated), '["test"]');
    });

    xit('can restore from a more complex Array object', async function () {
      const set = new Fabric.Collection(['test', { text: 'Hello, world!' }]);
      const populated = await set.populate();
      assert.equal(JSON.stringify(populated), '["test",{"text":"Hello, world!"}]');
    });

    xit('manages a collection of objects', async function () {
      const set = new Fabric.Collection();

      set.push('Α');
      set.push('Ω');

      const populated = await set.populate();

      // console.log('set:', set);
      // console.log('populated:', populated);
      // console.log('rendered:', set.render());

      assert.equal(JSON.stringify(populated), '["Α","Ω"]');
      assert.equal(set.render(), '["2b99b4981c9947163e21a542ac3a7b1e1804ca6d933604d14280a4794e0939bb","432aa66781782a3d162c50fd9491af6a592a52f6ffe6a0dd996136b6fe74c2fa"]');
    });

    xit('can import with commit', async () => {
      const set = new Fabric.Collection();
      const res = await set.import(samples.list[0]);
      assert.equal(set.len, 1);
    });

    xit('can import without commit', async () => {
      const set = new Fabric.Collection();
      const res = await set.import(samples.list[0], false);
      assert.equal(set.len, 1);
    });

    xit('can import list', async () => {
      const set = new Fabric.Collection();
      const res = await set.importList(samples.list);
      assert.equal(set.len, 3);
    });

    xit('can create with commit', async () => {
      const set = new Fabric.Collection();
      const res = await set.create(samples.list[0]);

      assert.equal(set.len, 1);
    });

    xit('can create without commit', async () => {
      const set = new Fabric.Collection();
      const res = await set.create(samples.list[0], false);

      assert.equal(set.len, 1);
    });

    // let converters = ['map', 'typedMap', 'toTypedArray', 'list'];
    const converters = ['map', 'typedMap', 'list'];

    converters.forEach(converter => {
      xit('can convert to ' + converter, async () => {
        const set = new Fabric.Collection();
        const res = await set.importList(samples.list);
        const map = set[converter]();

        for (const i in map) {
          const item = map[i];
          for (const k in item) {
            const j = converter == 'toTypedArray' ? i : i - 1;
            assert.equal(item[k], samples.list[j][k]);
          }
        }
      });
    });
  });
});
