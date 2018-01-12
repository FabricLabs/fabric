var assert = require('assert');
var expect = require('chai').expect;

var Remote = require('../lib/remote');
var HTTP = require('../lib/http');

var index = '/';

describe('Remote', function () {
  it('should expose a constructor', function () {
    assert.equal(typeof Remote, 'function');
  });

  it('can emulate HTTP GET', async function () {
    let server = new HTTP();
    let remote = new Remote({
      host: 'localhost:3000',
      secure: false
    });

    await server.start();

    let result = await remote._GET(index);

    await server.stop();

    assert.ok(result);
  });

  it('can emulate HTTP OPTIONS', async function () {
    let server = new HTTP();
    let remote = new Remote({
      host: 'localhost:3000',
      secure: false
    });

    await server.start();
    
    let result = await remote._OPTIONS(index);

    await server.stop();

    assert.ok(result);
  });

});
