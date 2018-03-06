'use strict';

import Fabric from '../';

const assert = require('assert');
const expect = require('chai').expect;

const widget = require('../data/widget');

describe('Resource', function () {
  it('should expose a constructor', function () {
    assert.equal(typeof Fabric.Resource, 'function');
  });

  it('should initialize a known Resource', async function () {
    let resource = new Fabric.Resource(widget);
    let store = new Fabric.Store();

    await store.open();

    try {
      resource.trust(store);
      let test = await resource.create({
        name: 'Wobbler'
      });

      assert.ok(test);
    } catch (E) {
      console.error(E);
    }

    await store.close();
  });

  it('should call query() smoothly', async function () {
    let resource = new Fabric.Resource(widget);
    let store = new Fabric.Store();

    await store.open();

    try {
      resource.trust(store);
      let test = await resource.create({
        name: 'Wobbler'
      });

      let results = await resource.query();

      assert.ok(test);
      assert.ok(results);

      assert.equal(results.length, 1);
    } catch (E) {
      console.error(E);
    }

    await store.close();
  });
});
