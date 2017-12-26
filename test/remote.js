var assert = require('assert');
var expect = require('chai').expect;

var Remote = require('../lib/remote');
var HTTP = require('../lib/http');

var server = new HTTP();
var index = '/';

describe('Remote', function () {
  before(async function () {
    await server.start();
  });

  after(async function () {
    await server.stop();
  });

  it('should expose a constructor', function () {
    assert.equal(typeof Remote, 'function');
  });

  it('can emulate HTTP GET', async function () {
    var remote = new Remote({
      host: 'localhost:3000',
      secure: false
    });
    var result = await remote._GET(index);

    assert.ok(result);
  });

  it('can emulate HTTP OPTIONS', async function () {
    var remote = new Remote({
      host: 'localhost:3000',
      secure: false
    });
    var result = await remote._OPTIONS(index);

    assert.ok(result);
  });

});
