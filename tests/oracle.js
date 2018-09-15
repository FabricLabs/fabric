'use strict';

const Fabric = require('../');

const assert = require('assert');
const expect = require('chai').expect;

const fs = require('fs');

const index = '/artifacts';
const key = '/artifacts/key';
const list = '/messages';
const message = require('../data/message');

const target = { extra: 'foo' };

describe('Oracle', function () {
  it('should expose a constructor', function () {
    assert.equal(Fabric.Oracle instanceof Function, true);
  });

  it('can emulate HTTP PUT', async function () {
    let oracle = new Fabric.Oracle();
    let sanity = new Fabric.Vector('Hello, world.')._sign();

    await oracle.storage.open();

    try {
      let maybe = new Fabric.Vector(target)._sign();
      let vector = new Fabric.Vector(message['@data'])._sign();

      console.log('vector:', vector);
      assert.equal(vector['@id'], message['@id']);

      let result = await oracle._PUT(key, vector['@data']);
      let solution = new Fabric.Vector(result)._sign();

      console.log('result:', result);
      console.log('solution:', solution);

      assert.equal(solution['@id'], sanity['@id']);

      let again = await oracle._PUT(key, target);
      let attempt = new Fabric.Vector(again)._sign();
      let replaced = await oracle._GET(key);

      console.log('replaced:', replaced);
      console.log('attempt:', attempt);

      assert.equal(attempt['@id'], message['@challenge']);
    } catch (E) {
      console.error(E);
      assert.fail(E);
    }

    await oracle.storage.close();
  });

  it('can emulate HTTP OPTIONS', async function () {
    let oracle = new Fabric.Oracle();

    await oracle.storage.open();

    try {
      let test = new Fabric.Vector(message['@data'])._sign();
      
      let starts = await oracle._PUT(key, test['@data']);
      let result = await oracle._OPTIONS(key);
      
      console.log('options:', result);
      
      assert.equal(result['@id'], test['@id']);
    } catch (E) {
      console.error(E);
      assert.fail(E);
    }

    await oracle.storage.close();
  });

  it('can emulate HTTP PATCH', async function () {
    let oracle = new Fabric.Oracle();
    let sanity = new Fabric.Vector('Hello, world.')._sign();
    console.log('sanity:', sanity);

    await oracle.storage.open();

    try {
      let test = new Fabric.Vector(target)._sign();
      let starts = await oracle._PUT(key, test['@data']);
      console.log('starts:', starts);

      let seed = new Fabric.Vector(starts)._sign();

      assert.equal(seed['@id'], test['@id']);

      let result = await oracle._PATCH(key, target);
      console.log('result:', typeof result, result);

      let answer = new Fabric.Vector(result)._sign();
      console.log('answer:', answer);
      console.log('test:', test);

      assert.equal(answer['@id'], test['@id']);
    } catch (E) {
      console.error(E);
      assert.fail(E);
    }

    await oracle.storage.close();
  });

  it('can emulate HTTP GET', async function () {
    let oracle = new Fabric.Oracle();
    let sanity = new Fabric.Vector('Hello, world.')._sign();
    console.log('sanity:', sanity);

    await oracle.storage.open();

    try {
      let test = new Fabric.Vector(sanity['@data'])._sign();
      let starts = await oracle._PUT(key, test['@data']);
      console.log('starts:', starts);

      let seed = new Fabric.Vector(starts)._sign();

      assert.equal(seed['@id'], test['@id']);

      let result = await oracle._GET(key);
      let answer = new Fabric.Vector(result)._sign();

      console.log('result:', result);
      console.log('test:', test);

      assert.equal(answer['@id'], test['@id']);
    } catch (E) {
      console.error(E);
      assert.fail(E);
    }

    await oracle.storage.close();
  });

  it('can emulate HTTP POST', async function () {
    let oracle = new Fabric.Oracle();
    let sanity = new Fabric.Vector([])._sign();
    console.log('sanity:', sanity);

    await oracle.storage.open();

    try {
      let base = new Fabric.Vector(sanity['@data'])._sign();
      let test = new Fabric.Vector([target])._sign();
      let start = await oracle._GET(key);
      let item = new Fabric.Vector(target)._sign();

      let request = await oracle._POST(key, item['@data']);
      let response = new Fabric.Vector(request)._sign();

      console.log('dat response:', response);

      let last = await oracle._GET(key);
      let answer = new Fabric.Vector(last)._sign();

      console.log('answer:', answer);
      console.log('test:', test);
      console.log('last:', last);

      assert.equal(answer['@id'], test['@id']);
    } catch (E) {
      console.error(E);
      assert.fail(E);
    }

    await oracle.storage.close();
  });

  it('can emulate HTTP DELETE', async function () {
    let oracle = new Fabric.Oracle();

    await oracle.storage.open();

    try {
      let setup = await oracle._PUT(list, []);
      let result = await oracle._POST(list, message['@data']);
      let output = await oracle._DELETE(list);
      let after = await oracle._GET(list);
      assert.equal(output, null);
    } catch (E) {
      console.error(E);
      assert.fail(E);
    }

    await oracle.storage.close();
  });
  
  it('can load from a directory', async function () {
    fs.writeFileSync('./assets/test.txt', message['@data'], 'utf8');

    let oracle = new Fabric.Oracle();

    await oracle.storage.open();

    try {
      let output = await oracle._load([
        'app.jade',
        'cli.jade',
        'test.txt',
        'webcomponents-loader.js'
      ]);

      let assets = await oracle._OPTIONS('/assets');
      let result = await oracle._OPTIONS('/assets/test.txt');
      let vector = new Fabric.Vector(result['@data'])._sign();

      assert.equal(assets['@id'], '28f35faf2bee18c967b2f1d830fbccc7b57f4342bf828354e7a9bc71a54c5e9f');
      //assert.equal(result['@id'], message['@id']);
      assert.equal(vector['@id'], message['@id']);
    } catch (E) {
      console.error(E);
      assert.fail(E);
    }

    await oracle.storage.close();
  });
});
