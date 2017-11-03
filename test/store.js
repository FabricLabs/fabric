var assert = require('assert');
var expect = require('chai').expect;

var Store = require('../lib/store');

var key = '/test';
var data = require('../data/message');

describe('Store', function () {
  it('should expose a constructor', function () {
    assert.equal(typeof Store, 'function');
  });
  
  it('should be able to set a value', async function () {
    var store = new Store();
    var result = await store.set('/foo', data['@data']);
    
    await store.close();
    
    assert.equal(result, data['@data']);
  });
  
  it('should be able to retrieve a value', async function () {
    var store = new Store();
    var input = await store.set(key, data['@data']);

    var output = await store.get(key);
    await store.close();

    assert.equal(output, data['@data']);
  });

});
