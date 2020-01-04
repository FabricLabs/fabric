'use strict';

const Fabric = require('../');
const assert = require('assert');

describe('@fabric/core/types/resource', function () {
  describe('Resource', function () {
    it('is available from @fabric/core', function () {
      assert.equal(Fabric.Resource instanceof Function, true);
    });
  });
});
