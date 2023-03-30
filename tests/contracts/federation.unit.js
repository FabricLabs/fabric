'use strict';

const assert = require('assert');
const settings = require('../../fixtures')
const Federation = require('../../contracts/federation');

describe('@fabric/core/contracts/federation', function () {
  describe('Federation', function () {
    it('exists', function () {
      assert.ok(Federation);
    });

    it('can execute', function () {
      const federation = Federation(settings);
      assert.ok(federation);
    });
  });
});
