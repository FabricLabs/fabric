'use strict';

import Fabric from '../';

const assert = require('assert');
const expect = require('chai').expect;

const key = '/test';
const data = require('../data/message');

describe('Store', function () {
  it('should expose a constructor', function () {
    assert.equal(typeof Fabric.Store, 'function');
  });

  it('should be able to set a value', async function () {
    let store = new Fabric.Store();
    
    await store.open();

    try {
      let result = await store.set('/foo', data['@data']);
      assert.equal(result, data['@data']);
    } catch (E) {
      console.error(E);
      assert.fail(E);
    }

    await store.close();
  });
  
  it('should be able to retrieve a value', async function () {
    let store = new Fabric.Store();
    
    await store.open();

    try {
      let input = await store.set(key, data['@data']);
      let output = await store.get(key);
      assert.equal(output, data['@data']);
    } catch (E) {
      console.error(E);
      assert.fail(E);
    }

    await store.close();
  });
});
