'use strict';

const Fabric = require('../');
const assert = require('assert');

describe('@fabric/core/types/collection', function () {
  describe('Collection', function () {
    it('is available from @fabric/core', function () {
      assert.equal(Fabric.Collection instanceof Function, true);
    });

    it('starts as empty', async function () {
      let set = new Fabric.Collection();
      assert.equal(set.render(), '[]');
    });

    it('can hold a single entity', async function () {
      let set = new Fabric.Collection();
      set.push('test');
      // console.log('the set:', set);
      let populated = await set.populate();
      // console.log('populated:', populated);
      assert.equal(JSON.stringify(populated), '["test"]');
    });

    it('can restore from an Array object', async function () {
      let set = new Fabric.Collection(['test']);
      let populated = await set.populate();
      assert.equal(JSON.stringify(populated), '["test"]');
    });

    it('can restore from a more complex Array object', async function () {
      let set = new Fabric.Collection(['test', { text: 'Hello, world!' }]);
      let populated = await set.populate();
      assert.equal(JSON.stringify(populated), '["test",{"text":"Hello, world!"}]');
    });

    it('manages a collection of objects', async function () {
      let set = new Fabric.Collection();

      set.push('Α');
      set.push('Ω');

      let populated = await set.populate();

      // console.log('set:', set);
      // console.log('populated:', populated);
      // console.log('rendered:', set.render());

      assert.equal(JSON.stringify(populated), '["Α","Ω"]');
      assert.equal(set.render(), '["2b99b4981c9947163e21a542ac3a7b1e1804ca6d933604d14280a4794e0939bb","432aa66781782a3d162c50fd9491af6a592a52f6ffe6a0dd996136b6fe74c2fa"]');
    });
  });
});
