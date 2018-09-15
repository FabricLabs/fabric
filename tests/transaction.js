'use strict';

const Fabric = require('../');

const assert = require('assert');
const expect = require('chai').expect;

describe('Transaction', function () {
  it('should initialize from nothing', function () {
    var transaction = new Fabric.Transaction();
    console.log('transaction:', transaction);
    assert.ok(transaction);
  });
});
