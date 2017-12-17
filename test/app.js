var assert = require('assert');
var expect = require('chai').expect;

var Fabric = require('../');

describe('App', function () {

  it('should expose a constructor', function () {
    assert.equal(typeof Fabric.App, 'function');
  });

  it('should create an application smoothly', function () {
    var app = new Fabric.App();
    assert.ok(app);
  });

  it('should load data from an oracle', async function () {

    var oracle = new Fabric.Oracle({
      path: './data/oracle'
    });
    var app = new Fabric.App();

    await oracle._load('./resources');

    await app._defer(oracle);
    await app._explore();

    assert.ok(oracle);
    assert.ok(app);
  });
});
