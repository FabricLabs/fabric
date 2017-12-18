var assert = require('assert');
var expect = require('chai').expect;

var Store = require('../lib/store');

var key = '/test';
var data = require('../data/message');

var store = new Store();

describe('Store', function () {
  after(async function () {
    await store.close();
  });
  
  it('should expose a constructor', function () {
    assert.equal(typeof Store, 'function');
  });

  it('should be able to set a value', async function () {
    var result = await store.set('/foo', data['@data']);

    assert.equal(result, data['@data']);
  });
  
  it('should be able to retrieve a value', async function () {
    var input = await store.set(key, data['@data']);
    var output = await store.get(key);

    assert.equal(output, data['@data']);
  });
});
