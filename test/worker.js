var assert = require('assert');
var expect = require('chai').expect;

var Worker = require('../lib/worker');

describe('Worker', function () {
  it('should expose a constructor', function () {
    assert.equal(typeof Worker, 'function');
  });
  
  it('should call a method', function (done) {
    var worker = new Worker();
    
    worker.on('pong', done);
    worker.route('PING');

  });
});
