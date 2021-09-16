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
        const bobby = new NOISE();

        alice.on('connections:close', async function () {
          await alice.stop();
        });

        bobby.on('connections:close', async function () {
          await bobby.stop();
          done();
        });

        alice.on('ready', async function () {
          await alice.connect('tcp://localhost:9735');
          assert.strictEqual(alice.id, 'b9d8bce32d234014b3f45b37ee432b445fbdad036487ced2b5926b14aaa41683');
        });

        await alice.start();
        await bobby.start();
      }

      test();
    });
  });
});
