var assert = require('assert');
var expect = require('chai').expect;

var fs = require('fs');

var Remote = require('../lib/remote');

var key = '';

describe('Remote', function () {
  this.timeout(30000);
  
  it('should expose a constructor', function () {
    assert.equal(typeof Remote, 'function');
  });

  it('can emulate HTTP GET', async function () {
    var remote = new Remote({
      host: 'example.com'
    });
    var result = await remote._GET(key);

    assert.ok(result);
  });

  it('can emulate HTTP OPTIONS', async function () {
    var remote = new Remote({
      host: 'maki.io'
    });
    var result = await remote._OPTIONS(key);
    
    console.log('result:', result);

    assert.ok(result);
  });

});
