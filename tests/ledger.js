'use strict';

import Fabric from '../';

const assert = require('assert');
const expect = require('chai').expect;

var Ledger = require('../lib/ledger');

describe('Ledger', function () {
  it('should expose a constructor', function () {
    assert.equal(typeof Ledger, 'function');
  });

  it('can have a message appended', function () {
    var ledger = new Ledger();

    ledger.append('Hello, world');

    var output = ledger.render();
    var sample = '[{"op":"add","path":"/0","value":"Hello, world"}]';

    assert.equal(sample, JSON.stringify(output));
  });
});
