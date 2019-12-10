'use strict';

const Fabric = require('../');

const assert = require('assert');
const expect = require('chai').expect;

describe('App', function () {
  xit('should expose a constructor', function () {
    assert.equal(typeof Fabric.App, 'function');
  });

  xit('should create an application smoothly', async function () {
    let app = new Fabric.App();
    await app.start();
    await app.stop();
    assert.ok(app);
  });

  xit('should load data from an oracle', async function () {
    let app = new Fabric.App();
    let oracle = new Fabric.Oracle({
      path: './data/oracle'
    });

    await app.start();
    await oracle.start();

    await oracle._load('./resources');
    await app._defer(oracle);
    // await app._explore();

    await app.stop();
    await oracle.stop();

    assert.ok(oracle);
    assert.ok(app);
  });
});
