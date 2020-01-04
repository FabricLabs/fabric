'use strict';

const Fabric = require('../');
const assert = require('assert');

describe('@fabric/core/types/app', function () {
  describe('Scribe', function () {
    it('is available from @fabric/core', function () {
      assert.equal(Fabric.Scribe instanceof Function, true);
    });
  });
});
