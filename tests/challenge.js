'use strict';

const Fabric = require('../');

const assert = require('assert');
const expect = require('chai').expect;

var Challenge = require('../lib/challenge');
var Vector = require('../lib/vector');

var fixture = 'e8a00ce65c62638eef903fe57ba8b4ea6340eaf691916d4bd76d54266f982746';

describe('Challenge', function () {
  it('should expose a constructor', function () {
    assert.equal(typeof Challenge, 'function');
  });

  it('can be instantiated', function () {
    var challenge = new Challenge();
    assert.ok(challenge);
  });

  it('can be patched', function () {
    var challenge = new Challenge();
    challenge.patch([
      { op: 'add' , path: '/omega', value: '1' }
    ]);
    challenge._sign();
    assert.equal(challenge['@data'].omega, 1);
  });
  
  it('can validate a vector', function () {
    var challenge = new Challenge();
    challenge.patch([
      { op: 'add' , path: '/omega', value: '1' }
    ]);
    challenge._sign();

    var vector = new Vector({
      omega: '1'
    });
    vector._sign();
    
    var result = challenge.validate(vector);
    assert.equal(result, true);
    assert.equal(challenge['@id'], fixture);
  });
});
