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
      const oracle = new Oracle({ persistent: false });

      await oracle.start();
      const written = await oracle._SET('sample', message['@data']);
      await oracle.stop();

      assert.ok(oracle);
      assert.strictEqual(written, message['@data']);
    });

    it('can store a string value', async function () {
      const oracle = new Oracle({ persistent: false });
      const payload = message['@data'];

      await oracle.start();
      const written = await oracle._SET('sample', payload);
      const got = await oracle._GET('sample');
      const missing = await oracle._GET('does-not-exist');
      await oracle.stop();

      assert.strictEqual(written, payload);
      assert.strictEqual(got, payload);
      assert.strictEqual(missing, null);
    });
  });
});
