var assert = require('assert');
var expect = require('chai').expect;

var Fabric = require('../');
var server = new Fabric.HTTP();

describe('HTTP', function () {
  before(function (done) {
    server.define('Widget', {
      properties: {
        name: { type: String , maxLength: 100 }
      },
      routes: {
        query: '/widgets',
        get: '/widgets/:id'
      }
    });

    server.start(done);
  });

  after(async function () {
    await server.stop();
  });

  it('should expose a constructor', function () {
    assert.equal(typeof Fabric.HTTP, 'function');
  });

  it('can serve a resource', async function () {
    let remote = new Fabric.Remote({
      host: 'localhost:3000',
      secure: false
    });

    let payload = {
      name: 'foobar'
    };

    let vector = new Fabric.Vector(payload);

    vector._sign();

    let result = await remote._POST('/widgets', payload);
    let object = await remote._GET('/widgets');
    
    console.log('result:', result);
    console.log('object:', object);

    assert.equal(result['@id'], vector['@id']);
    assert.equal(object[0]['@id'], vector['@id']);
  });
});
