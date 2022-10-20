'use strict';

const assert = require('assert');
const Distribution = require('../../contracts/distribution');

describe('@fabric/core/types/distribution', function () {
  describe('Distribution', function () {
    it('can smoothly create a new distribution', function () {
      const distribution = new Distribution();
      assert.ok(distribution);
      assert.ok(distribution.id);
    });
  });
});
