'use strict';

const assert = require('assert');
const settings = require('../fixtures')
const Federation = require('../../contracts/federation');

describe('@fabric/core/types/federation', function () {
  describe('Federation', function () {
    it('can smoothly create a default federation', function () {
      const federation = new Federation();

      assert.ok(federation);
      assert.ok(federation.id);
    });

    it('can smoothly create the test federation', function () {
      const federation = new Federation(settings);

      assert.ok(federation);
      assert.ok(federation.id);
    });
  });
});
