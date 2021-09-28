'use strict';

const NOISE = require('../types/noise');
const assert = require('assert');

describe('@fabric/core/types/noise', function () {
  describe('NOISE', function () {
    this.timeout(10000);

    xit('is available from @fabric/core', function () {
      assert.strictEqual(NOISE instanceof Function, true);
    });

    it('can smoothly create a new NOISE session', function (done) {
      async function test () {
        const alice = new NOISE({ port: 9376 });
        const bobby = new NOISE({ seed: 'online near enter kingdom raw guide worry math nephew canvas true spoil brick slight ordinary wreck grass quarter pull fly shed chaos bullet goose' });

        alice.on('log', (...msg) => {
          console.log('[ALICE:LOG]', ...msg);
        });

        bobby.on('log', (...msg) => {
          console.log('[BOBBY:LOG]', ...msg);
        });

        alice.on('error', (...msg) => {
          console.error('[ALICE:ERROR]', ...msg);
        });

        bobby.on('error', (...msg) => {
          console.error('[BOBBY:ERROR]', ...msg);
        });

        alice.on('debug', (...msg) => {
          console.debug('[ALICE:DEBUG]', ...msg);
        });

        bobby.on('debug', (...msg) => {
          console.debug('[BOBBY:DEBUG]', ...msg);
        });

        alice.on('connections:close', async function (c) {
          console.debug('[ALICE]', 'Connection closed:', c);
          await alice.stop();
        });

        bobby.on('connections:close', async function (c) {
          console.debug('[BOBBY]', 'Connection closed:', c);
          await bobby.stop();
          done();
        });

        alice.on('ready', async function () {
          await alice.connect('tcp://021debe50db40d9d727313fe334b1b5829f1ab5d0dd8776bd51027456eb7252c77@localhost:9735');
          assert.strictEqual(alice.id, 'b9d8bce32d234014b3f45b37ee432b445fbdad036487ced2b5926b14aaa41683');
        });

        await alice.start();
        await bobby.start();
      }

      test();
    });
  });
});
