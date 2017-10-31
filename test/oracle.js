var assert = require('assert');
var expect = require('chai').expect;

var Oracle = require('../lib/oracle');

var key = '/test';
var list = '/messages';
var data = require('../data/message');

describe('Oracle', function () {
  it('should expose a constructor', function () {
    assert.equal(typeof Oracle, 'function');
  });
  
  it('can emulate HTTP PUT', async function () {
    var oracle = new Oracle();
    var result = await oracle._PUT(key, data['@data']);
    await oracle.store.close();
    assert.ok(result);
  });
  
  it('can emulate HTTP GET', async function () {
    var oracle = new Oracle();
    var starts = await oracle._PUT(key, data['@data']);
    var result = await oracle._GET(key);
    await oracle.store.close();
    assert.ok(result);
  });
  
  it('can emulate HTTP POST', async function () {
    var oracle = new Oracle();
    var setup = await oracle._PUT(list, []);
    var result = await oracle._POST(list, data['@data']);
    var output = await oracle._GET(list);

    output = JSON.parse(output);
    
    await oracle.store.close();
    
    assert.equal(output.length, 1);
    assert.equal(output[0], data['@data']);
    assert.ok(result);
  });
});
