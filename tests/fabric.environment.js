'use strict';

// Dependencies
const Environment = require('../types/environment');
const assert = require('assert');

describe('@fabric/core/types/environment', function () {
  describe('Environment', function () {
    it('is a constructor', function () {
      assert.equal(Environment instanceof Function, true);
    });

    it('can check for store', async function () {
      let environment = new Environment();
      let exists = environment.storeExists();

      assert.ok(environment);
      assert.equal(typeof exists, 'boolean');
    });
  });
});
