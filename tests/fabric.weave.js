'use strict';

const Weave = require('../types/weave');
const assert = require('assert');

describe('@fabric/core/types/weave', function () {
  describe('Weave', function () {
    it('is available from @fabric/core', function () {
      assert.strictEqual(Weave instanceof Function, true);
    });

    it('can construct an empty weave', async function () {
      let weave = new Weave();
      assert.ok(weave);
      assert.strictEqual(weave._state.status, 'initialized');
    });

    it('can construct a known weave', async function () {
      let weave = new Weave(['foo', 'bar']);
      assert.ok(weave);
      assert.strictEqual(weave._state.root, '906b5aaf65ae98f8c98848de5e81ba865659f16fd53aefa4c78b34176f068079'); // TODO: wat?
    });
  });

  describe('_generateLayer', function () {
    it('can generate a known layer', async function () {
      const weave = new Weave(['Hello,', 'World!']);
      const layer = await weave._generateLayer();
      assert.ok(weave);
      assert.strictEqual(weave.root.toString('hex'), 'f4d6428b2c8eac8083ac6da97a996284b23d7482a35a2ced481205d96e7792ea');
    });
  });
});
