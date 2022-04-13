'use strict';

const assert = require('assert');
const Oracle = require('../types/oracle');

const message = require('../assets/message');

describe('@fabric/core/types/oracle', function () {
  describe('Oracle', function () {
    it('is available from @fabric/core', function () {
      assert.equal(Oracle instanceof Function, true);
    });

    it('can use _SET', async function () {
      const oracle = new Oracle();

      await oracle.start();
      await oracle._SET('sample', message['@data']);
      await oracle.stop();

      assert.ok(oracle);
    });

    xit('can store a string value', async function () {
      const oracle = new Oracle();

      await oracle.start();
      const set = await oracle._SET('sample', message['@data']);
      const get = await oracle._GET('sample');
      await oracle.stop();

      assert.ok(oracle);
      assert.equal(typeof get, 'string');
    });
  });
});
