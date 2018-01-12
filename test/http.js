var assert = require('assert');
var expect = require('chai').expect;

var Fabric = require('../');

describe('HTTP', function () {
  it('should expose a constructor', function () {
    assert.equal(typeof Fabric.HTTP, 'function');
  });

  it('can serve a resource', async function () {
    var server = new Fabric.HTTP();

    server.define('Widget', {
      properties: {
        name: { type: String , maxLength: 100 }
      },
      routes: {
        query: '/widgets',
        get: '/widgets/:id'
      }
    });
    
    let remote = new Fabric.Remote({
      host: 'localhost:3000',
      secure: false
    });

    let payload = {
      name: 'foobar'
    };

    let vector = new Fabric.Vector(payload);

    vector._sign();
    
    await server.start();

    let result = await remote._POST('/widgets', payload);
    let object = await remote._GET('/widgets');
    
    await server.stop();

    assert.equal(result['@id'], vector['@id']);
    assert.equal(object[0]['@id'], vector['@id']);
  });
});
