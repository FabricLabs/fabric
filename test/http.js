const assert = require('assert');
const expect = require('chai').expect;

const Fabric = require('../');
const widget = {
  name: 'Widget',
  properties: {
    name: { type: String , maxLength: 100 }
  },
  routes: {
    query: '/widgets',
    get: '/widgets/:id'
  }
};

const sample = {
  name: 'garbage'
};

const genesis = 'f7c2216c978fea8f83da5c4e0739031b8fbfa34fe8ea5d8bcef7921c3ab3f041';

describe('HTTP', function () {
  it('should expose a constructor', function () {
    assert.equal(typeof Fabric.HTTP, 'function');
  });
  
  it('can clean up after itself', async function () {
    let server = new Fabric.HTTP();

    await server.define('Widget', widget);
    await server.start();
    await server.flush();

    let start = await server._GET('/widgets');
    assert.equal(start, null);

    let test = Fabric.Vector(sample)._sign();
    assert.equal(test['@id'], genesis);

    let result = await server._POST('/widgets', sample);
    assert.equal(result['@id'], genesis);

    let vector = Fabric.Vector(result['@data'])._sign();
    assert.equal(vector['@id'], genesis);

    let collection = await server._GET('/widgets');
    assert.equal(collection[0].name, sample.name);

    let inner = Fabric.Vector(collection[0])._sign();
    assert.equal(inner['@id'], genesis);

    await server.flush();

    let after = await server._GET('/widgets');
    assert.equal(after, null);

    await server.stop();
  });
  
  it('can serve a resource', async function () {
    let server = new Fabric.HTTP();

    await server.define('Widget', widget);
    await server.start();
    await server.flush();

    let start = await server._GET('/widgets');
    assert.equal(start, null);

    let test = Fabric.Vector(sample)._sign();
    assert.equal(test['@id'], genesis);

    let result = await server._POST('/widgets', sample);
    assert.equal(result['@id'], genesis);

    let vector = Fabric.Vector(result['@data'])._sign();
    assert.equal(vector['@id'], genesis);

    let collection = await server._GET('/widgets');
    assert.equal(collection[0].name, sample.name);

    let remote = new Fabric.Remote({
      host: 'localhost:3000',
      secure: false,
      path: 'data/remote'
    });

    let claim = remote._GET('/widgets');

    await server.flush();

    let after = await server._GET('/widgets');
    assert.equal(after, null);

    await server.stop();
  });

  xit('can serve a resource', async function () {
    let server = new Fabric.HTTP();

    server.define('Widget', widget);
    
    await server.start();
    await server.flush();

    try {
      
      let remote = new Fabric.Remote({
        host: 'localhost:3000',
        secure: false
      });

      let payload = {
        name: 'foobar'
      };

      let vector = Fabric.Vector(payload)._sign();

      await server.flush();

      let result = await remote._POST('/widgets', payload);
      let collection = await remote._GET('/widgets');

      await server.flush();
      await server.stop();

      assert.equal(result['@id'], vector['@id']);
      assert.equal(collection[0]['@id'], vector['@id']);
    } catch (E) {
      console.error(E);
    }

  });
  
  xit('correctly aggregates created objects', async function () {
    try {
      let server = new Fabric.HTTP();

      server.define('Widget', widget);

      let remote = new Fabric.Remote({
        host: 'localhost:3000',
        secure: false
      });

      let oldest = {
        name: 'foobar'
      };

      let newest = {
        name: 'foobaz'
      };

      let elder = Fabric.Vector(oldest)._sign();
      let child = Fabric.Vector(newest)._sign();

      await server.start();
      await server.flush();

      let result = await remote._POST('/widgets', oldest);
      let latest = await remote._POST('/widgets', newest);

      let collection = await remote._GET('/widgets');

      await server.flush();
      await server.stop();

      //console.log('full list:', collection);

      assert.equal(result['@id'], elder['@id']);
      assert.equal(latest['@id'], child['@id']);

      assert.equal(collection[0]['@id'], child['@id']);
      assert.equal(collection[1]['@id'], elder['@id']);
    } catch (E) {
      console.error(E);
    }
  });
});
