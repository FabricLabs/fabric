'use strict';

import Fabric from '../';

const assert = require('assert');
const expect = require('chai').expect;

describe('Machine', function () {
  it('should correctly compute a known instruction', function () {
    var machine = new Fabric.Machine();

    machine.define('OP_TEST', function (state) {
      return true;
    });

    machine.stack.push('OP_TEST');

    machine.step();

    assert.equal(machine['@data'], true);
    assert.equal(machine.clock, 1);
  });
});
