var assert = require('assert');
var expect = require('chai').expect;

var Fabric = require('../');

var sample = '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a';

describe('Vector', function () {
  it('should expose a constructor', function () {
    assert.equal(typeof Fabric.Vector, 'function');
  });

  it('should create null vectors smoothly', function () {
    var vector = new Fabric.Vector();
    assert.ok(vector);
  });
  
  it('correctly computes an identify function', function () {
    var vector = new Fabric.Vector();
    
    vector._identify(vector);
    
    assert.equal(vector['@id'], sample);
  });
});
