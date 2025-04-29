'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const settings = require('../settings/test');

const Actor = require('../types/actor');
const Filesystem = require('../types/filesystem');

describe('@fabric/core/types/filesystem', function () {
  describe('Filesystem', function () {
    let filesystem;
    let testDir;

    beforeEach(function () {
      // Create or clear the test directory
      testDir = path.join('./stores/test');
      if (fs.existsSync(testDir)) {
        // Clear the directory if it exists
        fs.readdirSync(testDir).forEach(file => {
          fs.unlinkSync(path.join(testDir, file));
        });
      } else {
        // Create the directory if it doesn't exist
        fs.mkdirSync(testDir, { recursive: true });
      }
      filesystem = new Filesystem({ path: testDir });
    });

    afterEach(function () {
      // Clean up the temporary directory
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    });

    it('is available from @fabric/core', function () {
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
        path: testDir
      });

      await filesystem.start();

      // Publish files
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

      // Ensure all files are written and synced
      await filesystem.sync();

      // Additional content verification
      const authorTxt = fs.readFileSync(path.join(testDir, 'author.txt'), 'utf8');
      assert.strictEqual(authorTxt, 'Satoshi Nakamoto');

      const authorJson = JSON.parse(fs.readFileSync(path.join(testDir, 'author.json'), 'utf8'));
      assert.strictEqual(authorJson.object.name, 'Satoshi Nakamoto');

      const actorJson = JSON.parse(fs.readFileSync(path.join(testDir, 'actor.json'), 'utf8'));
      assert.strictEqual(actorJson.object.name, 'Satoshi Nakamoto');
    });

    it('can delete from a local filesystem', async function () {
      const actor = new Actor({ name: 'Satoshi Nakamoto' });
      const filesystem = new Filesystem({
        path: testDir
      });

      await filesystem.start();

      await filesystem.publish('accident.txt', actor.state.name);
      const created = fs.existsSync(path.join(testDir, 'accident.txt'));
      filesystem.delete('accident.txt');
      const deleted = !fs.existsSync(path.join(testDir, 'accident.txt'));

      assert.ok(filesystem);
      assert.ok(filesystem.id);
      assert.ok(created);
      assert.ok(deleted);
    });

    it('can handle file operations with subdirectories', async function () {
      const filesystem = new Filesystem({
        path: testDir
      });

      await filesystem.start();

      // Test writing to a subdirectory
      const result = filesystem.writeFile('subdir/test.txt', 'Hello, World!');
      assert.strictEqual(result, true);
      assert.strictEqual(fs.existsSync(path.join(testDir, 'subdir/test.txt')), true);

      // Test reading from a subdirectory
      const content = filesystem.readFile('subdir/test.txt');
      assert.strictEqual(content.toString(), 'Hello, World!');

      // Test deleting from a subdirectory
      filesystem.delete('subdir/test.txt');
      assert.strictEqual(fs.existsSync(path.join(testDir, 'subdir/test.txt')), false);
    });

    it('can handle file watching', async function () {
      const filesystem = new Filesystem({
        path: testDir
      });

      await filesystem.start();

      let fileUpdateEvent = null;
      filesystem.on('file:update', (event) => {
        fileUpdateEvent = event;
      });

      // Create a file and verify event
      filesystem.writeFile('test.txt', 'Hello, World!');
      assert.ok(fileUpdateEvent);
      assert.strictEqual(fileUpdateEvent.name, 'test.txt');
      assert.strictEqual(fileUpdateEvent.type, 'change');
    });

    it('can handle file synchronization', async function () {
      const filesystem = new Filesystem({
        path: testDir
      });

      await filesystem.start();

      // Create a file directly on disk
      fs.writeFileSync(path.join(testDir, 'test.txt'), 'Hello, World!');

      // Sync and verify the file is detected
      await filesystem.sync();
      assert.deepStrictEqual(filesystem.files, ['test.txt']);
    });

    it('can handle other file trees', async function () {
      const filesystem = new Filesystem({ path: testDir });
      await filesystem.start();

      // Define test files
      const files = {
        'README.md': '# Project Documentation',
        'index.js': 'console.log("Hello, World!");',
        'config.json': JSON.stringify({ debug: true, port: 8080 }, null, 2),
        'package.json': JSON.stringify({ name: 'test-project', version: '1.0.0' }, null, 2)
      };

      // Publish each file
      for (const [name, content] of Object.entries(files)) {
        await filesystem.publish(name, content);
      }

      // Sync to ensure all files are registered
      await filesystem.sync();

      // Verify files exist
      for (const [name, content] of Object.entries(files)) {
        assert.ok(fs.existsSync(path.join(testDir, name)));
        const fileContent = fs.readFileSync(path.join(testDir, name), 'utf8');
        assert.strictEqual(fileContent, content);
      }

      // Verify filesystem state
      for (const name of Object.keys(files)) {
        assert.ok(filesystem.files.includes(name));
      }

      // Verify hashes are generated correctly
      const hashes = filesystem.hashes;
      assert.ok(hashes.length === Object.keys(files).length);
      assert.ok(hashes.every(hash => typeof hash === 'string' && hash.length === 64));

      // Verify leaves are generated correctly
      const leaves = filesystem.leaves;
      assert.ok(leaves.length === Object.keys(files).length);
      assert.ok(leaves.every(leaf => typeof leaf === 'string' && leaf.length === 64));
    });
  });
});
