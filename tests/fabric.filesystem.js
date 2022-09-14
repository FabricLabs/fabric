'use strict';

const assert = require('assert');
const settings = require('../settings/test');

const Actor = require('../types/actor');
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

    it('can publish to a local filesystem', async function () {
      const actor = new Actor({ name: 'Satoshi Nakamoto' });
      const filesystem = new Filesystem({
        path: './stores/filesystem'
      });

      await filesystem.start();

      await filesystem.publish('author.txt', actor.state.name);
      await filesystem.publish('author.json', actor.export());
      await filesystem.publish('actor.json', actor.generic);

      assert.ok(filesystem);
      assert.ok(filesystem.id);

      // Files by SHA256 hash of their contents
      assert.deepEqual(filesystem.hashes, [
        '06aacc11fde688e1da1f0143ef9071cfb6b415898b0956dfe5c204de2fc4cdb7',
        'cb9756da594c06bddc1487bfb1a6fea17285733abc3229ac7ac33c29d3162748',
        'a0dc65ffca799873cbea0ac274015b9526505daaaed385155425f7337704883e'
      ]);

      assert.deepEqual(filesystem.files, [
        'actor.json',
        'author.json',
        'author.txt'
      ]);

      assert.deepEqual(filesystem.leaves, [
        'f033b0e2f278b9bc0f9162277b5b69184ff044bfe649c86b83ee780092afff51',
        '0fd41456625d26d13683a73cb4e69d38ac502a43c42191ea4ba2fe342233b683',
        'cbe1ebec919cbcb3ee28bf4fed8a8166c2a4aaa594204ac182dec1b1344a95b3'
      ]);
    });
  });
});
