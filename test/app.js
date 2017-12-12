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
});
