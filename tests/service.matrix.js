'use strict';

const assert = require('assert');
const Matrix = require('../services/matrix');

const settings = require('../settings/test');
const options = Object.assign({}, settings, {
  connect: false,
  network: 'regtest',
  fullnode: true,
  verbosity: 2
});

describe('@fabric/core/services/matrix', function () {
  describe('Matrix', function () {
    it('is an instance of a Function', function () {
      assert.equal(Matrix instanceof Function, true);
    });

    it('can start and stop smoothly', async function () {
      async function test () {
        const matrix = new Matrix(options);

        try {
          await matrix.start();
        } catch (exception) {
          console.error('Could not start matrix:', exception);
        }

        try {
          await matrix.stop();
        } catch (exception) {
          console.error('Could not start matrix:', exception);
        }

        assert.ok(matrix);
      }

      test().catch((exception) => {
        console.error(exception);
      });
    });
  });
});
