'use strict';

// require('debug-trace')({ always: true });

const config = require('../settings/test');
const Matrix = require('../services/matrix');

// Testing
const assert = require('assert');

describe('@fabric/core/types/matrix', function () {
  describe('Matrix', function () {
    it('should expose a constructor', function () {
      assert.equal(Matrix instanceof Function, true);
    });

    it('can start and stop cleanly', async function () {
      const matrix = new Matrix();
      await matrix.start();
      await matrix.stop();
      assert.ok(matrix);
    });

    it('can start and stop with the test configuration', async function () {
      const matrix = new Matrix(config);
      await matrix.start();
      await matrix.stop();
      assert.ok(matrix);
    });
  });
});
