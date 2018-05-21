'use strict';

import Fabric from '../';

const assert = require('assert');
const expect = require('chai').expect;
const config = require('../package');

const target = '/assets/test';
const sample = { address: 'malarkey' };
const unlock = {
  extra: 'fun!',
  address: 'pay-to-script-hash'
};

const Widget = require('../data/widget');

// includes an ARC with one definition, "Widget", for storing arbitrary data.
// NOTE: HTTP also includes "Index" and "Asset" by default.
// TODO: fix bug on Index resource; should not have "view" path
const assumption = 'bc128b68d26860b266226a5f4d435b44764beb899026bf13ff600facd3f18782';

config.bootstrap = true;
config.directories = { components: 'components' };
config.resources = { Widget };

describe('Remote', function () {
  it('should expose a constructor', function () {
    assert.equal(Fabric.Remote instanceof Function, true);
  });

  it('can enumerate a remote', async function () {
    let server = new Fabric.HTTP(config);
    let remote = new Fabric.Remote({
      host: 'localhost:3000',
      secure: false
    });

    await server.start();

    try {
      let sample = await server._OPTIONS();
      let local = new Fabric.Vector(sample)._sign();

      let result = await remote.enumerate();
      let answer = new Fabric.Vector(result)._sign();

      console.log('testing:', answer);

      assert.equal(answer['@id'], assumption);
      assert.equal(answer['@id'], local['@id']);
    } catch (E) {
      console.error(E);
      assert.fail(E);
    }

    await server.stop();
  });

  it('can use HTTP OPTIONS', async function () {
    let server = new Fabric.HTTP(config);
    let remote = new Fabric.Remote({
      host: 'localhost:3000',
      secure: false
    });

    await server.start();

    try {
      let sample = await server._OPTIONS();
      let local = new Fabric.Vector(sample)._sign();

      let result = await remote._OPTIONS('/');
      let answer = new Fabric.Vector(result)._sign();

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
      let answer = new Fabric.Vector(result)._sign();

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
      let answer = new Fabric.Vector(result)._sign();

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

      let request = await remote._POST('/widgets', test['@data']);
      let attempt = new Fabric.Vector(request)._sign();

      let result = await remote._GET(`/widgets/${test.id}`);
      let answer = new Fabric.Vector(result)._sign();

      assert.equal(attempt['@id'], test['@id']);
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
      let claim = new Fabric.Vector(result)._sign();

      let outcome = await remote._GET(id);
      let answer = new Fabric.Vector(outcome)._sign();

      assert.equal(attempt['@id'], lock['@id']);
      assert.equal(answer['@id'], test['@id']);
    } catch (E) {
      console.error(E);
      assert.fail(E);
    }

    await server.stop();
  });
});
