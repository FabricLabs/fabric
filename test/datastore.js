var assert = require('assert');
var expect = require('chai').expect;

var Fabric = require('../');

describe('Datastore', function () {
  it('should expose a constructor', function () {
    assert.equal(typeof Fabric.Datastore, 'function');
  });
  
  it('can initialize a datastore', function () {
    var datastore = new Fabric.Datastore();
    assert.ok(datastore);
  });
  
  it('can store and retrieve value', async function () {
    var datastore = new Fabric.Datastore();
    
    await datastore.put('test', 'foo');
    
    var data = await datastore.get('test');
    
    assert.equal('foo', data);
  });
});
