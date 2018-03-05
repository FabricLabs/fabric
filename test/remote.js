'use strict';

import Fabric from '../';

const assert = require('assert');
const expect = require('chai').expect;
const config = require('../package');

const index = '/';
const target = '/assets/test'
const sample = { address: 'malarkey' };
const unlock = {
  extra: 'fun!',
  address: 'pay-to-script-hash'
};

// includes an ARC with one definition, "Asset", for storing arbitrary data.
const assumption = '4ce23196792830a0f491105024bfb8cbad7e917e9210bbf636fad8cffb3285ea';

config.bootstrap = true;

describe('Remote', function () {
  this.timeout(30000);

  it('should expose a constructor', function () {
    assert.equal(typeof Fabric.Remote, 'function');
  });

  it('can use HTTP OPTIONS', async function () {
    let server = new Fabric.HTTP(config);
    let remote = new Fabric.Remote({
      host: 'localhost:3000',
      secure: false
    });

    await server.start();

    try {
      let local = new Fabric.Vector(server.resources)._sign();

      let result = await remote._OPTIONS('/');
      let answer = new Fabric.Vector(result['@data'])._sign();

      assert.equal(answer['@id'], assumption);
      assert.equal(answer['@id'], local['@id']);
    } catch (E) {
      console.error(E);
      assert.fail(E);
    }

    await server.stop();
  });

  it('can use HTTP GET', async function () {
    let server = new Fabric.HTTP(config);
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

      assert.equal(answer['@id'], test['@id']);
    } catch (E) {
      console.error(E);
      assert.fail(E);
    }

    await server.stop();
  });

  it('can use HTTP PUT', async function () {
    let server = new Fabric.HTTP(config);
    let remote = new Fabric.Remote({
      host: 'localhost:3000',
      secure: false
    });

    await server.start();

    try {
      let test = new Fabric.Vector(sample)._sign();

      let request = await remote._PUT(target, test['@data']);
      let attempt = new Fabric.Vector(request)._sign();

      let result = await remote._GET(target);
      let answer = new Fabric.Vector(result['@data'])._sign();

      assert.equal(answer['@id'], test['@id']);
    } catch (E) {
      console.error(E);
      assert.fail(E);
    }

    await server.stop();
  });

  it('can use HTTP POST', async function () {
    let server = new Fabric.HTTP(config);
    let remote = new Fabric.Remote({
      host: 'localhost:3000',
      secure: false
    });

    await server.start();

    try {
      let test = new Fabric.Vector(sample)._sign();

      let request = await remote._POST('/assets', test['@data']);
      let attempt = new Fabric.Vector(request)._sign();

      let result = await remote._GET(target);
      let answer = new Fabric.Vector(result['@data'])._sign();

      assert.equal(answer['@id'], test['@id']);
    } catch (E) {
      console.error(E);
      assert.fail(E);
    }

    await server.stop();
  });

  it('can use HTTP PATCH', async function () {
    let server = new Fabric.HTTP(config);
    let remote = new Fabric.Remote({
      host: 'localhost:3000',
      secure: false
    });

    await server.start();
    await server.flush();

    try {
      let test = new Fabric.Vector(unlock)._sign();
      let lock = new Fabric.Vector(sample)._sign();

      let request = await remote._POST('/assets', sample);
      let attempt = new Fabric.Vector(request)._sign();
      // TODO: use `id` (internalize to Fabric)
      let id = '/assets/' + attempt['@id'];

      let result = await remote._PATCH(id, unlock);
      let claim = new Fabric.Vector(result['@data'])._sign();

      let outcome = await remote._GET(id);
      let answer = new Fabric.Vector(outcome['@data'])._sign();

      console.debug('patch test:', test);
      console.debug('patch request POST returned:', request);
      console.debug('patch attempt POST vectorized:', attempt);
      console.debug('patch result:', result);
      console.debug('patch claim:', claim);
      console.debug('patch answer:', answer);

      let set = await remote._GET('/assets');

      console.debug('unlock:', unlock);
      console.debug('set:', set);

      assert.equal(attempt['@id'], lock['@id']);
      assert.equal(answer['@id'], test['@id']);
    } catch (E) {
      console.error(E);
      assert.fail(E);
    }

    await server.stop();
  });
});
