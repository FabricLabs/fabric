var assert = require('assert');
var expect = require('chai').expect;

var Fabric = require('../');

describe('App', function () {

  it('should expose a constructor', function () {
    assert.equal(typeof Fabric.App, 'function');
  });

  it('should create an application smoothly', async function () {
    var app = new Fabric.App();

    await app.tips.close();
    await app.stash.close();

    console.log('app:', app);

    assert.ok(app);

  });

  it('should load data from an oracle', async function () {
    var oracle = new Fabric.Oracle({
      path: './data/oracle'
    });
    var app = new Fabric.App();
    
    console.log('app:', app);
    console.log('orace:', oracle);

    await oracle._load('./resources');

    await app._defer(oracle);
    await app._explore();

    await app.tips.close();
    await app.stash.close();
    await oracle.store.close();

    assert.ok(oracle);
    assert.ok(app);
  });
});
