'use strict';

import Fabric from '../';

const assert = require('assert');
const expect = require('chai').expect;

const widget = require('../data/widget');
const update = {
  name: 'updated!'
};
const last = {
  name: 'finally!'
};

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
      assert.fail(E);
    }

    await store.close();
  });

  it('should call create() smoothly', async function () {
    let resource = new Fabric.Resource(widget);
    let store = new Fabric.Store();

    await store.open();

    try {
      await resource.trust(store);
      await resource.flush();

      let test = await resource.create({
        name: Math.random()
      });

      let results = await resource.query();

      assert.ok(test);
      assert.ok(results);

      assert.equal(results.length, 1);
    } catch (E) {
      console.error(E);
      assert.fail(E);
    }

    await store.close();
  });

  it('should call query() smoothly', async function () {
    let resource = new Fabric.Resource(widget);
    let store = new Fabric.Store();

    await store.open();

    try {
      await resource.trust(store);
      await resource.flush();

      let test = await resource.create({
        name: 'Wobbler'
      });

      let results = await resource.query();

      assert.ok(test);
      assert.ok(results);

      assert.equal(results.length, 1);
    } catch (E) {
      console.error(E);
      assert.fail(E);
    }

    await store.close();
  });

  it('should call get() smoothly', async function () {
    let resource = new Fabric.Resource(widget);
    let store = new Fabric.Store();

    await store.open();

    try {
      await resource.trust(store);
      await resource.flush();

      let test = await resource.create({
        name: 'Wobbler'
      });

      let collection = await resource.query();
      let instance = await resource.get(test.id);

      assert.ok(test);
      assert.ok(collection);
      assert.ok(instance);

      assert.equal(collection.length, 1);
      assert.equal(instance.id, test.id);
    } catch (E) {
      console.error(E);
      assert.fail(E);
    }

    await store.close();
  });

  it('should call update() smoothly', async function () {
    let resource = new Fabric.Resource(widget);
    let store = new Fabric.Store();

    await store.open();

    try {
      await resource.trust(store);
      await resource.flush();

      let test = await resource.create({
        name: 'Wobbler'
      });

      let collection = await resource.query();
      let instance = await resource.get(test.id);

      assert.ok(test);
      assert.ok(collection);
      assert.ok(instance);

      assert.equal(collection.length, 1);
      assert.equal(instance.id, test.id);

      let result = await resource.update(test.id, update);
      let after = await resource.get(result.id);

      assert.equal(after['@data'].name, update.name);
    } catch (E) {
      console.error(E);
      assert.fail(E);
    }

    await store.close();
  });

  it('should call update() multiple times and resolve output', async function () {
    let resource = new Fabric.Resource(widget);
    let store = new Fabric.Store();

    await store.open();

    try {
      await resource.trust(store);
      await resource.flush();

      let test = await resource.create({
        name: 'Wobbler'
      });

      let collection = await resource.query();
      let instance = await resource.get(test.id);

      assert.ok(test);
      assert.ok(collection);
      assert.ok(instance);

      assert.equal(collection.length, 1);
      assert.equal(instance.id, test.id);

      let result = await resource.update(test.id, update);
      let after = await resource.get(result.id);

      assert.equal(after['@data'].name, update.name);

      let again = await resource.update(test.id, last);
      let final = await resource.get(again.id);

      assert.equal(final['@data'].name, last.name);
    } catch (E) {
      console.error(E);
      assert.fail(E);
    }

    await store.close();
  });
});
