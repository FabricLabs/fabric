'use strict';

const Fabric = require('../');

const assert = require('assert');
const expect = require('chai').expect;

describe('Validator', function () {
  it('should consider a valid object valid', function () {
    var validator = new Fabric.Validator({
      'properties': {
        'foo': { 'type': 'string' },
        'bar': { 'type': 'number', 'maximum': 3 }
      }
    });
    
    var valid = validator.validate({
      'foo': 'Hello, world!',
      'bar': 3
    });
    
    assert.ok(valid);
    
  });
  
  it('should consider an invalid object invalid', function () {
    var validator = new Fabric.Validator({
      'properties': {
        'foo': { 'type': 'string' },
        'bar': { 'type': 'number', 'maximum': 3 }
      }
    });
    
    var valid = validator.validate({
      'foo': 'Hello, world!',
      'bar': 5
    });
    
    assert.equal(valid, false);
    
  });
});
