'use strict';

const assert = require('assert');
const settings = require('../settings/test');
const Federation = require('../types/federation');

describe('@fabric/core/types/federation', function () {
  describe('Federation', function () {
    xit('is available from @fabric/core', function () {
      assert.equal(Federation instanceof Function, true);
    });

    it('can smoothly create a new federation', function () {
      const federation = new Federation();
      assert.ok(federation);
      assert.ok(federation.id);
    });

    it('can start and stop', async function () {
      const federation = new Federation();
      federation.start();
      federation.stop();
      assert.ok(federation);
      assert.ok(federation.id);
    });
  });
});
