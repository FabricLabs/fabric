var assert = require('assert');
var expect = require('chai').expect;

var Fabric = require('../');

describe('Transaction', function () {
  it('should initialize from nothing', function () {
    var transaction = new Fabric.Transaction();
    
    console.log('transaction:', transaction);
    
    assert.ok(transaction);
  });
});
