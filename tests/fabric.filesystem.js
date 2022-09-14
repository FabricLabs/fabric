'use strict';

const assert = require('assert');
const settings = require('../settings/test');
const Filesystem = require('../types/filesystem');

describe('@fabric/core/types/filesystem', function () {
  describe('Filesystem', function () {
    xit('is available from @fabric/core', function () {
      assert.equal(Filesystem instanceof Function, true);
    });

    it('can smoothly create a new filesystem', function () {
      const filesystem = new Filesystem();
      assert.ok(filesystem);
      assert.ok(filesystem.id);
    });

    it('can import a local filesystem', async function () {
      const filesystem = new Filesystem({
        path: './tests/fixtures/filesystem'
      });

      await filesystem.start();

      assert.ok(filesystem);
      assert.ok(filesystem.id);

      // Files by SHA256 hash of their contents
      assert.deepEqual(filesystem.hashes, [
        '2b882d11abd2cb19c60e9b48579db250e8da111531e5ed62931fa2e7a9c5f002'
      ]);

      assert.deepEqual(filesystem.files, [
        'SAMPLE.md'
      ]);

      assert.deepEqual(filesystem.leaves, [
        '820c5b07868efb05ebe438d36f7586fa48e5de2985dff5e1622738c44dc103ec'
      ]);
    });
  });
});
