'use strict';

const Fabric = require('../');

const assert = require('assert');
const expect = require('chai').expect;

describe('Worker', function () {
  it('should expose a constructor', function () {
    assert.equal(typeof Fabric.Worker, 'function');
  });
  
  it('should call a method', function (done) {
    var worker = new Fabric.Worker();
    
    worker.on('pong', done);
    worker.route('PING');

  });
});
