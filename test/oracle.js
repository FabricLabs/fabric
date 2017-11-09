var assert = require('assert');
var expect = require('chai').expect;

var fs = require('fs');

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

  it('can emulate HTTP PATCH', async function () {
    var oracle = new Oracle();
    var setup = await oracle._PUT(list, []);
    var result = await oracle._POST(list, data['@data']);
    var patches = await oracle._PATCH(list, [{
      extra: 'foo'
    }]);
    var output = await oracle._GET(list);

    output = JSON.parse(output);

    await oracle.store.close();

    assert.equal(output[0].extra, 'foo');
    assert.ok(result);
  });

  it('can emulate HTTP DELETE', async function () {
    var oracle = new Oracle();
    var setup = await oracle._PUT(list, []);
    var result = await oracle._POST(list, data['@data']);
    var output = await oracle._DELETE(list);

    output = JSON.parse(output);
    
    await oracle.store.close();
    
    assert.equal(output, null);
  });
  
  it('can load from a directory', async function () {
    fs.writeFileSync('./assets/test.txt', 'Hello, world!', 'utf8');
    
    var oracle = new Oracle();
    var output = await oracle._load('./assets');
    var assets = await oracle._OPTIONS('/assets');
    var result = await oracle._OPTIONS('/assets/test.txt');

    await oracle.store.close();
    
    assert.equal(result['@id'], '19270ea4f98808a63fbb99bc26a5ee6f0fe8df9c8182cf1d710b115d57250578');
    assert.equal(assets['@id'], 'd854308dc41ef92196c846c3591fdc2a47bd5dc219fa04d34d4b5aee71bb5336');
  });
});
