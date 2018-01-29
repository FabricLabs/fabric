'use strict';

import Fabric from '../';

const assert = require('assert');
const expect = require('chai').expect;

const index = '/';
const target = '/assets/test'
const sample = { address: 'malarkey' };

describe('Remote', function () {
  this.timeout(30000);

  it('should expose a constructor', function () {
    assert.equal(typeof Fabric.Remote, 'function');
  });

  it('can use HTTP GET', async function () {
    let server = new Fabric.HTTP({});
    let remote = new Fabric.Remote({
      host: 'localhost:3000',
      secure: false
    });

    await server.start();

    try {
      let local = await server.storage.get('/assets');
      let test = new Fabric.Vector(local)._sign();

      let result = await remote._GET('/assets');
      let answer = new Fabric.Vector(result['@data'])._sign();

      console.log('result:', result);
      console.log('sample:', answer);

      assert.equal(answer['@id'], test['@id']);
    } catch (E) {
      console.error(E);
      assert.fail(E);
    }

    await server.stop();
  });

  it('can use HTTP PUT', async function () {
    let server = new Fabric.HTTP({});
    let remote = new Fabric.Remote({
      host: 'localhost:3000',
      secure: false
    });

    await server.start();

    try {
      let test = new Fabric.Vector(sample)._sign();
      let request = await remote._PUT(target, test['@data']);
      let response = new Fabric.Vector(request)._sign();

      let result = await remote._GET(target);
      let answer = new Fabric.Vector(result['@data'])._sign();

      assert.equal(answer['@id'], test['@id']);
    } catch (E) {
      console.error(E);
      assert.fail(E);
    }

    await server.stop();
  });
});
